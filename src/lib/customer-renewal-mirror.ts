import type { SupabaseClient } from "@supabase/supabase-js";

/** Set customer.next_renewal_date to the earliest non-null next_renewal_date among properties. */
export async function refreshCustomerNextRenewalFromProperties(
  serviceClient: SupabaseClient,
  customerId: string,
) {
  const { data: props } = await serviceClient
    .from("customer_properties")
    .select("next_renewal_date")
    .eq("customer_id", customerId);
  const dates = (props ?? [])
    .map((p: { next_renewal_date: string | null }) => p.next_renewal_date)
    .filter((d): d is string => Boolean(d));
  if (dates.length === 0) return;
  dates.sort();
  await serviceClient
    .from("customers")
    .update({ next_renewal_date: dates[0] })
    .eq("id", customerId)
    .is("archived_at", null);
}
