import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { recordAdminActivity } from "@/lib/record-admin-activity";

type Payload = {
  is_paid: boolean;
};

export async function PATCH(
  request: Request,
  context: {
    params:
      | Promise<{ id: string; propertyId: string; year: string }>
      | { id: string; propertyId: string; year: string };
  },
) {
  const params = await Promise.resolve(context.params);
  const customerId = typeof params?.id === "string" ? params.id : "";
  const propertyId = typeof params?.propertyId === "string" ? params.propertyId : "";
  const yearStr = typeof params?.year === "string" ? params.year : "";
  const subscriptionYear = parseInt(yearStr, 10);

  if (!customerId || !propertyId || !yearStr || !Number.isInteger(subscriptionYear) || subscriptionYear < 1) {
    return NextResponse.json({ error: "Invalid customer, property, or subscription year." }, { status: 400 });
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration is incomplete." }, { status: 500 });
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
    return NextResponse.json({ error: "You must be signed in as admin." }, { status: 401 });
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json({ error: "Only admins can update subscription paid status." }, { status: 403 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body?.is_paid !== "boolean") {
    return NextResponse.json({ error: "Body must include is_paid (boolean)." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: propRow } = await serviceClient
    .from("customer_properties")
    .select("id, customer_id")
    .eq("id", propertyId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (!propRow) {
    return NextResponse.json({ error: "Property not found for this customer." }, { status: 404 });
  }

  if (body.is_paid) {
    const { count, error: cntErr } = await serviceClient
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("customer_property_id", propertyId)
      .eq("type", "renewal")
      .eq("subscription_renewal_year", subscriptionYear);

    if (cntErr) {
      return NextResponse.json({ error: cntErr.message ?? "Failed to validate renewals." }, { status: 400 });
    }
    if ((count ?? 0) < 1) {
      return NextResponse.json(
        { error: "Cannot mark paid without at least one renewal transaction for this subscription year." },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const { data: row, error } = await serviceClient
    .from("property_renewal_year_status")
    .upsert(
      {
        customer_property_id: propertyId,
        subscription_year: subscriptionYear,
        is_paid: body.is_paid,
        paid_source: "admin_override",
        updated_at: now,
      },
      { onConflict: "customer_property_id,subscription_year" },
    )
    .select("customer_property_id, subscription_year, is_paid, paid_source, updated_at")
    .single();

  if (error) {
    console.error("[renewal-years] upsert error:", error);
    return NextResponse.json({ error: error.message ?? "Failed to update status." }, { status: 400 });
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
    action: "property.subscription_year_paid_override",
    resource_type: "customer",
    resource_id: customerId,
    summary: `${custName}: property ${propertyId.slice(0, 8)}… subscription year ${subscriptionYear} → ${body.is_paid ? "paid" : "unpaid"} (admin)`,
  });

  return NextResponse.json({ data: row });
}
