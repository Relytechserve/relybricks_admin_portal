"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  relativePath: string;
  pageNumber: number | null;
  lineIndex: number;
  date: string;
  particulars: string;
  chqRefNo: string | null;
  withdrawal: number | null;
  deposit: number | null;
  balance: number | null;
  statementPeriod?: string | null;
};

type ScanPayload = {
  dateFrom: string;
  dateTo: string;
  flow: "all" | "deposit" | "withdrawal";
  particulars: string;
  amountEquals: string;
  amountMin: string;
  amountMax: string;
  year: string;
  month: string;
};

type SortBy = "date" | "withdrawal" | "deposit" | "balance";
type SortDir = "asc" | "desc";

function buildRequestBody(p: ScanPayload): Record<string, unknown> {
  const body: Record<string, unknown> = { flow: p.flow };
  if (p.dateFrom) body.dateFrom = p.dateFrom;
  if (p.dateTo) body.dateTo = p.dateTo;
  if (p.particulars.trim()) body.particulars = p.particulars.trim();
  if (p.amountEquals.trim()) body.amountEquals = Number.parseFloat(p.amountEquals);
  if (p.amountMin.trim()) body.amountMin = Number.parseFloat(p.amountMin);
  if (p.amountMax.trim()) body.amountMax = Number.parseFloat(p.amountMax);
  if (p.year.trim()) body.year = Number.parseInt(p.year, 10);
  if (p.month.trim()) body.month = Number.parseInt(p.month, 10);
  return body;
}

