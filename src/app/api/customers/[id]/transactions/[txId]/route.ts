import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { refreshCustomerNextRenewalFromProperties } from "@/lib/customer-renewal-mirror";
import {
  recomputeAutoStatusForPropertyYear,
  upsertAutoPaidForRenewalYear,
} from "@/lib/property-renewal-paid-status";
import { addOneYearToIsoDate } from "@/lib/renewal-date";
import { subscriptionYearIndexForPayment } from "@/lib/subscription-year";
import { recordAdminActivity } from "@/lib/record-admin-activity";

type Payload = {
  type: "renewal" | "payment" | "other";
  date: string;
  amount?: number | string | null;
  description?: string | null;
  edit_reason: string;
  subscription_renewal_year?: number | null;
};

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string; txId: string }> | { id: string; txId: string };
  },
) {
  const params = await Promise.resolve(context.params);
  const customerId = typeof params?.id === "string" ? params.id : "";
  const txId = typeof params?.txId === "string" ? params.txId : "";

  if (!customerId || !txId) {
    return NextResponse.json(
      { error: "Missing customer id or transaction id." },
      { status: 400 },
    );
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      {
        error:
          "Server configuration is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 500 },
    );
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is required. Add it to .env.local (Supabase Dashboard > Settings > API > service_role key).",
      },
      { status: 500 },
    );
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user: caller },
  } = await sessionClient.auth.getUser();

  if (!caller) {
    return NextResponse.json(
      { error: "You must be signed in as admin." },
      { status: 401 },
    );
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can edit transactions." },
      { status: 403 },
    );
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const editReason =
    typeof body?.edit_reason === "string" ? body.edit_reason.trim() : "";
  if (!editReason) {
    return NextResponse.json(
      { error: "Edit reason is required when editing a transaction." },
      { status: 400 },
    );
  }

  const type = body?.type;
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  const amount =
    body?.amount != null && body?.amount !== ""
      ? Number(body.amount)
      : null;
  const description =
    typeof body?.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const validTypes = ["renewal", "payment", "other"];
  if (!type || !validTypes.includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Use renewal, payment, or other." },
      { status: 400 },
    );
  }

  if (!date) {
    return NextResponse.json(
      { error: "Date is required." },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: custActive } = await serviceClient
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .is("archived_at", null)
    .maybeSingle();
  if (!custActive) {
    return NextResponse.json(
      { error: "Customer not found or has been archived." },
      { status: 404 },
    );
  }

  const { data: existingTx } = await serviceClient
    .from("transactions")
    .select("customer_property_id, type, subscription_renewal_year")
    .eq("id", txId)
    .eq("customer_id", customerId)
    .maybeSingle();

  const existing = existingTx as {
    customer_property_id?: string | null;
    type?: string;
    subscription_renewal_year?: number | null;
  } | null;

  const propertyId = existing?.customer_property_id ?? null;
  const oldRenewalYear =
    existing?.type === "renewal" ? existing?.subscription_renewal_year ?? null : null;

  let propertySubscriptionDate: string | null = null;
  if (propertyId) {
    const { data: propRow } = await serviceClient
      .from("customer_properties")
      .select("subscription_date")
      .eq("id", propertyId)
      .eq("customer_id", customerId)
      .maybeSingle();
    propertySubscriptionDate = (propRow as { subscription_date?: string | null } | null)
      ?.subscription_date ?? null;
  }

  let nextRenewalDate: string | null = null;
  let newSubscriptionRenewalYear: number | null = null;

  if (type === "renewal") {
    nextRenewalDate = addOneYearToIsoDate(date);
    if (!nextRenewalDate) {
      return NextResponse.json(
        { error: "Invalid renewal date. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }
    if (propertyId) {
      if (!propertySubscriptionDate) {
        return NextResponse.json(
          {
            error:
              "Set this property’s subscription start date before using renewal type (needed for subscription year).",
          },
          { status: 400 },
        );
      }
      const rawYear = body?.subscription_renewal_year;
      if (rawYear != null && String(rawYear).trim() !== "") {
        const y = Number(rawYear);
        if (!Number.isInteger(y) || y < 1) {
          return NextResponse.json(
            { error: "Subscription year must be a positive integer." },
            { status: 400 },
          );
        }
        newSubscriptionRenewalYear = y;
      } else {
        newSubscriptionRenewalYear = subscriptionYearIndexForPayment(propertySubscriptionDate, date);
        if (newSubscriptionRenewalYear == null) {
          return NextResponse.json(
            { error: "Could not derive subscription year from dates." },
            { status: 400 },
          );
        }
      }
    }
  }

  const { data, error } = await serviceClient
    .from("transactions")
    .update({
      type,
      date,
      amount: amount != null && !Number.isNaN(amount) ? amount : null,
      description,
      updated_at: new Date().toISOString(),
      last_edit_reason: editReason,
      subscription_renewal_year: newSubscriptionRenewalYear,
    })
    .eq("id", txId)
    .eq("customer_id", customerId)
    .select(
      "id, type, amount, description, date, last_edit_reason, customer_property_id, subscription_renewal_year",
    )
    .single();

  if (error) {
    console.error("[transactions] Update error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update transaction." },
      { status: 400 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Transaction not found or access denied." },
      { status: 404 },
    );
  }

  if (propertyId && oldRenewalYear != null) {
    const yearRemoved =
      type !== "renewal" ||
      newSubscriptionRenewalYear !== oldRenewalYear;
    if (yearRemoved) {
      await recomputeAutoStatusForPropertyYear(serviceClient, propertyId, oldRenewalYear);
    }
  }

  if (type === "renewal" && propertyId && newSubscriptionRenewalYear != null) {
    await upsertAutoPaidForRenewalYear(serviceClient, propertyId, newSubscriptionRenewalYear);
  }

  if (type === "renewal" && nextRenewalDate) {
    if (propertyId) {
      const { error: propErr } = await serviceClient
        .from("customer_properties")
        .update({ next_renewal_date: nextRenewalDate })
        .eq("id", propertyId)
        .eq("customer_id", customerId);
      if (propErr) {
        return NextResponse.json(
          { error: propErr.message || "Could not update property next renewal date." },
          { status: 400 },
        );
      }
      await refreshCustomerNextRenewalFromProperties(serviceClient, customerId);
    } else {
      const { error: custErr } = await serviceClient
        .from("customers")
        .update({ next_renewal_date: nextRenewalDate })
        .eq("id", customerId);
      if (custErr) {
        return NextResponse.json(
          { error: custErr.message || "Could not update customer next renewal date." },
          { status: 400 },
        );
      }
    }
  }

  const { data: custRow } = await serviceClient
    .from("customers")
    .select("name")
    .eq("id", customerId)
    .maybeSingle();
  const custName = (custRow as { name?: string } | null)?.name ?? "Customer";
  await recordAdminActivity(serviceClient, {
    actor_user_id: caller.id,
    actor_email: caller.email ?? null,
    action: "transaction.updated",
    resource_type: "customer",
    resource_id: customerId,
    summary: `Updated ${type} transaction for ${custName}`,
  });

  return NextResponse.json({ data, nextRenewalDate });
}
