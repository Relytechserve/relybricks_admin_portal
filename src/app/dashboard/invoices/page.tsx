"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type InvoiceRow = {
  id: number;
  invoice_number: string;
  customer_id: string;
  status: string;
  invoice_date: string;
  due_date: string;
  payment_terms_days: number;
  grand_total: number;
  created_at: string;
  customer?: {
    name?: string;
    email?: string | null;
  } | null;
  latestEmail?: {
    status: string;
    sentAt: string | null;
    recipientEmail: string;
  } | null;
};

type InvoiceStatus = "draft" | "generated" | "sent" | "paid" | "cancelled";

const NEXT_STATUS_OPTIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["generated", "cancelled"],
  generated: ["sent", "paid", "cancelled"],
  sent: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusChoice, setStatusChoice] = useState<Record<number, InvoiceStatus | "">>({});
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/invoices");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
        setRows(Array.isArray(json.invoices) ? json.invoices : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load invoices.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function updateStatus(id: number) {
    const nextStatus = statusChoice[id];
    if (!nextStatus) return;
    setUpdatingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      const updated = json.invoice as InvoiceRow;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      setStatusChoice((prev) => ({ ...prev, [id]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function sendEmail(id: number) {
    setSendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}/email`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: r.status === "paid" || r.status === "cancelled" ? r.status : "sent",
                latestEmail: {
                  status: "sent",
                  sentAt: new Date().toISOString(),
                  recipientEmail: json.recipient ?? r.customer?.email ?? "",
                },
              }
            : r,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invoice email.");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Invoices</h1>
          <p className="text-sm text-stone-600">Draft invoices created from reconciliation transactions.</p>
        </div>
        <Link
          href="/dashboard/financial-reconciliation"
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700"
        >
          Go to reconciliation
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-stone-600">Loading invoices...</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                <th className="px-3 py-2">Invoice no</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Invoice date</th>
                <th className="px-3 py-2">Due date</th>
                <th className="px-3 py-2">Terms</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100">
                  <td className="px-3 py-2 font-medium text-stone-800">{r.invoice_number}</td>
                  <td className="px-3 py-2 text-stone-700">{r.customer?.name ?? r.customer_id}</td>
                  <td className="px-3 py-2 capitalize">{r.status}</td>
                  <td className="px-3 py-2">{r.invoice_date}</td>
                  <td className="px-3 py-2">{r.due_date}</td>
                  <td className="px-3 py-2">Net {r.payment_terms_days}</td>
                  <td className="px-3 py-2">{Number(r.grand_total ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-[11px] text-stone-600">
                    {r.latestEmail ? (
                      <span>
                        {r.latestEmail.status} to {r.latestEmail.recipientEmail}
                      </span>
                    ) : (
                      <span className="text-stone-400">Not sent</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/invoices/${r.id}/pdf`}
                        className="rounded border border-stone-300 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        Download PDF
                      </a>
                      <select
                        value={statusChoice[r.id] ?? ""}
                        onChange={(e) =>
                          setStatusChoice((prev) => ({
                            ...prev,
                            [r.id]: e.target.value as InvoiceStatus | "",
                          }))
                        }
                        className="rounded border border-stone-300 bg-white px-2 py-1 text-[11px]"
                      >
                        <option value="">Change status...</option>
                        {(NEXT_STATUS_OPTIONS[r.status as InvoiceStatus] ?? []).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={sendingId === r.id}
                        onClick={() => sendEmail(r.id)}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-50"
                      >
                        {sendingId === r.id ? "Sending..." : "Email"}
                      </button>
                      <button
                        type="button"
                        disabled={!statusChoice[r.id] || updatingId === r.id}
                        onClick={() => updateStatus(r.id)}
                        className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 disabled:opacity-50"
                      >
                        {updatingId === r.id ? "Saving..." : "Apply"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
