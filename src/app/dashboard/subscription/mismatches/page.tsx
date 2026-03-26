"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  packageAmountDiffersFromCatalog,
  resolveTierPriceForCity,
  type TierPriceRow,
} from "@/lib/subscription-tier-pricing";

type Tier = { id: string; name: string };

type MismatchRow = {
  customerId: string;
  customerName: string;
  propertyId: string | null;
  scopeLabel: string;
  tierName: string;
  cityUsed: string;
  priceMatchNote: string;
  storedAmount: number;
  expectedAmount: number;
};

export default function SubscriptionAmountMismatchesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MismatchRow[]>([]);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: tierRows, error: tierErr } = await supabase
        .from("subscription_tiers")
        .select("id, name");

      if (tierErr) {
        setError("Could not load subscription tiers.");
        setLoading(false);
        return;
      }

      const { data: priceRows, error: priceErr } = await supabase
        .from("subscription_tier_prices")
        .select("tier_id, city, amount, is_active");

      if (priceErr) {
        setError("Could not load tier prices.");
        setLoading(false);
        return;
      }

      const prices = (priceRows ?? []) as TierPriceRow[];

      const { data: customerRows, error: custErr } = await supabase
        .from("customers")
        .select("id, name, subscription_tier_id, package_revenue, property_city")
        .is("archived_at", null);

      if (custErr) {
        setError("Could not load customers.");
        setLoading(false);
        return;
      }

      const { data: propertyRows, error: propErr } = await supabase
        .from("customer_properties")
        .select("id, customer_id, city, subscription_tier_id, package_revenue");

      if (propErr) {
        setError("Could not load properties.");
        setLoading(false);
        return;
      }

      const tiers = (tierRows ?? []) as Tier[];
      const tierNameById = new Map(tiers.map((t) => [t.id, t.name] as const));
      const customers = (customerRows ?? []) as {
        id: string;
        name: string | null;
        subscription_tier_id: string | null;
        package_revenue: number | null;
        property_city: string | null;
      }[];
      const properties = (propertyRows ?? []) as {
        id: string;
        customer_id: string;
        city: string | null;
        subscription_tier_id: string | null;
        package_revenue: number | null;
      }[];

      const propsByCustomer = new Map<string, typeof properties>();
      for (const p of properties) {
        const list = propsByCustomer.get(p.customer_id) ?? [];
        list.push(p);
        propsByCustomer.set(p.customer_id, list);
      }

      const mismatches: MismatchRow[] = [];

      const pushIfMismatch = (
        customerId: string,
        customerName: string,
        propertyId: string | null,
        scopeLabel: string,
        tierId: string,
        cityForPrice: string | null,
        stored: number | null,
      ) => {
        const resolved = resolveTierPriceForCity(prices, tierId, cityForPrice);
        if (!resolved) return;
        const expected = Number(resolved.amount);
        if (!packageAmountDiffersFromCatalog(stored, expected)) return;

        mismatches.push({
          customerId,
          customerName,
          propertyId,
          scopeLabel,
          tierName: tierNameById.get(tierId) ?? tierId,
          cityUsed: resolved.city,
          priceMatchNote: resolved.matchedCity
            ? "Catalog price for city"
            : "Fallback tier price (no row for this city)",
          storedAmount: Number(stored),
          expectedAmount: expected,
        });
      };

      for (const c of customers) {
        const name = (c.name ?? "").trim() || "—";
        const props = propsByCustomer.get(c.id) ?? [];

        if (props.length > 0) {
          for (const p of props) {
            if (!p.subscription_tier_id) continue;
            if (p.package_revenue == null || Number.isNaN(Number(p.package_revenue))) continue;
            pushIfMismatch(
              c.id,
              name,
              p.id,
              p.city?.trim() || "Property",
              p.subscription_tier_id,
              p.city,
              p.package_revenue,
            );
          }
        } else {
          if (!c.subscription_tier_id) continue;
          if (c.package_revenue == null || Number.isNaN(Number(c.package_revenue))) continue;
          pushIfMismatch(
            c.id,
            name,
            null,
            "Customer (no property row)",
            c.subscription_tier_id,
            c.property_city,
            c.package_revenue,
          );
        }
      }

      mismatches.sort((a, b) => {
        const n = a.customerName.localeCompare(b.customerName);
        if (n !== 0) return n;
        return a.scopeLabel.localeCompare(b.scopeLabel);
      });

      setRows(mismatches);
      setLoading(false);
    }

    void load();
  }, [router]);

  const summary = useMemo(() => {
    const count = rows.length;
    const totalDelta = rows.reduce((s, r) => s + (r.storedAmount - r.expectedAmount), 0);
    return { count, totalDelta };
  }, [rows]);

  if (loading) {
    return (
      <div className="max-w-5xl">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl">
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Subscription amount mismatches</h1>
          <p className="mt-1 text-sm text-stone-600 max-w-2xl">
            Customers whose stored annual package amount differs from the catalog price on the Subscription
            page for their tier and city. City match uses the property city (or customer city for legacy
            accounts without properties); if there is no price row for that city, the first active price for
            the tier is used — same logic as when you pick a tier on a customer.
          </p>
        </div>
        <Link
          href="/dashboard/subscription"
          className="text-sm text-violet-700 hover:underline shrink-0"
        >
          ← Back to Subscription
        </Link>
      </div>

      <p className="mt-4 text-sm text-stone-700">
        <span className="font-medium">{summary.count}</span> billing line
        {summary.count === 1 ? "" : "s"} with a mismatch
        {summary.count > 0 && (
          <>
            {" "}
            (net difference vs catalog:{" "}
            <span className="font-medium">
              ₹{Math.round(summary.totalDelta).toLocaleString("en-IN")}
            </span>
            )
          </>
        )}
        . Amounts within ₹1 of the catalog are ignored.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-600 text-sm">
          No mismatches — every stored package amount matches the tier catalog (or has no tier / no catalog
          row to compare).
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Catalog uses</th>
                <th className="px-4 py-3 font-medium text-right">Stored (₹)</th>
                <th className="px-4 py-3 font-medium text-right">Expected (₹)</th>
                <th className="px-4 py-3 font-medium text-right">Δ (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const delta = r.storedAmount - r.expectedAmount;
                return (
                  <tr key={`${r.customerId}-${r.propertyId ?? "cust"}`} className="border-b border-stone-100">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/customers/${r.customerId}`}
                        className="text-violet-700 hover:underline font-medium"
                      >
                        {r.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-700">
                      {r.scopeLabel}
                      <div className="text-xs text-stone-500 mt-0.5">{r.priceMatchNote}</div>
                    </td>
                    <td className="px-4 py-3 text-stone-800">{r.tierName}</td>
                    <td className="px-4 py-3 text-stone-600">
                      {r.cityUsed}
                      {r.priceMatchNote.startsWith("Fallback") && (
                        <span className="text-amber-700"> · check city pricing</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Math.round(r.storedAmount).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-stone-600">
                      {Math.round(r.expectedAmount).toLocaleString("en-IN")}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-medium ${
                        delta > 0 ? "text-emerald-700" : "text-amber-800"
                      }`}
                    >
                      {delta > 0 ? "+" : ""}
                      {Math.round(delta).toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
