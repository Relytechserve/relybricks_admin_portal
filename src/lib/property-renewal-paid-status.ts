import type { SupabaseClient } from "@supabase/supabase-js";

/** After insert or when recomputing: set auto paid when at least one renewal txn exists for that year. */
export async function upsertAutoPaidForRenewalYear(
  serviceClient: SupabaseClient,
  customerPropertyId: string,
  subscriptionYear: number,
) {
  if (subscriptionYear < 1) return;
  const now = new Date().toISOString();
  await serviceClient.from("property_renewal_year_status").upsert(
    {
      customer_property_id: customerPropertyId,
      subscription_year: subscriptionYear,
      is_paid: true,
      paid_source: "auto",
      updated_at: now,
    },
    { onConflict: "customer_property_id,subscription_year" },
  );
}

/**
 * Recompute paid status from renewal transactions for a property+year.
 * Used after edits that remove or move renewals — not called on transaction delete.
 */
export async function recomputeAutoStatusForPropertyYear(
  serviceClient: SupabaseClient,
  customerPropertyId: string,
  subscriptionYear: number,
) {
  if (subscriptionYear < 1) return;
  const { count, error } = await serviceClient
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("customer_property_id", customerPropertyId)
    .eq("type", "renewal")
    .eq("subscription_renewal_year", subscriptionYear);

  if (error) {
    console.error("[renewal-status] count error:", error);
    return;
  }

  const hasRenewal = (count ?? 0) > 0;
  const now = new Date().toISOString();
  if (!hasRenewal) {
    await serviceClient.from("property_renewal_year_status").upsert(
      {
        customer_property_id: customerPropertyId,
        subscription_year: subscriptionYear,
        is_paid: false,
        paid_source: "auto",
        updated_at: now,
      },
      { onConflict: "customer_property_id,subscription_year" },
    );
    return;
  }
  await upsertAutoPaidForRenewalYear(serviceClient, customerPropertyId, subscriptionYear);
}

export async function countRenewalTransactionsForPropertyYear(
  serviceClient: SupabaseClient,
  customerPropertyId: string,
  subscriptionYear: number,
  excludeTransactionId?: string,
): Promise<number> {
  let q = serviceClient
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("customer_property_id", customerPropertyId)
    .eq("type", "renewal")
    .eq("subscription_renewal_year", subscriptionYear);

  if (excludeTransactionId) {
    q = q.neq("id", excludeTransactionId);
  }

  const { count, error } = await q;
  if (error) {
    console.error("[renewal-status] countRenewalTransactionsForPropertyYear:", error);
    return 0;
  }
  return count ?? 0;
}
