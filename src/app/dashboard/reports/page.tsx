"use client";

import { useState } from "react";

type DatePreset = "week" | "month" | "year" | "last_year" | "custom";

function buildQuery(from: string, to: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function ReportsPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

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
    </div>
  );
}

