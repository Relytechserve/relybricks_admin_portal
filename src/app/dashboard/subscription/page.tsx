"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { logClientAdminActivity } from "@/lib/client-admin-activity";

type SubscriptionTier = {
  id: string;
  name: string;
  description: string | null;
  is_custom: boolean;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type SubscriptionTierPrice = {
  id: string;
  tier_id: string;
  city: string;
  amount: number;
  currency: string | null;
  is_active: boolean;
};

type TierWithPrices = SubscriptionTier & { prices: SubscriptionTierPrice[]; customerCount: number };

export default function SubscriptionPage() {
  const [tiers, setTiers] = useState<TierWithPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTier, setSavingTier] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIsCustom, setFormIsCustom] = useState(false);
  const [formCity, setFormCity] = useState("");
  const [formAmount, setFormAmount] = useState<number | "">("");
  const [editCity, setEditCity] = useState("");
  const [editAmount, setEditAmount] = useState<number | "">("");
  const router = useRouter();

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

      const { data: tierRows, error: tierError } = await supabase
        .from("subscription_tiers")
        .select("id, name, description, is_custom, is_active, created_at, updated_at")
        .order("name", { ascending: true });

      if (tierError) {
        setError("Failed to load subscription tiers.");
        setLoading(false);
        return;
      }

      const tiersData = (tierRows ?? []) as SubscriptionTier[];
      if (tiersData.length === 0) {
        setTiers([]);
        setLoading(false);
        return;
      }

      const tierIds = tiersData.map((t) => t.id);

      const { data: priceRows } = await supabase
        .from("subscription_tier_prices")
        .select("id, tier_id, city, amount, currency, is_active")
        .in("tier_id", tierIds);

      const pricesData = (priceRows ?? []) as SubscriptionTierPrice[];

      const countsByTier: Record<string, number> = {};
      for (const id of tierIds) countsByTier[id] = 0;
      const { data: customerRows } = await supabase
        .from("customers")
        .select("subscription_tier_id")
        .is("archived_at", null);
      if (Array.isArray(customerRows)) {
        (customerRows as { subscription_tier_id: string | null }[]).forEach((row) => {
          if (row.subscription_tier_id && countsByTier[row.subscription_tier_id] != null) {
            countsByTier[row.subscription_tier_id] += 1;
          }
        });
      }

      const merged: TierWithPrices[] = tiersData.map((t) => ({
        ...t,
        prices: pricesData.filter((p) => p.tier_id === t.id),
        customerCount: countsByTier[t.id] ?? 0,
      }));

      setTiers(merged);
      setLoading(false);
    }

    load();
  }, [router]);

  async function handleCreateTier() {
    if (!formName.trim() || !formCity.trim() || formAmount === "") return;
    setSavingTier(true);
    const supabase = createClient();

    const { data: tierRow, error: tierError } = await supabase
      .from("subscription_tiers")
      .insert({
        name: formName.trim(),
        description: formDescription.trim() || null,
        is_custom: formIsCustom,
      })
      .select("id, name, description, is_custom, is_active, created_at, updated_at")
      .single();

    if (tierError || !tierRow) {
      setError("Failed to create tier.");
      setSavingTier(false);
      return;
    }

    const tier = tierRow as SubscriptionTier;

    const { data: priceRow, error: priceError } = await supabase
      .from("subscription_tier_prices")
      .insert({
        tier_id: tier.id,
        city: formCity.trim(),
        amount: Number(formAmount),
      })
      .select("id, tier_id, city, amount, currency, is_active")
      .single();

    setSavingTier(false);

    if (priceError || !priceRow) {
      setError("Tier created, but failed to save city price.");
      return;
    }

    const price = priceRow as SubscriptionTierPrice;

    setTiers((prev) => [
      ...prev,
      {
        ...tier,
        prices: [price],
        customerCount: 0,
      },
    ]);

    setFormName("");
    setFormDescription("");
    setFormIsCustom(false);
    setFormCity("");
    setFormAmount("");

    void logClientAdminActivity({
      action: "subscription.tier_created",
      resourceType: "subscription_tier",
      resourceId: tier.id,
      summary: `Created tier "${tier.name}" with ${formCity.trim()} price`,
    });
  }

  async function handleToggleActive(tier: TierWithPrices) {
    const supabase = createClient();
    const { error } = await supabase
      .from("subscription_tiers")
      .update({ is_active: !tier.is_active })
      .eq("id", tier.id);
    if (error) return;
    setTiers((prev) =>
      prev.map((t) => (t.id === tier.id ? { ...t, is_active: !t.is_active } : t)),
    );
    void logClientAdminActivity({
      action: "subscription.tier_toggled",
      resourceType: "subscription_tier",
      resourceId: tier.id,
      summary: `${!tier.is_active ? "Activated" : "Deactivated"} tier "${tier.name}"`,
    });
  }

  async function handleSaveEdit(tier: TierWithPrices) {
    setSavingTier(true);
    const supabase = createClient();

    const { error: tierError } = await supabase
      .from("subscription_tiers")
      .update({
        name: tier.name,
        description: tier.description,
        is_custom: tier.is_custom,
      })
      .eq("id", tier.id);

    if (tierError) {
      setSavingTier(false);
      return;
    }

    for (const p of tier.prices) {
      await supabase
        .from("subscription_tier_prices")
        .update({ amount: p.amount, city: p.city })
        .eq("id", p.id);
    }

    setSavingTier(false);
    setEditingTierId(null);

    void logClientAdminActivity({
      action: "subscription.tier_updated",
      resourceType: "subscription_tier",
      resourceId: tier.id,
      summary: `Updated tier "${tier.name}" and prices`,
    });
  }

  async function handleAddCityPrice(tier: TierWithPrices) {
    if (!editCity.trim() || editAmount === "") return;
    const supabase = createClient();

    const { data, error } = await supabase
      .from("subscription_tier_prices")
      .insert({
        tier_id: tier.id,
        city: editCity.trim(),
        amount: Number(editAmount),
      })
      .select("id, tier_id, city, amount, currency, is_active")
      .single();

    if (error || !data) return;

    const price = data as SubscriptionTierPrice;
    setTiers((prev) =>
      prev.map((t) =>
        t.id === tier.id ? { ...t, prices: [...t.prices, price] } : t,
      ),
    );
    setEditCity("");
    setEditAmount("");

    void logClientAdminActivity({
      action: "subscription.price_added",
      resourceType: "subscription_tier",
      resourceId: tier.id,
      summary: `Added ${editCity.trim()} price to tier "${tier.name}"`,
    });
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Subscription Tiers</h1>
          <p className="mt-1 text-stone-600 text-sm">
            Manage your subscription pricing and features.
          </p>
        </div>
        <Link
          href="/dashboard/subscription/mismatches"
          className="text-sm font-medium text-violet-700 hover:underline shrink-0"
        >
          Package amount mismatches
        </Link>
      </div>

      <div className="mt-6 bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <p className="text-sm font-medium text-stone-900">Add new tier</p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Tier name (e.g. Tier Gold)"
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder="City (e.g. Chennai)"
              value={formCity}
              onChange={(event) => setFormCity(event.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <input
              type="number"
              placeholder="Amount"
              value={formAmount}
              onChange={(event) =>
                setFormAmount(event.target.value === "" ? "" : Number(event.target.value))
              }
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-xs text-stone-700">
              <input
                type="checkbox"
                checked={formIsCustom}
                onChange={(event) => setFormIsCustom(event.target.checked)}
                className="h-3 w-3 rounded border-stone-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Custom pricing tier</span>
            </label>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="button"
              disabled={savingTier || !formName.trim() || !formCity.trim() || formAmount === ""}
              onClick={handleCreateTier}
              className="inline-flex items-center rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {savingTier ? "Saving…" : "Add tier"}
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <p className="mt-6 text-stone-500" aria-live="polite">
          Loading tiers…
        </p>
      )}
      {!loading && error && (
        <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
      {!loading && !error && tiers.length === 0 && (
        <p className="mt-6 text-stone-500 text-sm">No tiers yet. Add your first tier above.</p>
      )}

      {!loading && !error && tiers.length > 0 && (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => {
            const isEditing = tier.id === editingTierId;
            const tone = tier.is_active ? "border-stone-200" : "border-stone-100 bg-stone-50";
            const firstPrice = tier.prices[0];
            return (
              <div
                key={tier.id}
                className={`rounded-xl border ${tone} p-4 flex flex-col justify-between`}
              >
                <div className="space-y-2">
                  {isEditing ? (
                    <input
                      type="text"
                      value={tier.name}
                      onChange={(event) =>
                        setTiers((prev) =>
                          prev.map((t) =>
                            t.id === tier.id ? { ...t, name: event.target.value } : t,
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <h2 className="text-sm font-semibold text-stone-900">
                      {tier.name}
                      {!tier.is_active && (
                        <span className="ml-2 text-xs font-medium text-stone-500">(Inactive)</span>
                      )}
                    </h2>
                  )}
                  <p className="text-xs text-stone-500">
                    {tier.is_custom ? "Custom pricing tier" : "Pricing tier"}
                  </p>
                  {firstPrice && (
                    <p className="mt-2 text-lg font-semibold text-violet-700">
                      ₹{Number(firstPrice.amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      <span className="ml-1 text-xs text-stone-500">
                        {firstPrice.city}
                        {tier.prices.length > 1 && ` +${tier.prices.length - 1} cities`}
                      </span>
                    </p>
                  )}
                  <div className="mt-2 space-y-1">
                    {isEditing ? (
                      <>
                        {tier.prices.map((p, index) => (
                          <div key={p.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="text"
                              value={p.city}
                              onChange={(event) =>
                                setTiers((prev) =>
                                  prev.map((t) =>
                                    t.id === tier.id
                                      ? {
                                          ...t,
                                          prices: t.prices.map((px, i) =>
                                            i === index ? { ...px, city: event.target.value } : px,
                                          ),
                                        }
                                      : t,
                                  ),
                                )
                              }
                              className="w-20 rounded border border-stone-300 px-2 py-1"
                            />
                            <input
                              type="number"
                              value={p.amount}
                              onChange={(event) =>
                                setTiers((prev) =>
                                  prev.map((t) =>
                                    t.id === tier.id
                                      ? {
                                          ...t,
                                          prices: t.prices.map((px, i) =>
                                            i === index
                                              ? { ...px, amount: Number(event.target.value) }
                                              : px,
                                          ),
                                        }
                                      : t,
                                  ),
                                )
                              }
                              className="w-24 rounded border border-stone-300 px-2 py-1"
                            />
                          </div>
                        ))}
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          <input
                            type="text"
                            placeholder="New city"
                            value={editCity}
                            onChange={(event) => setEditCity(event.target.value)}
                            className="w-20 rounded border border-stone-300 px-2 py-1"
                          />
                          <input
                            type="number"
                            placeholder="Amount"
                            value={editAmount}
                            onChange={(event) =>
                              setEditAmount(
                                event.target.value === "" ? "" : Number(event.target.value),
                              )
                            }
                            className="w-24 rounded border border-stone-300 px-2 py-1"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddCityPrice(tier)}
                            className="rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50"
                          >
                            Add city
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-stone-500">
                        {tier.prices.length === 0
                          ? "No city prices yet."
                          : tier.prices
                              .map(
                                (p) =>
                                  `${p.city}: ₹${Number(p.amount).toLocaleString("en-IN", {
                                    maximumFractionDigits: 0,
                                  })}`,
                              )
                              .join(" • ")}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-stone-500">
                    Assigned to <span className="font-medium text-stone-700">{tier.customerCount}</span>{" "}
                    customers
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 text-xs">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingTierId((prev) => (prev === tier.id ? null : tier.id))
                      }
                      className="text-violet-700 hover:underline"
                    >
                      {isEditing ? "Cancel" : "Edit"}
                    </button>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(tier)}
                        className="text-emerald-700 hover:underline"
                      >
                        Save
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(tier)}
                      className="text-stone-600 hover:underline"
                    >
                      {tier.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

