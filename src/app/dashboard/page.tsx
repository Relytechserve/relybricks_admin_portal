"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import {
  buildBillingUnits,
  customerHasOverdueRenewalBilling,
  customerHasRenewalDueWithinDays,
  maxRenewalDateByCustomerProperty,
  todayYmdLocal,
  type BillingUnit,
} from "@/lib/renewal-insights";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
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

type MonthCustomer = {
  id: string;
  name: string;
  amount: number;
  kind: "realized" | "scheduled";
  unitKey: string;
};
type MonthData = {
  month: string;
  label: string;
  /** Realized (due / past) subscription revenue in this month */
  realized: number;
  /** Scheduled (future renewal date) — not realized yet */
  scheduled: number;
  revenue: number;
  customers: MonthCustomer[];
};

type AdminActivityLogItem = {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  summary: string;
};

type DatePreset = "week" | "month" | "year" | "next_year" | "last_year" | "custom";

type PropertyInsightRow = {
  id: string;
  customer_id: string;
  subscription_date: string | null;
  next_renewal_date: string | null;
  package_revenue: number | null;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Which calendar month receives this unit’s annual package: next renewal, else subscription start. */
function subscriptionAnchorYmd(u: BillingUnit): string | null {
  if (u.next_renewal_date) return u.next_renewal_date.slice(0, 10);
  if (u.subscription_date) return u.subscription_date.slice(0, 10);
  return null;
}

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
  const [propertyRows, setPropertyRows] = useState<PropertyInsightRow[]>([]);
  const [maxRenewalByUnit, setMaxRenewalByUnit] = useState<Record<string, string>>({});
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

      const [propRes, renewalRes] = await Promise.all([
        supabase
          .from("customer_properties")
          .select("id, customer_id, subscription_date, next_renewal_date, package_revenue")
          .limit(20000),
        supabase
          .from("transactions")
          .select("customer_id, customer_property_id, date")
          .eq("type", "renewal")
          .limit(20000),
      ]);
      setPropertyRows((propRes.data ?? []) as PropertyInsightRow[]);
      setMaxRenewalByUnit(
        maxRenewalDateByCustomerProperty(
          (renewalRes.data ?? []) as {
            customer_id: string;
            customer_property_id: string | null;
            date: string;
          }[],
        ),
      );

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
      // Full calendar month so future renewal dates in this month still appear on the chart
      rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
      rangeEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    } else if (datePreset === "year") {
      // Full calendar year (not year-to-date) so renewals scheduled later in the year count
      rangeStart = new Date(today.getFullYear(), 0, 1);
      rangeEnd = new Date(today.getFullYear(), 11, 31);
    } else if (datePreset === "next_year") {
      const y = today.getFullYear() + 1;
      rangeStart = new Date(y, 0, 1);
      rangeEnd = new Date(y, 11, 31);
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
    const billingUnits = buildBillingUnits(
      customers.filter((c): c is CustomerSummary & { id: string; name?: string } =>
        typeof c.id === "string",
      ),
      propertyRows,
    );

    const upcomingRenewals = customers.filter((c) => {
      if (!c.id) return false;
      return customerHasRenewalDueWithinDays(c.id, billingUnits, 30);
    }).length;
    const renewalOverdue = customers.filter((c) => {
      if (!c.id) return false;
      return customerHasOverdueRenewalBilling(c.id, billingUnits, maxRenewalByUnit);
    }).length;
    const churnRiskCustomers = customers.filter((c) => c.lifecycle_stage === "churn_risk").length;
    const overdueCustomers = customers.filter((c) => {
      if (c.payment_status === "overdue") return true;
      return (
        (c.outstanding_amount ?? 0) > 0 &&
        (c.status ?? "").trim().toLowerCase() === "active"
      );
    }).length;

    const byMonthRealized: Record<number, number> = {};
    const byMonthScheduled: Record<number, number> = {};
    const byMonthCustomers: Record<number, MonthCustomer[]> = {};
    for (let m = 1; m <= 12; m++) {
      byMonthRealized[m] = 0;
      byMonthScheduled[m] = 0;
      byMonthCustomers[m] = [];
    }

    const todayYmd = todayYmdLocal();

    const addToMonth = (
      monthIndex1Based: number,
      u: BillingUnit,
      kind: "realized" | "scheduled",
    ) => {
      if (!u.package_revenue || !u.customerId || !u.customerName) return;
      const amount = u.package_revenue;
      const unitKey = `${u.customerId}|${u.propertyId ?? "legacy"}`;
      if (kind === "scheduled") {
        byMonthScheduled[monthIndex1Based] += amount;
      } else {
        byMonthRealized[monthIndex1Based] += amount;
      }
      byMonthCustomers[monthIndex1Based].push({
        id: u.customerId,
        name: u.customerName,
        amount,
        kind,
        unitKey,
      });
    };

    billingUnits.forEach((u) => {
      const anchor = subscriptionAnchorYmd(u);
      if (!anchor) return;
      const d = new Date(`${anchor}T12:00:00`);
      if (!inRange(d)) return;
      const kind: "realized" | "scheduled" = anchor > todayYmd ? "scheduled" : "realized";
      addToMonth(d.getMonth() + 1, u, kind);
    });

    const chartData: MonthData[] = MONTH_LABELS.map((label, i) => {
      const realized = byMonthRealized[i + 1] ?? 0;
      const scheduled = byMonthScheduled[i + 1] ?? 0;
      return {
        month: String(i + 1),
        label,
        realized,
        scheduled,
        revenue: realized + scheduled,
        customers: byMonthCustomers[i + 1] ?? [],
      };
    });

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
  }, [customers, totalProperties, propertyRows, maxRenewalByUnit, datePreset, customFrom, customTo]);

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
      label: "Subscription revenue in selected range (₹)",
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
            <option value="next_year">Next calendar year</option>
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
          <h2 className="text-base font-semibold text-stone-900">Subscription revenue</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Annual package amount per billing unit in the month of its next renewal (or subscription start
            if no renewal date). Each property rolls up separately; legacy customers without properties use
            the customer row.             <span className="font-medium text-stone-600">Teal</span> is realized or due
            today; <span className="font-medium text-stone-600">amber</span> is scheduled (future renewal).
            Bars are Jan–Dec; amounts only accrue in months inside the selected period —{" "}
            {datePreset === "week" && "last 7 days"}
            {datePreset === "month" && "this calendar month (full month)"}
            {datePreset === "year" && "this calendar year (Jan–Dec, including future months)"}
            {datePreset === "next_year" && "next calendar year"}
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
                  <Tooltip
                    formatter={(value, name) => [
                      `₹${Math.round(Number(value ?? 0)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
                      name ?? "",
                    ]}
                    labelFormatter={(label) => label}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar
                    dataKey="realized"
                    stackId="sub"
                    name="Realized / due"
                    radius={[0, 0, 0, 0]}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={`r-${entry.month}`}
                        fill={selectedMonth?.month === entry.month ? "#0f766e" : "#0d9488"}
                        onClick={() =>
                          setSelectedMonth((prev) => (prev?.month === entry.month ? null : entry))
                        }
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="scheduled"
                    stackId="sub"
                    name="Scheduled (future)"
                    radius={[4, 4, 0, 0]}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={`s-${entry.month}`}
                        fill={selectedMonth?.month === entry.month ? "#d97706" : "#fbbf24"}
                        onClick={() =>
                          setSelectedMonth((prev) => (prev?.month === entry.month ? null : entry))
                        }
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-stone-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-teal-600" aria-hidden />
                  Realized / due
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" aria-hidden />
                  Scheduled (not yet realized)
                </span>
              </div>
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
                    Total ₹
                    {Math.round(selectedMonth.revenue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </p>
                  {(selectedMonth.realized > 0 || selectedMonth.scheduled > 0) && (
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {selectedMonth.realized > 0 && (
                        <span>
                          Realized ₹
                          {Math.round(selectedMonth.realized).toLocaleString("en-IN", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      )}
                      {selectedMonth.realized > 0 && selectedMonth.scheduled > 0 && " · "}
                      {selectedMonth.scheduled > 0 && (
                        <span>
                          Scheduled ₹
                          {Math.round(selectedMonth.scheduled).toLocaleString("en-IN", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      )}
                    </p>
                  )}
                  <div className="mt-2 flex-1 min-h-0 overflow-y-auto">
                    {selectedMonth.customers.length === 0 ? (
                      <p className="text-xs text-stone-500">No customers</p>
                    ) : (
                      <ul className="space-y-1.5 text-xs">
                        {selectedMonth.customers.map((c) => (
                          <li key={c.unitKey}>
                            <Link
                              href={`/dashboard/customers/${c.id}`}
                              className="text-stone-800 hover:text-violet-600 hover:underline block truncate"
                              title={c.name}
                            >
                              {c.name}
                            </Link>
                            <span className="text-stone-500">
                              ₹{c.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                              {c.kind === "scheduled" && (
                                <span className="ml-1 text-amber-700">(scheduled)</span>
                              )}
                            </span>
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
            Active customer with at least one property (or legacy account) past its next renewal and no
            renewal transaction logged for that line on or after the due date
          </p>
          <Link
            href="/dashboard/customers?renewal=overdue"
            className="text-xs text-violet-600 hover:underline mt-1 inline-block"
          >
            View customers →
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-sm text-stone-500">Customers with renewal in 30 days</p>
          <p className="mt-1 text-2xl font-semibold text-stone-900">{stats.upcomingRenewals}</p>
          <p className="mt-1 text-xs text-stone-500">
            Any property (or legacy row) due within 30 days counts once per customer
          </p>
          <Link href="/dashboard/customers?renewal=soon" className="text-xs text-violet-600 hover:underline mt-1 inline-block">
            View customers →
          </Link>
        </div>
      </div>
    </div>
  );
}
