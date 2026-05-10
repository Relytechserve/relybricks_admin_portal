import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { TierPriceRow } from "@/lib/subscription-tier-pricing";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  matchSubscriptionDeposit,
  type CustomerForBankMatch,
} from "@/lib/bank-subscription-match";
import { withdrawalAmountFromRow } from "@/lib/reconciliation-withdrawal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type FrtRow = {
  tx_date: string;
  particulars: string;
  deposit: number | null;
  withdrawal: number | null;
  transaction_amount: number | null;
  flow: string;
};

function depositAmt(row: FrtRow): number {
  if (row.flow === "withdrawal") return 0;
  const d = row.deposit != null ? Number(row.deposit) : NaN;
  if (Number.isFinite(d) && d > 0) return d;
  const t = Number(row.transaction_amount ?? 0);
  if (row.flow === "deposit" && t > 0) return t;
  if (row.flow === "unknown" && t > 0) return t;
  return 0;
}

function withdrawalAmt(row: FrtRow): number {
  return withdrawalAmountFromRow(row);
}

function monthKey(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / prior) * 100;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const fromStr = url.searchParams.get("from") ?? "";
  const toStr = url.searchParams.get("to") ?? "";
  const absTol = Math.max(0, Number(url.searchParams.get("toleranceAbs") ?? 200));
  const pctTol = Math.max(0, Math.min(100, Number(url.searchParams.get("tolerancePct") ?? 10)));

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local." },
      { status: 500 },
    );
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /** Omit `customer_location` so the report works if that migration is not applied yet. */
  const customerSelect = `
    id,
    name,
    subscription_tier_id,
    package_revenue,
    property_city,
    customer_properties (
      subscription_tier_id,
      package_revenue,
      city
    )
  `;

  const [{ data: customerRows, error: custErr }, { data: priceRows, error: priceErr }] =
    await Promise.all([
      serviceClient.from("customers").select(customerSelect).is("archived_at", null),
      serviceClient.from("subscription_tier_prices").select("tier_id, city, amount, is_active"),
    ]);

  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });
  if (priceErr) return NextResponse.json({ error: priceErr.message }, { status: 500 });

  const customers = (customerRows ?? []) as unknown as CustomerForBankMatch[];
  const tierPrices = (priceRows ?? []) as TierPriceRow[];

  let totalIncoming = 0;
  let totalOutgoing = 0;
  let depositTxnCount = 0;
  let withdrawalTxnCount = 0;

  const monthlyMap = new Map<
    string,
    {
      subscriptionInflows: number;
      otherDepositInflows: number;
      withdrawals: number;
      matchedCount: number;
      otherDepositCount: number;
      withdrawalCount: number;
    }
  >();

  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    let q = serviceClient
      .from("financial_reconciliation_transactions")
      .select("tx_date, particulars, deposit, withdrawal, transaction_amount, flow")
      .order("tx_date", { ascending: true });

    if (fromStr) q = q.gte("tx_date", fromStr);
    if (toStr) q = q.lte("tx_date", toStr);

    const { data: batch, error: batchError } = await q.range(offset, offset + pageSize - 1);
    if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });
    const rows = (batch ?? []) as FrtRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = monthKey(row.tx_date);
      if (!key) continue;

      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, {
          subscriptionInflows: 0,
          otherDepositInflows: 0,
          withdrawals: 0,
          matchedCount: 0,
          otherDepositCount: 0,
          withdrawalCount: 0,
        });
      }
      const bucket = monthlyMap.get(key)!;

      const inAmt = depositAmt(row);
      const outAmt = withdrawalAmt(row);

      if (inAmt > 0) {
        totalIncoming += inAmt;
        depositTxnCount += 1;
        const m = matchSubscriptionDeposit(
          row.particulars,
          inAmt,
          customers,
          tierPrices,
          absTol,
          pctTol,
        );
        if (m) {
          bucket.subscriptionInflows += inAmt;
          bucket.matchedCount += 1;
        } else {
          bucket.otherDepositInflows += inAmt;
          bucket.otherDepositCount += 1;
        }
      }

      if (outAmt > 0) {
        totalOutgoing += outAmt;
        withdrawalTxnCount += 1;
        bucket.withdrawals += outAmt;
        bucket.withdrawalCount += 1;
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const monthlyKeys = Array.from(monthlyMap.keys()).sort();
  const monthly = monthlyKeys.map((k) => {
    const [ys, ms] = k.split("-");
    const year = Number(ys);
    const month = Number(ms);
    const b = monthlyMap.get(k)!;
    const totalDeposits = b.subscriptionInflows + b.otherDepositInflows;
    const netCash = totalDeposits - b.withdrawals;
    return {
      year,
      month,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      subscriptionInflows: round2(b.subscriptionInflows),
      otherDepositInflows: round2(b.otherDepositInflows),
      totalDeposits: round2(totalDeposits),
      withdrawals: round2(b.withdrawals),
      netCashFlow: round2(netCash),
      matchedSubscriptionTxns: b.matchedCount,
      otherDepositTxns: b.otherDepositCount,
      withdrawalTxns: b.withdrawalCount,
    };
  });

  const yearlyMap = new Map<
    number,
    {
      subscriptionInflows: number;
      otherDepositInflows: number;
      withdrawals: number;
      matchedCount: number;
    }
  >();

  for (const m of monthly) {
    if (!yearlyMap.has(m.year)) {
      yearlyMap.set(m.year, {
        subscriptionInflows: 0,
        otherDepositInflows: 0,
        withdrawals: 0,
        matchedCount: 0,
      });
    }
    const yb = yearlyMap.get(m.year)!;
    yb.subscriptionInflows += m.subscriptionInflows;
    yb.otherDepositInflows += m.otherDepositInflows;
    yb.withdrawals += m.withdrawals;
    yb.matchedCount += m.matchedSubscriptionTxns;
  }

  const yearly = Array.from(yearlyMap.keys())
    .sort((a, b) => a - b)
    .map((year) => {
      const yb = yearlyMap.get(year)!;
      const totalDep = yb.subscriptionInflows + yb.otherDepositInflows;
      return {
        year,
        subscriptionInflows: round2(yb.subscriptionInflows),
        otherDepositInflows: round2(yb.otherDepositInflows),
        totalDeposits: round2(totalDep),
        withdrawals: round2(yb.withdrawals),
        netCashFlow: round2(totalDep - yb.withdrawals),
        matchedSubscriptionTxns: yb.matchedCount,
      };
    });

  const last = monthly[monthly.length - 1];
  let mom: {
    monthLabel: string;
    subscriptionPct: number | null;
    totalDepositsPct: number | null;
    netCashFlowPct: number | null;
  } | null = null;
  if (last && monthly.length >= 2) {
    const prev = monthly[monthly.length - 2];
    mom = {
      monthLabel: last.label,
      subscriptionPct: pctChange(last.subscriptionInflows, prev.subscriptionInflows),
      totalDepositsPct: pctChange(last.totalDeposits, prev.totalDeposits),
      netCashFlowPct: pctChange(last.netCashFlow, prev.netCashFlow),
    };
  }

  let yoy: {
    monthLabel: string;
    subscriptionPct: number | null;
    totalDepositsPct: number | null;
    netCashFlowPct: number | null;
  } | null = null;
  if (last) {
    const prior = monthly.find(
      (m) => m.year === last.year - 1 && m.month === last.month,
    );
    if (prior) {
      yoy = {
        monthLabel: last.label,
        subscriptionPct: pctChange(last.subscriptionInflows, prior.subscriptionInflows),
        totalDepositsPct: pctChange(last.totalDeposits, prior.totalDeposits),
        netCashFlowPct: pctChange(last.netCashFlow, prior.netCashFlow),
      };
    }
  }

  return NextResponse.json({
    params: {
      from: fromStr || null,
      to: toStr || null,
      toleranceAbs: absTol,
      tolerancePct: pctTol,
    },
    totals: {
      totalIncoming: round2(totalIncoming),
      totalOutgoing: round2(totalOutgoing),
      net: round2(totalIncoming - totalOutgoing),
      depositTransactionCount: depositTxnCount,
      withdrawalTransactionCount: withdrawalTxnCount,
    },
    monthly,
    yearly,
    comparisons: { mom, yoy },
    notes: [
      "Subscription inflows are deposit transactions where customer name appears in particulars and amount is within tolerance of catalog tier price or stored package revenue.",
      "P&L is cash-basis from bank lines: all deposits (split subscription vs other), withdrawals as outflows, net = deposits − withdrawals.",
    ],
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
