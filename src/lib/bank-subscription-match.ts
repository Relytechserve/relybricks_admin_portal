import type { TierPriceRow } from "@/lib/subscription-tier-pricing";
import { resolveTierPriceForCity } from "@/lib/subscription-tier-pricing";

export type CustomerPropertyRow = {
  subscription_tier_id: string | null;
  package_revenue: number | null;
  city: string | null;
};

export type CustomerForBankMatch = {
  id: string;
  name: string;
  subscription_tier_id: string | null;
  package_revenue: number | null;
  property_city: string | null;
  /** Present only if DB migration added `customers.customer_location`. */
  customer_location?: string | null;
  customer_properties: CustomerPropertyRow[] | null;
};

function normalizeParticulars(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meaningful tokens from a person/company name (skip very short tokens). */
function nameTokens(name: string): string[] {
  return normalizeParticulars(name)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

/**
 * True if bank particulars plausibly reference this customer (name appears as substring
 * or all significant tokens appear).
 */
export function particularsMatchCustomerName(particulars: string, customerName: string): boolean {
  const p = normalizeParticulars(particulars);
  const full = normalizeParticulars(customerName);
  if (!p || !full) return false;
  if (full.length >= 2 && p.includes(full)) return true;
  const tokens = nameTokens(customerName);
  if (tokens.length === 0) return false;
  return tokens.every((t) => p.includes(t));
}

export function expectedSubscriptionAmount(
  customer: CustomerForBankMatch,
  tierPrices: TierPriceRow[],
): number | null {
  const props = customer.customer_properties ?? [];
  const primary =
    props.find((x) => x.subscription_tier_id) ?? props[0];
  const tierId = primary?.subscription_tier_id ?? customer.subscription_tier_id;
  const city = (
    primary?.city ??
    customer.property_city ??
    customer.customer_location ??
    ""
  ).trim();
  const resolved = resolveTierPriceForCity(tierPrices, tierId, city || null);
  if (resolved) return Number(resolved.amount);

  const pkg = primary?.package_revenue ?? customer.package_revenue;
  if (pkg != null && Number.isFinite(Number(pkg))) return Number(pkg);
  return null;
}

export function amountWithinTolerance(
  actual: number,
  expected: number,
  absTolerance: number,
  pctTolerance: number,
): boolean {
  const tol = Math.max(absTolerance, (Math.abs(expected) * pctTolerance) / 100);
  return Math.abs(actual - expected) <= tol;
}

/**
 * Pick the best subscription match for a deposit row, or null.
 * Candidates: customer name matches particulars AND amount within tolerance of expected catalog/package amount.
 */
export function matchSubscriptionDeposit(
  particulars: string,
  depositAmount: number,
  customers: CustomerForBankMatch[],
  tierPrices: TierPriceRow[],
  absTolerance: number,
  pctTolerance: number,
): { customerId: string; customerName: string; expectedAmount: number; delta: number } | null {
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) return null;

  const sorted = [...customers].sort((a, b) => b.name.length - a.name.length);

  type Cand = { customerId: string; customerName: string; expectedAmount: number; delta: number };
  const candidates: Cand[] = [];

  for (const c of sorted) {
    if (!particularsMatchCustomerName(particulars, c.name)) continue;
    const expected = expectedSubscriptionAmount(c, tierPrices);
    if (expected == null || !Number.isFinite(expected)) continue;
    if (!amountWithinTolerance(depositAmount, expected, absTolerance, pctTolerance)) continue;
    candidates.push({
      customerId: c.id,
      customerName: c.name,
      expectedAmount: expected,
      delta: Math.abs(depositAmount - expected),
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.delta - b.delta);
  return candidates[0] ?? null;
}
