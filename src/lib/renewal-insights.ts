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

/** One subscription / renewal schedule: either a property row or legacy customer-level. */
export type BillingUnit = {
  customerId: string;
  customerName: string;
  customerStatus: string;
  propertyId: string | null;
  subscription_date: string | null;
  next_renewal_date: string | null;
  package_revenue: number | null;
};

export function renewalTrackingKey(customerId: string, propertyId: string | null): string {
  return `${customerId}|${propertyId ?? ""}`;
}

/** Latest renewal transaction date per customer + optional property (legacy uses propertyId null). */
export function maxRenewalDateByCustomerProperty(
  rows: { customer_id: string; customer_property_id: string | null; date: string }[],
): Record<string, string> {
  const maxBy: Record<string, string> = {};
  for (const row of rows) {
    const key = renewalTrackingKey(row.customer_id, row.customer_property_id);
    const cur = maxBy[key];
    if (!cur || row.date > cur) maxBy[key] = row.date;
  }
  return maxBy;
}

export function maxRenewalTxnForUnit(
  map: Record<string, string>,
  customerId: string,
  propertyId: string | null,
): string | undefined {
  return map[renewalTrackingKey(customerId, propertyId)];
}

export function buildBillingUnits<
  C extends {
    id: string;
    name?: string | null;
    status: string;
    subscription_date?: string | null;
    next_renewal_date?: string | null;
    package_revenue?: number | null;
  },
  P extends {
    id: string;
    customer_id: string;
    subscription_date?: string | null;
    next_renewal_date?: string | null;
    package_revenue?: number | null;
  },
>(customers: C[], propertyRows: P[]): BillingUnit[] {
  const byCust = new Map<string, P[]>();
  for (const p of propertyRows) {
    const arr = byCust.get(p.customer_id) ?? [];
    arr.push(p);
    byCust.set(p.customer_id, arr);
  }
  const units: BillingUnit[] = [];
  for (const c of customers) {
    const props = byCust.get(c.id) ?? [];
    if (props.length > 0) {
      for (const p of props) {
        units.push({
          customerId: c.id,
          customerName: (c.name ?? "").trim(),
          customerStatus: c.status,
          propertyId: p.id,
          subscription_date: p.subscription_date ?? null,
          next_renewal_date: p.next_renewal_date ?? null,
          package_revenue:
            p.package_revenue != null && !Number.isNaN(Number(p.package_revenue))
              ? Number(p.package_revenue)
              : null,
        });
      }
    } else {
      units.push({
        customerId: c.id,
        customerName: (c.name ?? "").trim(),
        customerStatus: c.status,
        propertyId: null,
        subscription_date: c.subscription_date ?? null,
        next_renewal_date: c.next_renewal_date ?? null,
        package_revenue:
          c.package_revenue != null && !Number.isNaN(Number(c.package_revenue))
            ? Number(c.package_revenue)
            : null,
      });
    }
  }
  return units;
}

export function isBillingUnitRenewalOverdue(
  unit: Pick<BillingUnit, "customerStatus" | "next_renewal_date">,
  maxRenewalTxnDate: string | undefined,
): boolean {
  return isRenewalOverdueActiveCustomer(
    { status: unit.customerStatus, next_renewal_date: unit.next_renewal_date },
    maxRenewalTxnDate,
  );
}

export function customerHasRenewalDueWithinDays(
  customerId: string,
  units: BillingUnit[],
  days: number,
): boolean {
  return units.some(
    (u) =>
      u.customerId === customerId && isRenewalDueWithinDays(u.next_renewal_date, days),
  );
}

export function customerHasOverdueRenewalBilling(
  customerId: string,
  units: BillingUnit[],
  maxMap: Record<string, string>,
): boolean {
  return units.some((u) => {
    if (u.customerId !== customerId) return false;
    const maxD = maxRenewalTxnForUnit(maxMap, u.customerId, u.propertyId);
    return isBillingUnitRenewalOverdue(u, maxD);
  });
}

/** Earliest next renewal among a customer’s billing units (properties + legacy). */
export function earliestNextRenewalForCustomer(
  customerId: string,
  units: BillingUnit[],
): string | null {
  const dates = units
    .filter((u) => u.customerId === customerId)
    .map((u) => u.next_renewal_date)
    .filter((d): d is string => Boolean(d));
  if (dates.length === 0) return null;
  dates.sort();
  return dates[0];
}
