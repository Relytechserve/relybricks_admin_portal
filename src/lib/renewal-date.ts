/** Next renewal = same calendar month/day, one year after renewal payment date (YYYY-MM-DD). */
export function addOneYearToIsoDate(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y + 1}-${m[2]}-${m[3]}`;
}
