"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import {
  isRenewalDueWithinDays,
  isRenewalOverdueActiveCustomer,
  maxRenewalDateByCustomer,
} from "@/lib/renewal-insights";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";

type CustomerSummary = {
  status: string;
  plan_type: string | null;
  next_renewal_date: string | null;
  package_revenue: number | null;
  subscription_date?: string | null;
  lifecycle_stage: string | null;
  payment_status: string | null;
  outstanding_amount: number | null;
  created_at?: string | null;
};

type DashboardStats = {
  totalCustomers: number;
  activeCustomers: number;
  upcomingRenewals: number;
  renewalOverdue: number;
  totalRevenue: number;
  churnRiskCustomers: number;
  overdueCustomers: number;
  totalProperties: number;
};

type MonthCustomer = { id: string; name: string; amount: number };
type MonthData = { month: string; label: string; revenue: number; customers: MonthCustomer[] };

type AdminActivityLogItem = {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  summary: string;
};

type DatePreset = "week" | "month" | "year" | "last_year" | "custom";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRelative(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<(CustomerSummary & { id?: string; name?: string })[]>([]);
  const [totalProperties, setTotalProperties] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedMonth, setSelectedMonth] = useState<MonthData | null>(null);
  const [maxRenewalByCustomer, setMaxRenewalByCustomer] = useState<Record<string, string>>({});
  const [activityLog, setActivityLog] = useState<AdminActivityLogItem[]>([]);
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

      const { data: customers, error: custError } = (await supabase
        .from("customers")
        .select(
          "id, status, plan_type, subscription_date, next_renewal_date, package_revenue, lifecycle_stage, payment_status, outstanding_amount, created_at, name",
        )
        .order("created_at", { ascending: false })
        .limit(10000)) as { data: (CustomerSummary & { id?: string; name?: string })[] | null; error: PostgrestError | null };

      if (custError) {
        setError("Failed to load dashboard data.");
        setLoading(false);
        return;
      }

      const list = customers ?? [];

      setCustomers(list);

      const { data: renewalRows } = await supabase
        .from("transactions")
        .select("customer_id, date")
        .eq("type", "renewal")
        .limit(10000);
      setMaxRenewalByCustomer(maxRenewalDateByCustomer((renewalRows ?? []) as { customer_id: string; date: string }[]));

      let propertiesCount = 0;
      const { count } = await supabase
        .from("customer_properties")
        .select("id", { count: "exact", head: true });
      if (count != null) propertiesCount = count;
      setTotalProperties(propertiesCount);

      const { data: activityRows, error: activityError } = await supabase
        .from("admin_activity_log")
        .select("id, created_at, actor_email, action, resource_type, resource_id, summary")
        .order("created_at", { ascending: false })
        .limit(30);
      if (!activityError && activityRows) {
        setActivityLog(activityRows as unknown as AdminActivityLogItem[]);
      } else {
        setActivityLog([]);
      }

      setLoading(false);
    }

    load();
  }, [router]);

  const { stats, chartData } = useMemo(() => {
    if (totalProperties == null) {
      return {
        stats: null,
        chartData: [] as MonthData[],
      };
    }

    const today = new Date();
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    if (datePreset === "week") {
      rangeEnd = today;
      rangeStart = new Date();
      rangeStart.setDate(today.getDate() - 6);
    } else if (datePreset === "month") {
      rangeEnd = today;
      rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (datePreset === "year") {
      rangeEnd = today;
      rangeStart = new Date(today.getFullYear(), 0, 1);
    } else if (datePreset === "last_year") {
      const lastYear = today.getFullYear() - 1;
      rangeStart = new Date(lastYear, 0, 1);
      rangeEnd = new Date(lastYear, 11, 31);
    } else if (datePreset === "custom") {
      rangeStart = customFrom ? new Date(customFrom) : null;
      rangeEnd = customTo ? new Date(customTo) : null;
    }

    const inRange = (d: Date | null) => {
      if (!d || Number.isNaN(d.getTime())) return false;
      if (rangeStart && d < rangeStart) return false;
      if (rangeEnd) {
        const endOfDay = new Date(rangeEnd);
        endOfDay.setHours(23, 59, 59, 999);
        if (d > endOfDay) return false;
      }
      return true;
    };

    // Headline metrics: full customer base (date filter only affects chart + period revenue)
    const totalCustomers = customers.length;
    const activeCustomers = customers.filter(
      (c) => (c.status ?? "").trim().toLowerCase() === "active",
    ).length;
    const upcomingRenewals = customers.filter((c) =>
      isRenewalDueWithinDays(c.next_renewal_date ?? null, 30),
    ).length;
    const renewalOverdue = customers.filter((c) => {
      const id = c.id;
      if (!id) return false;
      return isRenewalOverdueActiveCustomer(
        { status: c.status, next_renewal_date: c.next_renewal_date },
        maxRenewalByCustomer[id],
      );
    }).length;
    const churnRiskCustomers = customers.filter((c) => c.lifecycle_stage === "churn_risk").length;
    const overdueCustomers = customers.filter((c) => {
      if (c.payment_status === "overdue") return true;
      return (
        (c.outstanding_amount ?? 0) > 0 &&
        (c.status ?? "").trim().toLowerCase() === "active"
      );
    }).length;

    const byMonth: Record<number, number> = {};
    const byMonthCustomers: Record<number, MonthCustomer[]> = {};
    for (let m = 1; m <= 12; m++) {
      byMonth[m] = 0;
      byMonthCustomers[m] = [];
    }

    const addToMonth = (monthIndex1Based: number, c: CustomerSummary & { id?: string; name?: string }) => {
      if (!c.package_revenue || !c.id || !c.name) return;
      const amount = c.package_revenue;
      byMonth[monthIndex1Based] += amount;
      byMonthCustomers[monthIndex1Based].push({ id: c.id, name: c.name, amount });
    };

    customers.forEach((c) => {
      if (c.subscription_date) {
        const start = new Date(c.subscription_date);
        if (inRange(start)) {
          addToMonth(start.getMonth() + 1, c);
        }
      }

      if (c.next_renewal_date) {
        const renewal = new Date(c.next_renewal_date);
        if (inRange(renewal)) {
          addToMonth(renewal.getMonth() + 1, c);
        }
      }
    });

    const chartData: MonthData[] = MONTH_LABELS.map((label, i) => ({
      month: String(i + 1),
      label,
      revenue: byMonth[i + 1] ?? 0,
      customers: byMonthCustomers[i + 1] ?? [],
    }));

    const periodRevenue = chartData.reduce((sum, m) => sum + m.revenue, 0);

    const stats: DashboardStats = {
      totalCustomers,
      activeCustomers,
      upcomingRenewals,
      renewalOverdue,
      totalRevenue: periodRevenue,
      churnRiskCustomers,
      overdueCustomers,
      totalProperties,
    };

    return { stats, chartData };
  }, [customers, totalProperties, maxRenewalByCustomer, datePreset, customFrom, customTo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <p className="text-stone-500">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  const metricCards = [
    {
      label: "Total customers",
      value: stats.totalCustomers,
      icon: "customers",
      bg: "bg-violet-500",
    },
    {
      label: "Active customers",
      value: stats.activeCustomers,
      icon: "active",
      bg: "bg-emerald-500",
    },
    {
      label: "Revenue in period (₹)",
      value: stats.totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 }),
      icon: "revenue",
      bg: "bg-violet-500",
    },
    {
      label: "Properties",
      value: stats.totalProperties,
      icon: "properties",
      bg: "bg-amber-500",
    },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Dashboard Overview</h1>
          <p className="mt-1 text-stone-600">Filter your insights by time period.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={datePreset}
            onChange={(event) => setDatePreset(event.target.value as DatePreset)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs md:text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
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
                className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs md:text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <span className="text-xs text-stone-500">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs md:text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-stone-200 p-4 flex items-start gap-4"
          >
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${card.bg}`}
            >
              {card.icon === "customers" && (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
              {card.icon === "active" && (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {card.icon === "revenue" && (
                <span className="text-white font-bold text-lg">₹</span>
              )}
              {card.icon === "properties" && (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-stone-500">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold text-stone-900">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-stone-200 p-4">
          <h2 className="text-base font-semibold text-stone-900">Revenue insights</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Package revenue by calendar month when subscription start or next renewal falls in the
            selected period —{" "}
            {datePreset === "week" && "last 7 days"}
            {datePreset === "month" && "this month"}
            {datePreset === "year" && "this year"}
            {datePreset === "last_year" && "last year"}
            {datePreset === "custom" && "custom date range"}
          </p>
          <div className="mt-4 flex gap-4">
            <div className="flex-1 min-w-0 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#a8a29e" />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    stroke="#a8a29e"
                    allowDecimals={false}
                    tickFormatter={(v: number) =>
                      `₹${Math.round(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                    }
                  />
                  <Bar dataKey="revenue" fill="#14b8a6" radius={[4, 4, 0, 0]} name="Revenue">
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.month}
                        fill={selectedMonth?.month === entry.month ? "#0d9488" : "#14b8a6"}
                        onClick={() => setSelectedMonth((prev) => (prev?.month === entry.month ? null : entry))}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div
              className={`w-56 h-64 shrink-0 border border-stone-200 rounded-lg bg-stone-50 transition-opacity ${
                selectedMonth ? "opacity-100" : "opacity-40"
              }`}
            >
              {selectedMonth ? (
                <div className="p-3 h-full flex flex-col min-h-0">
                  <p className="text-sm font-semibold text-stone-900">{selectedMonth.label}</p>
                  <p className="text-xs text-stone-600 mt-0.5">
                    ₹{Math.round(selectedMonth.revenue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </p>
                  <div className="mt-2 flex-1 min-h-0 overflow-y-auto">
                    {selectedMonth.customers.length === 0 ? (
                      <p className="text-xs text-stone-500">No customers</p>
                    ) : (
                      <ul className="space-y-1.5 text-xs">
                        {selectedMonth.customers.map((c) => (
                          <li key={c.id}>
                            <Link
                              href={`/dashboard/customers/${c.id}`}
                              className="text-stone-800 hover:text-violet-600 hover:underline block truncate"
                              title={c.name}
                            >
                              {c.name}
                            </Link>
                            <span className="text-stone-500">₹{c.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 h-full flex items-center justify-center">
                  <p className="text-xs text-stone-500 text-center">Click a bar to see customers</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h2 className="text-base font-semibold text-stone-900">Recent activity</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Actions by all admins (newest first). Run the latest Supabase migration if this list is empty.
          </p>
          <ul className="mt-4 space-y-3 max-h-80 overflow-y-auto">
            {activityLog.length === 0 ? (
              <li className="text-sm text-stone-500">No logged activity yet.</li>
            ) : (
              activityLog.map((item) => {
                const customerHref =
                  item.resource_type === "customer" && item.resource_id
                    ? `/dashboard/customers/${encodeURIComponent(item.resource_id)}`
                    : null;
                return (
                  <li key={item.id} className="flex gap-3 text-sm">
                    <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-stone-900 font-medium leading-snug">{item.summary}</p>
                      <p className="text-stone-500 text-xs mt-0.5">
                        <span className="text-stone-600">{item.actor_email ?? "Admin"}</span>
                        <span className="mx-1">·</span>
                        {formatRelative(item.created_at)}
                        {customerHref && (
                          <>
                            <span className="mx-1">·</span>
                            <Link href={customerHref} className="text-violet-600 hover:underline">
                              Open customer
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <p className="text-sm text-amber-700 font-medium">Churn risk</p>
          <p className="mt-1 text-2xl font-semibold text-amber-900">{stats.churnRiskCustomers}</p>
          <p className="mt-1 text-xs text-amber-600">Lifecycle stage: churn_risk</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-700 font-medium">Overdue / outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-red-900">{stats.overdueCustomers}</p>
          <p className="mt-1 text-xs text-red-600">Requires follow-up</p>
        </div>
        <div className="bg-white rounded-xl border border-orange-200 p-4">
          <p className="text-sm text-orange-800 font-medium">Renewal overdue</p>
          <p className="mt-1 text-2xl font-semibold text-orange-900">{stats.renewalOverdue}</p>
          <p className="mt-1 text-xs text-orange-700">
            Active, past next renewal date, no renewal transaction on or after that date
          </p>
          <Link
            href="/dashboard/customers?renewal=overdue"
            className="text-xs text-violet-600 hover:underline mt-1 inline-block"
          >
            View customers →
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-sm text-stone-500">Renewals in 30 days</p>
          <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.upcomingRenewals}</p>
          <Link href="/dashboard/customers?renewal=soon" className="text-xs text-violet-600 hover:underline mt-1 inline-block">
            View customers →
          </Link>
        </div>
      </div>
    </div>
  );
}
