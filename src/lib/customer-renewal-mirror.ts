import type { SupabaseClient } from "@supabase/supabase-js";
import { addOneYearToIsoDate } from "@/lib/renewal-date";

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

  const next_renewal_date = dates.length > 0 ? [...dates].sort()[0] : null;

  await serviceClient
    .from("customers")
    .update({ next_renewal_date })
    .eq("id", customerId)
    .is("archived_at", null);
}

/** Recompute one property's next_renewal_date from its latest renewal transaction. */
export async function recomputePropertyNextRenewalFromTransactions(
  serviceClient: SupabaseClient,
  customerId: string,
  propertyId: string,
): Promise<string | null> {
  const { data: rows } = await serviceClient
    .from("transactions")
    .select("date")
    .eq("customer_id", customerId)
    .eq("customer_property_id", propertyId)
    .eq("type", "renewal")
    .order("date", { ascending: false })
    .limit(1);

  const maxDate = rows?.[0]?.date as string | undefined;
  const next = maxDate ? addOneYearToIsoDate(maxDate) : null;

  await serviceClient
    .from("customer_properties")
    .update({ next_renewal_date: next })
    .eq("id", propertyId)
    .eq("customer_id", customerId);

  return next;
}

/** Recompute customer-level next_renewal_date from legacy renewals (no property link). */
export async function recomputeLegacyCustomerNextRenewalFromTransactions(
  serviceClient: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data: rows } = await serviceClient
    .from("transactions")
    .select("date")
    .eq("customer_id", customerId)
    .is("customer_property_id", null)
    .eq("type", "renewal")
    .order("date", { ascending: false })
    .limit(1);

  const maxDate = rows?.[0]?.date as string | undefined;
  const next = maxDate ? addOneYearToIsoDate(maxDate) : null;

  await serviceClient
    .from("customers")
    .update({ next_renewal_date: next })
    .eq("id", customerId)
    .is("archived_at", null);

  return next;
}

/** After a renewal transaction is added or edited, refresh derived renewal dates. */
export async function applyRenewalDateSideEffects(
  serviceClient: SupabaseClient,
  customerId: string,
  propertyId: string | null,
) {
  if (propertyId) {
    await recomputePropertyNextRenewalFromTransactions(serviceClient, customerId, propertyId);
    await refreshCustomerNextRenewalFromProperties(serviceClient, customerId);
    return;
  }

  const { count } = await serviceClient
    .from("customer_properties")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  if ((count ?? 0) === 0) {
    await recomputeLegacyCustomerNextRenewalFromTransactions(serviceClient, customerId);
  }
}
