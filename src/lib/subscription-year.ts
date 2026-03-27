/** Add full calendar years to YYYY-MM-DD (same month/day as anchor). */
export function addYearsToYmd(ymd: string, years: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]) + years;
  if (!Number.isFinite(y)) return null;
  return `${y}-${m[2]}-${m[3]}`;
}

/**
 * 1-based subscription year index for a payment date.
 * Year 1 is [anchor, anchor+1y), year 2 is [anchor+1y, anchor+2y), etc.
 */
export function subscriptionYearIndexForPayment(
  subscriptionAnchorYmd: string | null | undefined,
  paymentYmd: string | null | undefined,
): number | null {
  const anchor = subscriptionAnchorYmd?.trim().slice(0, 10);
  const pay = paymentYmd?.trim().slice(0, 10);
  if (!anchor || !pay) return null;
  if (pay < anchor) return 1;
  let k = 1;
  for (;;) {
    const periodEnd = addYearsToYmd(anchor, k);
    if (!periodEnd) return null;
    if (pay < periodEnd) return k;
    k += 1;
    if (k > 500) return null;
  }
}
