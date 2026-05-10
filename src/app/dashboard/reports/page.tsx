"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

type DatePreset = "week" | "month" | "year" | "last_year" | "custom";

function buildQuery(from: string, to: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

type BankPlMonth = {
  year: number;
  month: number;
  label: string;
  subscriptionInflows: number;
  otherDepositInflows: number;
  totalDeposits: number;
  withdrawals: number;
  netCashFlow: number;
  matchedSubscriptionTxns: number;
  otherDepositTxns: number;
  withdrawalTxns: number;
};

type BankPlYear = {
  year: number;
  subscriptionInflows: number;
  otherDepositInflows: number;
  totalDeposits: number;
  withdrawals: number;
  netCashFlow: number;
  matchedSubscriptionTxns: number;
};

type BankPlTotals = {
  totalIncoming: number;
  totalOutgoing: number;
  net: number;
  depositTransactionCount: number;
  withdrawalTransactionCount: number;
};

type BankPlPayload = {
  totals: BankPlTotals | null;
  monthly: BankPlMonth[];
  yearly: BankPlYear[];
  comparisons: {
    mom: {
      monthLabel: string;
      subscriptionPct: number | null;
      totalDepositsPct: number | null;
      netCashFlowPct: number | null;
    } | null;
    yoy: {
      monthLabel: string;
      subscriptionPct: number | null;
      totalDepositsPct: number | null;
      netCashFlowPct: number | null;
    } | null;
  };
  notes: string[];
};

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

type TopWithdrawalRow = {
  normalizedKey: string;
  particulars: string;
  occurrenceCount: number;
  totalWithdrawn: number;
};

type LargeWithdrawalRow = {
  id: number;
  tx_date: string;
  amount: number;
  particulars: string;
  source_file: string;
};

type DepositCustomerMatchRow = {
  id: number;
  tx_date: string;
  deposit: number;
  particulars: string;
  source_file: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchKind: string;
  manualCustomerId: string | null;
  suggestedCustomerId: string | null;
  suggestedCustomerName: string | null;
  suggestedMatchKind: string;
};

type CustomerPickRow = { id: string; name: string; email: string };

export default function ReportsPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [bankPlLoading, setBankPlLoading] = useState(false);
  const [bankPlError, setBankPlError] = useState<string | null>(null);
  const [bankPl, setBankPl] = useState<BankPlPayload | null>(null);
  const [bankPlFrom, setBankPlFrom] = useState("");
  const [bankPlTo, setBankPlTo] = useState("");
  const [toleranceAbs, setToleranceAbs] = useState("200");
  const [tolerancePct, setTolerancePct] = useState("10");

  const [topWdLoading, setTopWdLoading] = useState(false);
  const [topWdError, setTopWdError] = useState<string | null>(null);
  const [topWdRows, setTopWdRows] = useState<TopWithdrawalRow[]>([]);
  /** Empty = no minimum; otherwise only count withdrawal lines ≥ this amount in the pattern aggregation */
  const [wdMinLineAmount, setWdMinLineAmount] = useState("");
  const [wdSortBy, setWdSortBy] = useState<"frequency" | "volume">("frequency");

  const [largeWdLoading, setLargeWdLoading] = useState(false);
  const [largeWdRows, setLargeWdRows] = useState<LargeWithdrawalRow[]>([]);
  const [largeWdTotalMatching, setLargeWdTotalMatching] = useState<number | null>(null);
  const [largeWdMinAmount, setLargeWdMinAmount] = useState("10000");

  const [depCustLoading, setDepCustLoading] = useState(false);
  const [depCustError, setDepCustError] = useState<string | null>(null);
  const [depCustRows, setDepCustRows] = useState<DepositCustomerMatchRow[]>([]);
  const [depCustCustomerCount, setDepCustCustomerCount] = useState<number | null>(null);
  const [depCustLimit, setDepCustLimit] = useState("200");
  const [depCustFrom, setDepCustFrom] = useState("");
  const [depCustTo, setDepCustTo] = useState("");
  const [depCustMatchFilter, setDepCustMatchFilter] = useState<"all" | "matched" | "unknown">("all");
  const [depCustPicklist, setDepCustPicklist] = useState<CustomerPickRow[]>([]);
  const [assignmentDraftByTx, setAssignmentDraftByTx] = useState<Record<number, string>>({});
  const [depCustSavingId, setDepCustSavingId] = useState<number | null>(null);

  useEffect(() => {
    async function loadPicklist() {
      try {
        const res = await fetch("/api/customers/options", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const list = Array.isArray(json.customers) ? json.customers : [];
        setDepCustPicklist(
          list.map((x: Record<string, unknown>) => ({
            id: String(x.id ?? ""),
            name: String(x.name ?? ""),
            email: String(x.email ?? ""),
          })),
        );
      } catch {
        /* silent */
      }
    }
    void loadPicklist();
  }, []);

  useEffect(() => {
    setAssignmentDraftByTx((prev) => {
      const ids = new Set(depCustRows.map((r) => r.id));
      const next = { ...prev };
      for (const r of depCustRows) {
        if (next[r.id] === undefined) next[r.id] = r.manualCustomerId ?? "";
      }
      for (const k of Object.keys(next)) {
        const nid = Number(k);
        if (!ids.has(nid)) delete next[nid];
      }
      return next;
    });
  }, [depCustRows]);

  const depCustFilteredRows = useMemo(() => {
    if (depCustMatchFilter === "all") return depCustRows;
    const isMatched = (r: DepositCustomerMatchRow) => Boolean(r.matchedCustomerId && r.matchedCustomerName);
    if (depCustMatchFilter === "matched") return depCustRows.filter(isMatched);
    return depCustRows.filter((r) => !isMatched(r));
  }, [depCustRows, depCustMatchFilter]);

  const loadDepositCustomerMatches = useCallback(async () => {
    setDepCustLoading(true);
    setDepCustError(null);
    try {
      const params = new URLSearchParams();
      const lim = Number.parseInt(depCustLimit.trim(), 10);
      params.set("limit", Number.isFinite(lim) && lim > 0 ? String(Math.min(500, lim)) : "200");
      if (depCustFrom.trim()) params.set("from", depCustFrom.trim());
      if (depCustTo.trim()) params.set("to", depCustTo.trim());
      const res = await fetch(`/api/reports/deposit-customer-matches?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Request failed (${res.status})`);

      const rowsRaw = Array.isArray(json.rows) ? json.rows : [];
      setDepCustRows(
        rowsRaw.map((x: Record<string, unknown>) => ({
          id: Number(x.id ?? 0),
          tx_date: String(x.tx_date ?? ""),
          deposit: Number(x.deposit ?? 0),
          particulars: String(x.particulars ?? ""),
          source_file: String(x.source_file ?? ""),
          matchedCustomerId: typeof x.matchedCustomerId === "string" ? x.matchedCustomerId : null,
          matchedCustomerName: typeof x.matchedCustomerName === "string" ? x.matchedCustomerName : null,
          matchKind: String(x.matchKind ?? "unknown"),
          manualCustomerId: typeof x.manualCustomerId === "string" ? x.manualCustomerId : null,
          suggestedCustomerId: typeof x.suggestedCustomerId === "string" ? x.suggestedCustomerId : null,
          suggestedCustomerName: typeof x.suggestedCustomerName === "string" ? x.suggestedCustomerName : null,
          suggestedMatchKind: String(x.suggestedMatchKind ?? "unknown"),
        })),
      );
      setDepCustCustomerCount(typeof json.customerCount === "number" ? json.customerCount : null);
    } catch (e) {
      setDepCustError(e instanceof Error ? e.message : "Could not load deposit matches.");
      setDepCustRows([]);
      setDepCustCustomerCount(null);
    } finally {
      setDepCustLoading(false);
    }
  }, [depCustLimit, depCustFrom, depCustTo]);

  useEffect(() => {
    void loadDepositCustomerMatches();
  }, [loadDepositCustomerMatches]);

  const saveDepositCustomerAssignment = useCallback(
    async (transactionId: number) => {
      const raw = assignmentDraftByTx[transactionId] ?? "";
      const customerId = raw.trim() === "" ? null : raw.trim();
      setDepCustSavingId(transactionId);
      setDepCustError(null);
      try {
        const res = await fetch("/api/financial-reconciliation/transaction-customer", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId, customerId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Save failed (${res.status})`);
        await loadDepositCustomerMatches();
      } catch (e) {
        setDepCustError(e instanceof Error ? e.message : "Could not save assignment.");
      } finally {
        setDepCustSavingId(null);
      }
    },
    [assignmentDraftByTx, loadDepositCustomerMatches],
  );

  const loadWithdrawalAnalytics = useCallback(async () => {
    setTopWdLoading(true);
    setLargeWdLoading(true);
    setTopWdError(null);
    try {
      const topParams = new URLSearchParams();
      topParams.set("limit", "10");
      topParams.set("sortBy", wdSortBy);
      const minLine = Number(wdMinLineAmount);
      if (wdMinLineAmount.trim() !== "" && Number.isFinite(minLine) && minLine > 0) {
        topParams.set("minLineAmount", String(minLine));
      }

      const largeParams = new URLSearchParams();
      const largeMin = Number(largeWdMinAmount);
      largeParams.set("minAmount", Number.isFinite(largeMin) && largeMin > 0 ? String(largeMin) : "10000");
      largeParams.set("limit", "50");

      const fetchOpts = { cache: "no-store" } satisfies RequestInit;
      const [topRes, largeRes] = await Promise.all([
        fetch(`/api/reports/top-withdrawals?${topParams.toString()}`, fetchOpts),
        fetch(`/api/reports/large-withdrawals?${largeParams.toString()}`, fetchOpts),
      ]);
      const topJson = await topRes.json().catch(() => ({}));
      const largeJson = await largeRes.json().catch(() => ({}));
      if (!topRes.ok) throw new Error(typeof topJson.error === "string" ? topJson.error : `Top patterns failed (${topRes.status})`);
      if (!largeRes.ok)
        throw new Error(typeof largeJson.error === "string" ? largeJson.error : `Large debits failed (${largeRes.status})`);

      const rows = Array.isArray(topJson.rows) ? topJson.rows : [];
      setTopWdRows(
        rows.map((x: Record<string, unknown>) => ({
          normalizedKey: String(x.normalizedKey ?? ""),
          particulars: String(x.particulars ?? ""),
          occurrenceCount: Number(x.occurrenceCount ?? 0),
          totalWithdrawn: Number(x.totalWithdrawn ?? 0),
        })),
      );

      setLargeWdRows(
        Array.isArray(largeJson.rows)
          ? largeJson.rows.map((x: Record<string, unknown>) => ({
              id: Number(x.id ?? 0),
              tx_date: String(x.tx_date ?? ""),
              amount: Number(x.amount ?? 0),
              particulars: String(x.particulars ?? ""),
              source_file: String(x.source_file ?? ""),
            }))
          : [],
      );
      setLargeWdTotalMatching(typeof largeJson.rowCount === "number" ? largeJson.rowCount : null);
    } catch (e) {
      setTopWdError(e instanceof Error ? e.message : "Could not load withdrawal stats.");
      setTopWdRows([]);
      setLargeWdRows([]);
      setLargeWdTotalMatching(null);
    } finally {
      setTopWdLoading(false);
      setLargeWdLoading(false);
    }
  }, [wdMinLineAmount, wdSortBy, largeWdMinAmount]);

  useEffect(() => {
    void loadWithdrawalAnalytics();
  }, [loadWithdrawalAnalytics]);

  const today = new Date();
  const defaultFrom =
    datePreset === "week"
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
      : datePreset === "month"
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : datePreset === "last_year"
          ? new Date(today.getFullYear() - 1, 0, 1)
          : new Date(today.getFullYear(), 0, 1);

  const resolvedFrom =
    datePreset === "custom" ? customFrom : defaultFrom.toISOString().slice(0, 10);
  const resolvedTo =
    datePreset === "custom"
      ? customTo
      : datePreset === "last_year"
        ? new Date(today.getFullYear() - 1, 11, 31).toISOString().slice(0, 10)
        : today.toISOString().slice(0, 10);

  function handleDownloadCompany() {
    const query = buildQuery(resolvedFrom, resolvedTo);
    window.location.href = `/api/reports/company${query}`;
  }

  const loadBankPl = useCallback(async () => {
    setBankPlLoading(true);
    setBankPlError(null);
    try {
      const params = new URLSearchParams();
      if (bankPlFrom.trim()) params.set("from", bankPlFrom.trim());
      if (bankPlTo.trim()) params.set("to", bankPlTo.trim());
      const abs = Number(toleranceAbs);
      const pct = Number(tolerancePct);
      if (Number.isFinite(abs)) params.set("toleranceAbs", String(abs));
      if (Number.isFinite(pct)) params.set("tolerancePct", String(pct));
      const q = params.toString();
      const res = await fetch(`/api/reports/bank-pl${q ? `?${q}` : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `Failed (${res.status})`);
      setBankPl({
        totals:
          json.totals && typeof json.totals === "object"
            ? {
                totalIncoming: Number(json.totals.totalIncoming ?? 0),
                totalOutgoing: Number(json.totals.totalOutgoing ?? 0),
                net: Number(json.totals.net ?? 0),
                depositTransactionCount: Number(json.totals.depositTransactionCount ?? 0),
                withdrawalTransactionCount: Number(json.totals.withdrawalTransactionCount ?? 0),
              }
            : null,
        monthly: Array.isArray(json.monthly) ? json.monthly : [],
        yearly: Array.isArray(json.yearly) ? json.yearly : [],
        comparisons: json.comparisons ?? { mom: null, yoy: null },
        notes: Array.isArray(json.notes) ? json.notes : [],
      });
    } catch (e) {
      setBankPlError(e instanceof Error ? e.message : "Could not load bank P&L.");
      setBankPl(null);
    } finally {
      setBankPlLoading(false);
    }
  }, [bankPlFrom, bankPlTo, toleranceAbs, tolerancePct]);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-stone-900">Reports</h1>
        <p className="mt-1 text-sm text-stone-600">
          Export insights and customer data into Excel for deeper analysis and sharing.
        </p>
      </div>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Company-level report</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Export the same customer insights you see on the dashboard, filtered by date.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={datePreset}
              onChange={(event) => setDatePreset(event.target.value as DatePreset)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
              <option value="last_year">Last year</option>
              <option value="custom">Custom range</option>
            </select>
            {datePreset === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <span className="text-xs text-stone-500">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-600 max-w-xl">
            The export includes basic customer information, subscription and revenue fields, and key status
            indicators for the selected period.
          </p>
          <button
            type="button"
            onClick={handleDownloadCompany}
            className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-500"
          >
            Download Excel
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h2 className="text-base font-semibold text-stone-900">Customer-level report</h2>
        <p className="text-xs text-stone-600">
          To export a detailed report for a specific customer (including subscription, financials, and notes),
          open the customer&apos;s detail page and use the{" "}
          <span className="font-medium text-stone-800">Export to Excel</span> action.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Bank statement P&amp;L (subscription matching)</h2>
            <p className="text-xs text-stone-500 mt-0.5 max-w-2xl">
              Classifies deposits using customer names in transaction particulars and amount vs catalog tier price
              or package revenue (± absolute or % tolerance). Shows monthly and yearly totals, with MoM and YoY
              on the latest month in range.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-stone-700">From (optional)</span>
            <input
              type="date"
              value={bankPlFrom}
              onChange={(e) => setBankPlFrom(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-stone-700">To (optional)</span>
            <input
              type="date"
              value={bankPlTo}
              onChange={(e) => setBankPlTo(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-stone-700">Amount tolerance (₹)</span>
            <input
              type="number"
              min={0}
              value={toleranceAbs}
              onChange={(e) => setToleranceAbs(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-stone-700">Amount tolerance (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={tolerancePct}
              onChange={(e) => setTolerancePct(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadBankPl()}
            disabled={bankPlLoading}
            className="inline-flex items-center rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-stone-800 disabled:opacity-60"
          >
            {bankPlLoading ? "Loading…" : "Load P&L from bank data"}
          </button>
        </div>

        {bankPlError && <p className="text-sm text-red-600">{bankPlError}</p>}

        {bankPl?.totals && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[11px] font-medium text-emerald-800">Total incoming (deposits)</p>
              <p className="text-lg font-semibold text-emerald-950">{bankPl.totals.totalIncoming.toFixed(2)}</p>
              <p className="text-[11px] text-emerald-700">{bankPl.totals.depositTransactionCount} credit lines</p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-[11px] font-medium text-rose-800">Total outgoing (withdrawals)</p>
              <p className="text-lg font-semibold text-rose-950">{bankPl.totals.totalOutgoing.toFixed(2)}</p>
              <p className="text-[11px] text-rose-700">{bankPl.totals.withdrawalTransactionCount} debit lines</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 sm:col-span-2 lg:col-span-2">
              <p className="text-[11px] font-medium text-stone-700">Net (incoming − outgoing)</p>
              <p className="text-lg font-semibold text-stone-900">{bankPl.totals.net.toFixed(2)}</p>
              <p className="text-[11px] text-stone-500">Across the same date range as the tables below.</p>
            </div>
          </div>
        )}

        {bankPl && bankPl.monthly.length > 0 && bankPl.comparisons.mom && (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-800 space-y-1">
            <p className="font-semibold text-stone-900">Latest month in range: {bankPl.comparisons.mom.monthLabel}</p>
            <p>
              MoM subscription inflows: {fmtPct(bankPl.comparisons.mom.subscriptionPct)} · MoM total deposits:{" "}
              {fmtPct(bankPl.comparisons.mom.totalDepositsPct)} · MoM net cash flow:{" "}
              {fmtPct(bankPl.comparisons.mom.netCashFlowPct)}
            </p>
            {bankPl.comparisons.yoy ? (
              <p>
                YoY subscription inflows: {fmtPct(bankPl.comparisons.yoy.subscriptionPct)} · YoY total deposits:{" "}
                {fmtPct(bankPl.comparisons.yoy.totalDepositsPct)} · YoY net cash flow:{" "}
                {fmtPct(bankPl.comparisons.yoy.netCashFlowPct)}
              </p>
            ) : (
              <p className="text-stone-500">YoY: no data for the same month in the prior year.</p>
            )}
          </div>
        )}

        {bankPl && bankPl.monthly.length > 0 && (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bankPl.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="subscriptionInflows" name="Subscription (matched)" fill="#7c3aed" stackId="dep" />
                <Bar dataKey="otherDepositInflows" name="Other deposits" fill="#a8a29e" stackId="dep" />
                <Bar dataKey="withdrawals" name="Withdrawals" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {bankPl && bankPl.monthly.length > 0 && (
          <div className="overflow-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                  <th className="px-2 py-1.5">Month</th>
                  <th className="px-2 py-1.5">Subscription in</th>
                  <th className="px-2 py-1.5">Other deposits</th>
                  <th className="px-2 py-1.5">Withdrawals</th>
                  <th className="px-2 py-1.5">Net cash</th>
                  <th className="px-2 py-1.5">Sub txns</th>
                </tr>
              </thead>
              <tbody>
                {[...bankPl.monthly].reverse().map((r) => (
                  <tr key={`${r.year}-${r.month}`} className="border-b border-stone-100">
                    <td className="px-2 py-1">{r.label}</td>
                    <td className="px-2 py-1">{r.subscriptionInflows.toFixed(2)}</td>
                    <td className="px-2 py-1">{r.otherDepositInflows.toFixed(2)}</td>
                    <td className="px-2 py-1">{r.withdrawals.toFixed(2)}</td>
                    <td className="px-2 py-1 font-medium">{r.netCashFlow.toFixed(2)}</td>
                    <td className="px-2 py-1">{r.matchedSubscriptionTxns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bankPl && bankPl.yearly.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-stone-800 mb-2">Yearly rollup</h3>
            <div className="overflow-auto rounded-lg border border-stone-200">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                    <th className="px-2 py-1.5">Year</th>
                    <th className="px-2 py-1.5">Subscription in</th>
                    <th className="px-2 py-1.5">Other deposits</th>
                    <th className="px-2 py-1.5">Withdrawals</th>
                    <th className="px-2 py-1.5">Net cash</th>
                  </tr>
                </thead>
                <tbody>
                  {bankPl.yearly.map((r) => (
                    <tr key={r.year} className="border-b border-stone-100">
                      <td className="px-2 py-1">{r.year}</td>
                      <td className="px-2 py-1">{r.subscriptionInflows.toFixed(2)}</td>
                      <td className="px-2 py-1">{r.otherDepositInflows.toFixed(2)}</td>
                      <td className="px-2 py-1">{r.withdrawals.toFixed(2)}</td>
                      <td className="px-2 py-1 font-medium">{r.netCashFlow.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {bankPl && bankPl.notes.length > 0 && (
          <ul className="list-disc pl-4 text-[11px] text-stone-500 space-y-0.5">
            {bankPl.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        {bankPl && bankPl.monthly.length === 0 && !bankPlLoading && (
          <p className="text-xs text-stone-500">No bank transactions in the selected range.</p>
        )}
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="max-w-2xl space-y-1">
            <h2 className="text-base font-semibold text-stone-900">Incoming deposits — customer name matching</h2>
            <p className="text-xs text-stone-600">
              Each row is a <span className="font-medium text-stone-800">deposit</span> line from reconciliation (
              <code className="text-[11px]">flow = deposit</code>, amount in{" "}
              <code className="text-[11px]">deposit</code>). We suggest a customer by matching active customer{" "}
              <span className="font-medium">name</span> tokens to <span className="font-medium">particulars</span>. Use the
              assign column to <span className="font-medium">override</span> (saved on the transaction); clearing the
              assignment returns to the automatic suggestion. Unmatched lines show{" "}
              <span className="font-medium text-stone-800">unknown</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDepositCustomerMatches()}
            disabled={depCustLoading}
            className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
          >
            {depCustLoading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-stone-700">Row limit</span>
            <input
              type="number"
              min={1}
              max={500}
              value={depCustLimit}
              onChange={(e) => setDepCustLimit(e.target.value)}
              className="w-24 rounded border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-stone-700">From (optional)</span>
            <input
              type="date"
              value={depCustFrom}
              onChange={(e) => setDepCustFrom(e.target.value)}
              className="rounded border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-stone-700">To (optional)</span>
            <input
              type="date"
              value={depCustTo}
              onChange={(e) => setDepCustTo(e.target.value)}
              className="rounded border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-stone-700">Match</span>
            <select
              value={depCustMatchFilter}
              onChange={(e) => setDepCustMatchFilter(e.target.value as "all" | "matched" | "unknown")}
              className="rounded border border-stone-300 bg-white px-2 py-1 min-w-[10rem]"
            >
              <option value="all">All deposits</option>
              <option value="matched">Matched only</option>
              <option value="unknown">Unknown only</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadDepositCustomerMatches()}
            disabled={depCustLoading}
            className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
          >
            Apply
          </button>
        </div>

        {depCustCustomerCount != null && (
          <p className="text-[11px] text-stone-500">
            Active customers loaded for matching: <span className="font-medium text-stone-800">{depCustCustomerCount}</span>
          </p>
        )}

        {depCustError && <p className="text-sm text-red-600">{depCustError}</p>}

        {depCustLoading && depCustRows.length === 0 ? (
          <p className="text-xs text-stone-600">Loading deposit rows…</p>
        ) : depCustRows.length > 0 && depCustFilteredRows.length === 0 ? (
          <p className="text-xs text-stone-500">
            No rows match the selected filter (&quot;
            {depCustMatchFilter === "matched" ? "Matched only" : "Unknown only"}&quot;). Try &quot;All deposits&quot;
            or load more rows.
          </p>
        ) : depCustRows.length > 0 ? (
          <>
            {depCustMatchFilter !== "all" && (
              <p className="text-[11px] text-stone-600">
                Showing <span className="font-medium text-stone-800">{depCustFilteredRows.length}</span> of{" "}
                <span className="font-medium text-stone-800">{depCustRows.length}</span> loaded rows.
              </p>
            )}
            <div className="overflow-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                  <th className="px-3 py-2 whitespace-nowrap">Date</th>
                  <th className="px-3 py-2 whitespace-nowrap">Deposit (₹)</th>
                  <th className="px-3 py-2">Matched customer</th>
                  <th className="px-3 py-2 whitespace-nowrap">Match</th>
                  <th className="px-3 py-2">Particulars</th>
                  <th className="px-3 py-2">Source file</th>
                  <th className="px-3 py-2 min-w-[12rem]">Assign customer</th>
                </tr>
              </thead>
              <tbody>
                {depCustFilteredRows.map((r) => {
                  const hasMatch = Boolean(r.matchedCustomerId && r.matchedCustomerName);
                  const displayName =
                    hasMatch && r.matchedCustomerName ? r.matchedCustomerName : "unknown";
                  const selectValue = assignmentDraftByTx[r.id] ?? r.manualCustomerId ?? "";
                  const suggestedLine =
                    r.suggestedCustomerName && r.suggestedMatchKind !== "unknown"
                      ? `${r.suggestedCustomerName} (${r.suggestedMatchKind})`
                      : r.suggestedMatchKind === "unknown"
                        ? "unknown"
                        : r.suggestedCustomerName ?? "—";
                  return (
                    <tr key={r.id} className="border-b border-stone-100 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-stone-700">{r.tx_date}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-stone-900">{r.deposit.toFixed(2)}</td>
                      <td className="px-3 py-2 text-stone-800">
                        {hasMatch && r.matchedCustomerId ? (
                          <Link
                            href={`/dashboard/customers/${r.matchedCustomerId}`}
                            className="font-medium text-violet-700 hover:underline"
                          >
                            {displayName}
                          </Link>
                        ) : (
                          <span className="text-stone-500 italic">unknown</span>
                        )}
                        {r.manualCustomerId && (
                          <span className="mt-1 block text-[10px] font-medium text-amber-800">Manual override</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-stone-600">
                        <span>{r.matchKind === "unknown" ? "unknown" : r.matchKind}</span>
                        {r.manualCustomerId ? (
                          <span className="mt-1 block text-[10px] text-stone-500">
                            Auto guess: {suggestedLine}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-stone-800 max-w-xl">{r.particulars}</td>
                      <td className="px-3 py-2 font-mono text-stone-600 text-[11px]">{r.source_file}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-col gap-1 min-w-[11rem]">
                          <select
                            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-[11px] text-stone-800 max-w-[14rem]"
                            value={selectValue}
                            disabled={depCustSavingId !== null || depCustPicklist.length === 0}
                            onChange={(e) =>
                              setAssignmentDraftByTx((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                          >
                            <option value="">— Clear (use suggestion) —</option>
                            {depCustPicklist.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.email ? ` · ${c.email}` : ""}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={
                              depCustSavingId !== null ||
                              selectValue.trim() === (r.manualCustomerId ?? "").trim()
                            }
                            onClick={() => void saveDepositCustomerAssignment(r.id)}
                            className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                          >
                            {depCustSavingId === r.id ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          !depCustLoading && (
            <p className="text-xs text-stone-500">
              No incoming deposit rows in range, or reconciliation has not been scanned yet.
            </p>
          )
        )}
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Outgoing transactions (withdrawals)</h2>
            <p className="text-xs text-stone-500 mt-0.5 max-w-2xl">
              Understand where debits go: repeat payees by description text, large one-off debits, and optional filters
              (e.g. only lines ≥ ₹10,000) so you can focus on material outflows.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadWithdrawalAnalytics()}
            disabled={topWdLoading || largeWdLoading}
            className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
          >
            {topWdLoading || largeWdLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-stone-700">Pattern table — min per line (₹):</span>
          <input
            type="number"
            min={0}
            placeholder="Any"
            value={wdMinLineAmount}
            onChange={(e) => setWdMinLineAmount(e.target.value)}
            className="w-24 rounded border border-stone-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => setWdMinLineAmount("10000")}
            className="rounded border border-violet-300 bg-violet-50 px-2 py-1 font-medium text-violet-800"
          >
            Preset ₹10,000
          </button>
          <button
            type="button"
            onClick={() => setWdMinLineAmount("")}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-stone-700"
          >
            Clear min
          </button>
          <span className="text-stone-400">|</span>
          <span className="font-medium text-stone-700">Rank patterns by:</span>
          <select
            value={wdSortBy}
            onChange={(e) => setWdSortBy(e.target.value as "frequency" | "volume")}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
          >
            <option value="frequency">Occurrences (how often)</option>
            <option value="volume">Total ₹ (where money went in aggregate)</option>
          </select>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950 space-y-1.5">
          <p className="font-semibold text-amber-900">Ways to slice this further</p>
          <ul className="list-disc pl-4 space-y-0.5 text-amber-950/90">
            <li>
              <span className="font-medium">Volume vs frequency</span> — same payee may be rare but huge; use{" "}
              <em>Total ₹</em> ranking to see where most cash left the account by description.
            </li>
            <li>
              <span className="font-medium">Large single debits</span> — use the table below to audit transfers above
              your threshold (default ₹10,000).
            </li>
            <li>
              <span className="font-medium">Time</span> — compare monthly &quot;Withdrawals&quot; in the bank P&amp;L
              chart above, then drill into that period in reconciliation export if needed.
            </li>
            <li>
              <span className="font-medium">Rules later</span> — tag merchants (e.g. rent, payroll, taxes) in
              particulars keywords for a categorized spend report.
            </li>
          </ul>
        </div>

        {topWdError && <p className="text-sm text-red-600">{topWdError}</p>}

        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-1">
            Top 10 description patterns
            {wdSortBy === "volume" ? " (by total ₹)" : " (by count)"}
            {wdMinLineAmount.trim() !== "" && Number(wdMinLineAmount) > 0
              ? ` — only lines ≥ ₹${wdMinLineAmount} each`
              : ""}
          </h3>
          {topWdLoading && topWdRows.length === 0 ? (
            <p className="text-xs text-stone-600">Loading…</p>
          ) : topWdRows.length > 0 ? (
            <div className="overflow-auto rounded-lg border border-stone-200">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                    <th className="px-3 py-2 w-10">#</th>
                    <th className="px-3 py-2">Particulars (sample)</th>
                    <th className="px-3 py-2 whitespace-nowrap">Occurrences</th>
                    <th className="px-3 py-2 whitespace-nowrap">Total withdrawn (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {topWdRows.map((r, i) => (
                    <tr key={r.normalizedKey || `row-${i}`} className="border-b border-stone-100 align-top">
                      <td className="px-3 py-2 text-stone-500">{i + 1}</td>
                      <td className="px-3 py-2 text-stone-800 max-w-xl">{r.particulars}</td>
                      <td className="px-3 py-2 font-medium text-stone-900">{r.occurrenceCount}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.totalWithdrawn.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !topWdLoading && (
              <p className="text-xs text-stone-500">No withdrawal rows match the current filters, or no data ingested.</p>
            )
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-stone-800">Largest single debits</h3>
            <button
              type="button"
              onClick={() => void loadWithdrawalAnalytics()}
              disabled={topWdLoading || largeWdLoading}
              className="rounded border border-stone-300 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {largeWdLoading || topWdLoading ? "Refreshing…" : "Refresh from DB"}
            </button>
            <label className="flex items-center gap-1 text-xs text-stone-600">
              Show lines ≥
              <input
                type="number"
                min={1}
                value={largeWdMinAmount}
                onChange={(e) => setLargeWdMinAmount(e.target.value)}
                className="w-24 rounded border border-stone-300 px-2 py-0.5 text-xs"
              />
              ₹ (up to 50 rows)
            </label>
          </div>
          <p className="text-[11px] text-stone-500 mb-2">
            Rows are loaded with{" "}
            <span className="font-medium text-stone-700">WHERE withdrawal ≥ threshold</span> in the database; amounts
            shown are the <span className="font-medium text-stone-700">withdrawal</span> field only (never deposit).{" "}
            {largeWdTotalMatching != null && (
              <>
                <span className="font-medium text-stone-700">{largeWdTotalMatching}</span> lines match this threshold.
              </>
            )}
          </p>
          {largeWdLoading && largeWdRows.length === 0 ? (
            <p className="text-xs text-stone-600">Loading large debits…</p>
          ) : largeWdRows.length > 0 ? (
            <div className="overflow-auto rounded-lg border border-stone-200">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                    <th className="px-3 py-2 whitespace-nowrap">Date</th>
                    <th className="px-3 py-2 whitespace-nowrap">Amount (₹)</th>
                    <th className="px-3 py-2">Particulars</th>
                    <th className="px-3 py-2">Source file</th>
                  </tr>
                </thead>
                <tbody>
                  {largeWdRows.map((r) => (
                    <tr key={r.id} className="border-b border-stone-100 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-stone-600">{r.tx_date}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.amount.toFixed(2)}</td>
                      <td className="px-3 py-2 text-stone-800 max-w-md">{r.particulars}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-stone-600">{r.source_file}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !largeWdLoading && (
              <p className="text-xs text-stone-500">No debits at or above this threshold in reconciliation data.</p>
            )
          )}
        </div>
      </section>
    </div>
  );
}

