import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";
import type { ReconciliationFilters } from "@/lib/financial-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TABLE = "financial_reconciliation_transactions";

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseFiltersFromBody(body: Record<string, unknown>): ReconciliationFilters {
  const flowRaw = body.flow;
  const flow = flowRaw === "withdrawal" || flowRaw === "all" ? flowRaw : "deposit";
  const parseNumber = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    dateFrom: typeof body.dateFrom === "string" ? body.dateFrom : undefined,
    dateTo: typeof body.dateTo === "string" ? body.dateTo : undefined,
    flow,
    particulars: typeof body.particulars === "string" ? body.particulars.trim() : undefined,
    amountEquals: parseNumber(body.amountEquals),
    amountMin: parseNumber(body.amountMin),
    amountMax: parseNumber(body.amountMax),
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local." },
      { status: 500 },
    );
  }

  let json: Record<string, unknown>;
  try {
    json = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const filters = parseFiltersFromBody(json);
  const page = parsePositiveInt(json.page, 1);
  const pageSize = Math.min(parsePositiveInt(json.pageSize, 100), 500);

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let query = serviceClient
    .from(TABLE)
    .select(
      "id, source_file, source_page, source_line, statement_period, tx_date, particulars, chq_ref_no, withdrawal, deposit, balance, transaction_amount, flow",
    )
    .order("tx_date", { ascending: false })
    .order("id", { ascending: false });
  let countQuery = serviceClient.from(TABLE).select("id", { count: "exact", head: true });

  if (filters.flow && filters.flow !== "all") {
    query = query.eq("flow", filters.flow);
    countQuery = countQuery.eq("flow", filters.flow);
  }
  if (filters.dateFrom) {
    query = query.gte("tx_date", filters.dateFrom);
    countQuery = countQuery.gte("tx_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("tx_date", filters.dateTo);
    countQuery = countQuery.lte("tx_date", filters.dateTo);
  }
  if (filters.particulars) {
    query = query.ilike("particulars", `%${filters.particulars}%`);
    countQuery = countQuery.ilike("particulars", `%${filters.particulars}%`);
  }
  if (filters.amountEquals != null) {
    query = query.eq("transaction_amount", filters.amountEquals);
    countQuery = countQuery.eq("transaction_amount", filters.amountEquals);
  } else {
    if (filters.amountMin != null) {
      query = query.gte("transaction_amount", filters.amountMin);
      countQuery = countQuery.gte("transaction_amount", filters.amountMin);
    }
    if (filters.amountMax != null) {
      query = query.lte("transaction_amount", filters.amountMax);
      countQuery = countQuery.lte("transaction_amount", filters.amountMax);
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const [{ data, error: listError }, { count, error: countError }] = await Promise.all([
    query.range(from, to),
    countQuery,
  ]);
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  const rows = (data ?? []).map((r) => ({
    id: String(r.id),
    relativePath: r.source_file,
    pageNumber: r.source_page,
    lineIndex: r.source_line ?? 0,
    date: r.tx_date,
    particulars: r.particulars,
    chqRefNo: r.chq_ref_no,
    withdrawal: r.withdrawal,
    deposit: r.deposit,
    balance: r.balance,
    transactionAmount: r.transaction_amount,
    flow: r.flow,
    statementPeriod: r.statement_period,
  }));

  return NextResponse.json({
    rows,
    totalMatchedRows: count ?? rows.length,
    currentPage: page,
    pageSize,
  });
}
