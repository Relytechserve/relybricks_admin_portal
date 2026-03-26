/**
 * Resolves the catalog price for a tier + city the same way the customer
 * property form does: prefer an active row for the property/customer city
 * (case-insensitive), otherwise the first active price row for that tier.
 */

export type TierPriceRow = {
  tier_id: string;
  city: string;
  amount: number;
  is_active: boolean;
};

export type ResolvedTierPrice<T extends TierPriceRow = TierPriceRow> = T & {
  /** True when the price row matched the given city */
  matchedCity: boolean;
};

export function resolveTierPriceForCity<T extends TierPriceRow>(
  prices: T[],
  tierId: string | null | undefined,
  city: string | null | undefined,
): ResolvedTierPrice<T> | null {
  if (!tierId) return null;
  const cityName = (city ?? "").trim();
  if (cityName) {
    const match = prices.find(
      (p) =>
        p.tier_id === tierId &&
        p.is_active &&
        p.city.toLowerCase() === cityName.toLowerCase(),
    );
    if (match) return { ...match, matchedCity: true };
  }
  const anyPrice = prices.find((p) => p.tier_id === tierId && p.is_active);
  if (!anyPrice) return null;
  return { ...anyPrice, matchedCity: false };
}

/** True if stored package amount differs from catalog (₹1 tolerance). */
export function packageAmountDiffersFromCatalog(
  stored: number | null | undefined,
  catalogAmount: number,
  tolerance = 1,
): boolean {
  if (stored == null || Number.isNaN(Number(stored))) return false;
  return Math.abs(Number(stored) - catalogAmount) > tolerance;
}
