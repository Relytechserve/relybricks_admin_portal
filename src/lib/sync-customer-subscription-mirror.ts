import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rolls up property-level subscription fields onto customers for legacy list/dashboard reads.
 * Primary property = first row with a tier, else first property by created_at.
 */
export async function syncCustomerSubscriptionMirrorFromProperties(
  supabase: SupabaseClient,
  customerId: string,
) {
  const { data: props } = await supabase
    .from("customer_properties")
    .select(
      "subscription_tier_id, plan_type, subscription_date, next_renewal_date, package_revenue",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  const rows = props ?? [];
  if (rows.length === 0) return;

  const primary =
    rows.find((p: { subscription_tier_id: string | null }) => p.subscription_tier_id) ??
    rows[0];
  const subscription_tier_id = primary?.subscription_tier_id ?? null;
  const plan_type = primary?.plan_type ?? null;
  const subscription_date = primary?.subscription_date ?? null;

  const renewalDates = rows
    .map((p: { next_renewal_date: string | null }) => p.next_renewal_date)
    .filter((d): d is string => Boolean(d));
  renewalDates.sort();
  const next_renewal_date = renewalDates[0] ?? null;

  let package_revenue: number | null = null;
  for (const p of rows) {
    const v = (p as { package_revenue: number | null }).package_revenue;
    if (v != null && !Number.isNaN(Number(v))) {
      package_revenue = (package_revenue ?? 0) + Number(v);
    }
  }
  if (package_revenue === 0) package_revenue = null;

  await supabase
    .from("customers")
    .update({
      subscription_tier_id,
      plan_type,
      subscription_date,
      next_renewal_date,
      package_revenue,
    })
    .eq("id", customerId);
}
