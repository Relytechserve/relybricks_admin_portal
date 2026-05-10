"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TxRow = {
  id: number;
  tx_date: string;
  particulars: string;
  withdrawal: number | null;
  deposit: number | null;
  balance: number | null;
  transaction_amount: number | null;
  source_file: string;
};

type InvoiceDraftLine = {
  transactionId: number;
  txDate: string;
  description: string;
  amount: number;
  sourceFile: string;
};

type Customer = {
  id: string;
  name: string;
  email: string | null;
};

export default function NewInvoicePage() {
  const router = useRouter();
  const [txIds, setTxIds] = useState<number[]>([]);

  const [rows, setRows] = useState<TxRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState<7 | 15 | 30>(7);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<InvoiceDraftLine[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [txRes, custRes] = await Promise.all([
        fetch("/api/financial-reconciliation/selected", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: txIds }),
        }),
        fetch("/api/customers/options"),
      ]);
      const txJson = await txRes.json().catch(() => ({}));
      const custJson = await custRes.json().catch(() => ({}));
      if (!txRes.ok) throw new Error(txJson.error || `Failed to load transactions (${txRes.status})`);
      if (!custRes.ok) throw new Error(custJson.error || `Failed to load customers (${custRes.status})`);
      const loadedRows = Array.isArray(txJson.rows) ? txJson.rows : [];
      setRows(loadedRows);
      setCustomers(Array.isArray(custJson.customers) ? custJson.customers : []);
      setLineItems(
        loadedRows.map((r: TxRow) => ({
          transactionId: r.id,
          txDate: r.tx_date,
          description: `${r.tx_date} - ${r.particulars}`,
          amount: Number(r.transaction_amount ?? 0),
          sourceFile: r.source_file,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tx") ?? "";
    const ids = raw
      .split(",")
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    setTxIds(ids);
  }, []);

  useEffect(() => {
    if (txIds.length === 0) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txIds.join(",")]);

  const total = lineItems.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  async function createDraft() {
    if (!customerId) {
      setError("Select a customer.");
      return;
    }
    if (rows.length === 0) {
      setError("No transactions selected.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices/from-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionIds: rows.map((r) => r.id),
          customerId,
          invoiceDate,
          paymentTermsDays: terms,
          notes,
          lineItems: lineItems.map((l) => ({
            transactionId: l.transactionId,
            description: l.description,
            amount: l.amount,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      alert(`Invoice draft created: ${json.invoice?.invoice_number}`);
      router.push("/dashboard/invoices");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create invoice.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-stone-900">Create invoice from transactions</h1>
        <p className="mt-1 text-sm text-stone-600">
          Milestone A: create draft invoices from selected reconciliation transactions.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-stone-600">Loading selected transactions...</p>
      ) : (
        <>
          <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-700">Customer</span>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.email ? `(${c.email})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-700">Invoice date</span>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-700">Payment terms</span>
                <select
                  value={terms}
                  onChange={(e) => setTerms(Number(e.target.value) as 7 | 15 | 30)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                >
                  <option value={7}>Net 7</option>
                  <option value={15}>Net 15</option>
                  <option value={30}>Net 30</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-stone-700">Notes (optional)</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-800">Selected transactions</h2>
              <span className="text-sm text-stone-700">Total: {total.toFixed(2)}</span>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-600">
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-left">Description (editable)</th>
                    <th className="px-2 py-1 text-left">Amount</th>
                    <th className="px-2 py-1 text-left">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((r, idx) => (
                    <tr key={r.transactionId} className="border-b border-stone-100">
                      <td className="px-2 py-1">{r.txDate}</td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={r.description}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)),
                            )
                          }
                          className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1">{Number(r.amount ?? 0).toFixed(2)}</td>
                      <td className="px-2 py-1 font-mono">{r.sourceFile}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={createDraft}
              disabled={creating || rows.length === 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Draft Invoice"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard/financial-reconciliation")}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
