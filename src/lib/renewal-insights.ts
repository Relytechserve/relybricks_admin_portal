/** Local calendar date YYYY-MM-DD (avoids UTC midnight shifting the day). */
export function todayYmdLocal(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const parts = ymd.split("-").map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function maxRenewalDateByCustomer(
  rows: { customer_id: string; date: string }[],
): Record<string, string> {
  const maxBy: Record<string, string> = {};
  for (const row of rows) {
    const cur = maxBy[row.customer_id];
    if (!cur || row.date > cur) maxBy[row.customer_id] = row.date;
  }
  return maxBy;
}

/**
 * Active subscriber whose scheduled next renewal is already past today, and no renewal
 * transaction is recorded on or after that due date (covers “paid but date not rolled” when txn exists).
 */
export function isRenewalOverdueActiveCustomer(
  customer: { status: string; next_renewal_date: string | null },
  maxRenewalTxnDate: string | undefined,
): boolean {
  if (!customer.next_renewal_date) return false;
  if ((customer.status ?? "").trim().toLowerCase() !== "active") return false;
  const today = todayYmdLocal();
  if (customer.next_renewal_date >= today) return false;
  if (maxRenewalTxnDate && maxRenewalTxnDate >= customer.next_renewal_date) return false;
  return true;
}

/** Next renewal falls between today and today + days (inclusive), ISO date strings. */
export function isRenewalDueWithinDays(nextRenewalDate: string | null, daysFromToday: number): boolean {
  if (!nextRenewalDate) return false;
  const today = todayYmdLocal();
  const end = addDaysToYmd(today, daysFromToday);
  return nextRenewalDate >= today && nextRenewalDate <= end;
}