export default function FinancialReconciliationPage() {
  const [form, setForm] = useState<ScanPayload>({
    dateFrom: "",
    dateTo: "",
    flow: "deposit",
    particulars: "",
    amountEquals: "",
    amountMin: "",
    amountMax: "",
    year: "",
    month: "",
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [filesScanned, setFilesScanned] = useState<number | null>(null);
  const [totalMatchedRows, setTotalMatchedRows] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [scanErrors, setScanErrors] = useState<{ file: string; message: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lastMode, setLastMode] = useState<"scan" | "search">("scan");

  const hint = useMemo(
    () =>
      "Extracts structured rows from transaction-history tables across all statement files and persists in Supabase. Filter by date, amount, direction, and particulars text.",
    [],
  );

  const runScan = useCallback(async (pageOverride?: number) => {
    setLastMode("scan");
    const targetPage = pageOverride ?? currentPage;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/financial-reconciliation/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildRequestBody(form),
          page: targetPage,
          pageSize,
          sortBy,
          sortDir,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        rows?: unknown;
        filesScanned?: unknown;
        errors?: unknown;
        totalMatchedRows?: unknown;
        currentPage?: unknown;
        pageSize?: unknown;
        sortBy?: unknown;
        sortDir?: unknown;
      };
      if (!res.ok) {
        setRows([]);
        setFilesScanned(null);
        setTotalMatchedRows(null);
        setScanErrors([]);
        setError(
          typeof data.error === "string"
            ? data.error
            : `Scan failed (HTTP ${res.status}).`,
        );
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setFilesScanned(typeof data.filesScanned === "number" ? data.filesScanned : null);
      setTotalMatchedRows(typeof data.totalMatchedRows === "number" ? data.totalMatchedRows : null);
      setCurrentPage(typeof data.currentPage === "number" ? data.currentPage : targetPage);
      setPageSize(typeof data.pageSize === "number" ? data.pageSize : pageSize);
      setSortBy(
        data.sortBy === "withdrawal" || data.sortBy === "deposit" || data.sortBy === "balance" || data.sortBy === "date"
          ? data.sortBy
          : sortBy,
      );
      setSortDir(data.sortDir === "asc" || data.sortDir === "desc" ? data.sortDir : sortDir);
      setScanErrors(Array.isArray(data.errors) ? data.errors : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }, [currentPage, form, pageSize, sortBy, sortDir]);

  const runExport = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/financial-reconciliation/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(form)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Export failed.");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const match = cd?.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "financial-reconciliation.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [form]);

  const runSearchDb = useCallback(async (pageOverride?: number) => {
    setLastMode("search");
    const targetPage = pageOverride ?? currentPage;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/financial-reconciliation/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildRequestBody(form),
          page: targetPage,
          pageSize,
          sortBy,
          sortDir,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        rows?: unknown;
        totalMatchedRows?: unknown;
        currentPage?: unknown;
        pageSize?: unknown;
        sortBy?: unknown;
        sortDir?: unknown;
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Search failed (HTTP ${res.status}).`);
        return;
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotalMatchedRows(typeof data.totalMatchedRows === "number" ? data.totalMatchedRows : null);
      setCurrentPage(typeof data.currentPage === "number" ? data.currentPage : targetPage);
      setPageSize(typeof data.pageSize === "number" ? data.pageSize : pageSize);
      setSortBy(
        data.sortBy === "withdrawal" || data.sortBy === "deposit" || data.sortBy === "balance" || data.sortBy === "date"
          ? data.sortBy
          : sortBy,
      );
      setSortDir(data.sortDir === "asc" || data.sortDir === "desc" ? data.sortDir : sortDir);
      setFilesScanned(null);
      setScanErrors([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }, [currentPage, form, pageSize, sortBy, sortDir]);

  const toggleSort = useCallback((column: SortBy) => {
    setCurrentPage(1);
    setSortBy((prev) => {
      if (prev !== column) {
        setSortDir("desc");
        return column;
      }
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return prev;
    });
  }, []);

  const sortLabel = (column: SortBy) => {
    if (sortBy !== column) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  useEffect(() => {
    if (totalMatchedRows == null) return;
    if (lastMode === "scan") {
      void runScan(1);
    } else {
      void runSearchDb(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortDir]);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-stone-900">Financial reconciliation</h1>
        <p className="mt-1 text-sm text-stone-600">
          Extract Date, Particulars, Chq/Ref No, Withdrawal, Deposit, and Balance from statement transaction tables,
          then filter and export.
        </p>
      </div>

      <section className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
        <p className="text-xs text-stone-500">{hint}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium text-stone-700">Particulars contains</span>
            <input
              type="text"
              value={form.particulars}
              onChange={(e) => setForm((f) => ({ ...f, particulars: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Search text in particulars"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Year</span>
            <input
              type="number"
              min={2000}
              max={2100}
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. 2024"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Month</span>
            <select
              value={form.month}
              onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">All months</option>
              <option value="1">Jan</option>
              <option value="2">Feb</option>
              <option value="3">Mar</option>
              <option value="4">Apr</option>
              <option value="5">May</option>
              <option value="6">Jun</option>
              <option value="7">Jul</option>
              <option value="8">Aug</option>
              <option value="9">Sep</option>
              <option value="10">Oct</option>
              <option value="11">Nov</option>
              <option value="12">Dec</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Date from</span>
            <input
              type="date"
              value={form.dateFrom}
              onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Date to</span>
            <input
              type="date"
              value={form.dateTo}
              onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Transaction amount equals</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.amountEquals}
              onChange={(e) => setForm((f) => ({ ...f, amountEquals: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. 1000"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Transaction amount min</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.amountMin}
              onChange={(e) => setForm((f) => ({ ...f, amountMin: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-700">Transaction amount max</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.amountMax}
              onChange={(e) => setForm((f) => ({ ...f, amountMax: e.target.value }))}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs font-medium text-stone-700">Transaction direction</span>
            <select
              value={form.flow}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  flow: e.target.value as "all" | "deposit" | "withdrawal",
                }))
              }
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500 max-w-lg"
            >
              <option value="all">All (incoming and outgoing)</option>
              <option value="deposit">Deposits / credits only (incoming)</option>
              <option value="withdrawal">Withdrawals / debits only (outgoing)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runScan(1)}
            disabled={loading || searching}
            className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-500 disabled:opacity-60"
          >
            {loading ? "Scanning files…" : "Run scan (files -> DB)"}
          </button>
          <button
            type="button"
            onClick={() => runSearchDb(1)}
            disabled={searching || loading}
            className="inline-flex items-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search DB only"}
          </button>
          <button
            type="button"
            onClick={runExport}
            disabled={exporting || loading || searching}
            className="inline-flex items-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
          >
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </section>

      {filesScanned != null && (
        <p className="text-xs text-stone-600">
          Files scanned: <span className="font-medium text-stone-800">{filesScanned}</span> · Total matches:{" "}
          <span className="font-medium text-stone-800">{totalMatchedRows ?? rows.length}</span> · Preview shown:{" "}
          <span className="font-medium text-stone-800">{rows.length}</span>
          <span> (page {currentPage}, size {pageSize})</span>
        </p>
      )}

      {totalMatchedRows != null && totalMatchedRows > pageSize && (
        <div className="flex items-center gap-2 text-xs text-stone-700">
          <button
            type="button"
            onClick={() => (filesScanned != null ? runScan(Math.max(1, currentPage - 1)) : runSearchDb(Math.max(1, currentPage - 1)))}
            disabled={loading || searching || currentPage <= 1}
            className="rounded border border-stone-300 bg-white px-2 py-1 disabled:opacity-50"
          >
            Prev
          </button>
          <span>
            Page {currentPage} of {Math.max(1, Math.ceil(totalMatchedRows / pageSize))}
          </span>
          <button
            type="button"
            onClick={() => (filesScanned != null ? runScan(currentPage + 1) : runSearchDb(currentPage + 1))}
            disabled={loading || searching || currentPage >= Math.ceil(totalMatchedRows / pageSize)}
            className="rounded border border-stone-300 bg-white px-2 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {scanErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
          <p className="font-semibold">Some files could not be read</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {scanErrors.map((e) => (
              <li key={e.file + e.message}>
                <span className="font-mono">{e.file}</span>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Stmt period</th>
                <th className="px-3 py-2 font-medium">Page</th>
                <th className="px-3 py-2 font-medium">Line</th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("date")} className="hover:text-stone-900">
                    Date{sortLabel("date")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Particulars</th>
                <th className="px-3 py-2 font-medium">Chq No/Ref No</th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("withdrawal")} className="hover:text-stone-900">
                    Withdrawal{sortLabel("withdrawal")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("deposit")} className="hover:text-stone-900">
                    Deposit{sortLabel("deposit")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("balance")} className="hover:text-stone-900">
                    Balance{sortLabel("balance")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-stone-100 align-top">
                  <td className="px-3 py-2 font-mono text-stone-700 whitespace-nowrap">{r.relativePath}</td>
                  <td className="px-3 py-2 text-stone-600 text-[11px] max-w-[140px] truncate" title={r.statementPeriod ?? ""}>
                    {r.statementPeriod ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-stone-600">{r.pageNumber ?? "—"}</td>
                  <td className="px-3 py-2 text-stone-600">{r.lineIndex + 1}</td>
                  <td className="px-3 py-2 text-stone-600 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2 text-stone-800">{r.particulars}</td>
                  <td className="px-3 py-2 text-stone-600 whitespace-nowrap">{r.chqRefNo ?? "—"}</td>
                  <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{r.withdrawal ?? "—"}</td>
                  <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{r.deposit ?? "—"}</td>
                  <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{r.balance ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
