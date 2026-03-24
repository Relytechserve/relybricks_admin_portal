import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { refreshCustomerNextRenewalFromProperties } from "@/lib/customer-renewal-mirror";
import { addOneYearToIsoDate } from "@/lib/renewal-date";
import { recordAdminActivity } from "@/lib/record-admin-activity";

type Payload = {
  type: "renewal" | "payment" | "other";
  date: string;
  amount?: number | string | null;
  description?: string | null;
  /** When set, renewal updates this property's next_renewal_date and rolls up to customer. */
  customer_property_id?: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const params = await Promise.resolve(context.params);
  const customerId = typeof params?.id === "string" ? params.id : "";
  if (!customerId) {
    return NextResponse.json({ error: "Missing customer id." }, { status: 400 });
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
      { error: "Only admins can add transactions." },
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
  const rawPropId =
    typeof body?.customer_property_id === "string" ? body.customer_property_id.trim() : "";
  const customerPropertyId = rawPropId || null;

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

  if (type === "renewal" && !customerPropertyId) {
    const { count } = await serviceClient
      .from("customer_properties")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Select which property this renewal applies to." },
        { status: 400 },
      );
    }
  }

  if (customerPropertyId) {
    const { data: propRow } = await serviceClient
      .from("customer_properties")
      .select("id")
      .eq("id", customerPropertyId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!propRow) {
      return NextResponse.json(
        { error: "Property not found for this customer." },
        { status: 400 },
      );
    }
  }

  let nextRenewalDate: string | null = null;
  if (type === "renewal") {
    nextRenewalDate = addOneYearToIsoDate(date);
    if (!nextRenewalDate) {
      return NextResponse.json(
        { error: "Invalid renewal date. Use YYYY-MM-DD." },
        { status: 400 },
      );
    }
  }

  const { data, error } = await serviceClient
    .from("transactions")
    .insert({
      customer_id: customerId,
      customer_property_id: customerPropertyId,
      type,
      amount: amount != null && !Number.isNaN(amount) ? amount : null,
      description,
      date,
    })
    .select("id, type, amount, description, date, customer_property_id")
    .single();

  if (error) {
    console.error("[transactions] Insert error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to add transaction." },
      { status: 400 },
    );
  }

  if (type === "renewal" && nextRenewalDate) {
    if (customerPropertyId) {
      const { error: propErr } = await serviceClient
        .from("customer_properties")
        .update({ next_renewal_date: nextRenewalDate })
        .eq("id", customerPropertyId)
        .eq("customer_id", customerId);
      if (propErr) {
        console.error("[transactions] Failed to update property next_renewal_date:", propErr);
        return NextResponse.json(
          { error: propErr.message || "Could not update property next renewal date." },
          { status: 400 },
        );
      }
      await refreshCustomerNextRenewalFromProperties(serviceClient, customerId);
    } else {
      const { error: updateError } = await serviceClient
        .from("customers")
        .update({ next_renewal_date: nextRenewalDate })
        .eq("id", customerId);
      if (updateError) {
        console.error("[transactions] Failed to update next_renewal_date:", updateError);
        return NextResponse.json(
          { error: updateError.message || "Could not update customer next renewal date." },
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
  const amtLabel =
    amount != null && !Number.isNaN(amount) ? ` ₹${Number(amount).toLocaleString("en-IN")}` : "";
  await recordAdminActivity(serviceClient, {
    actor_user_id: caller.id,
    actor_email: caller.email ?? null,
    action: "transaction.created",
    resource_type: "customer",
    resource_id: customerId,
    summary: `Added ${type} transaction for ${custName}${amtLabel}`,
  });

  return NextResponse.json({ data, nextRenewalDate });
}
