import type { SupabaseClient } from "@supabase/supabase-js";

/** Sum payment + renewal transaction amounts onto customers.billed_amount. */
export async function syncCustomerBilledAmountFromTransactions(
  serviceClient: SupabaseClient,
  customerId: string,
) {
  const { data: rows, error } = await serviceClient
    .from("transactions")
    .select("amount, type")
    .eq("customer_id", customerId)
    .in("type", ["payment", "renewal"]);

  if (error) {
    console.error("[billed-amount] load error:", error);
    return;
  }

  let total = 0;
  for (const row of rows ?? []) {
    const amount = row.amount != null ? Number(row.amount) : 0;
    if (!Number.isNaN(amount) && amount > 0) total += amount;
  }

  await serviceClient
    .from("customers")
    .update({ billed_amount: total > 0 ? total : null })
    .eq("id", customerId)
    .is("archived_at", null);
}
