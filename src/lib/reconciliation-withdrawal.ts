/** Shared helpers for bank reconciliation withdrawal line amounts. */

export type ReconciliationFlowRow = {
  particulars: string;
  deposit: number | null;
  withdrawal: number | null;
  transaction_amount: number | null;
  flow: string;
};

/**
 * True outgoing (debit) amount for a line: **only** the `withdrawal` column.
 * Never uses `transaction_amount` (that can hold deposits) or `deposit`.
 */
export function withdrawalAmountFromRow(row: ReconciliationFlowRow): number {
  const w = row.withdrawal != null ? Number(row.withdrawal) : NaN;
  if (!Number.isFinite(w) || w <= 0) return 0;
  return w;
}

export function normalizeParticularsKey(particulars: string): string {
  return particulars.trim().toLowerCase().replace(/\s+/g, " ");
}
