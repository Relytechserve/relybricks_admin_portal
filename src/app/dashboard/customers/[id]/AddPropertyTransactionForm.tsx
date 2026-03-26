"use client";

import { useState } from "react";

type TxType = "renewal" | "payment" | "other";

export type AddTxSuccessPayload = {
  nextRenewalDate?: string | null;
  data?: {
    id: string;
    type: TxType;
    amount: number | null;
    description: string | null;
    date: string;
    customer_property_id?: string | null;
  };
};

type Props = {
  customerId: string;
  /** null = legacy customer-level transaction (only when customer has no properties) */
  customerPropertyId: string | null;
  onSuccess: (payload: AddTxSuccessPayload) => void;
  onError: (message: string | null) => void;
  /** When true (e.g. archived customer), form is read-only */
  disabled?: boolean;
};

export default function AddPropertyTransactionForm({
  customerId,
  customerPropertyId,
  onSuccess,
  onError,
  disabled = false,
}: Props) {
  const [type, setType] = useState<TxType>("renewal");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (disabled) return;
    if (!date) return;
    setSaving(true);
    onError(null);
    const num =
      amount.trim() === "" ? null : Number(amount.trim());
    try {
      const res = await fetch(`/api/customers/${customerId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          date,
          amount: num != null && !Number.isNaN(num) ? num : null,
          description: description.trim() || null,
          customer_property_id: customerPropertyId,
        }),
      });
      const result = (await res.json()) as AddTxSuccessPayload & { error?: string };
      if (!res.ok) {
        onError(result.error ?? "Failed to add transaction.");
        return;
      }
      if (result.data) {
        onSuccess({ data: result.data, nextRenewalDate: result.nextRenewalDate });
        setAmount("");
        setDescription("");
        setDate(new Date().toISOString().slice(0, 10));
        setType("renewal");
      } else {
        onError("Failed to add transaction.");
      }
    } catch {
      onError("Failed to add transaction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
      <p className="text-[11px] font-medium text-stone-600">Log transaction</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-[10px] text-stone-500">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TxType)}
            disabled={disabled}
            className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="renewal">Renewal</option>
            <option value="payment">Payment</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-stone-500">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={disabled}
            className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1.5 text-xs disabled:opacity-50"
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-[10px] text-stone-500">Amount (optional)</label>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="INR"
            disabled={disabled}
            className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1.5 text-xs disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-[10px] text-stone-500">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            className="mt-0.5 w-full rounded border border-stone-300 px-2 py-1.5 text-xs disabled:opacity-50"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={disabled || saving || !date}
        className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-800 disabled:opacity-50"
      >
        {saving ? "Adding…" : "Add entry"}
      </button>
    </div>
  );
}
