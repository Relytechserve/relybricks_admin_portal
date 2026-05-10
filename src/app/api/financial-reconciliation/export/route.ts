import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";
import type { ReconciliationFilters } from "@/lib/financial-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const TABLE = "financial_reconciliation_transactions";

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
    year: Number.isFinite(Number(body.year)) ? Number(body.year) : undefined,
    month: Number.isFinite(Number(body.month)) ? Number(body.month) : undefined,
  };
}


export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
      },
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
  if (filters.flow && filters.flow !== "all") query = query.eq("flow", filters.flow);
  if (filters.dateFrom) query = query.gte("tx_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("tx_date", filters.dateTo);
  if (filters.particulars) query = query.ilike("particulars", `%${filters.particulars}%`);
  if (filters.amountEquals != null) query = query.eq("transaction_amount", filters.amountEquals);
  else {
    if (filters.amountMin != null) query = query.gte("transaction_amount", filters.amountMin);
    if (filters.amountMax != null) query = query.lte("transaction_amount", filters.amountMax);
  }
  if (filters.year && filters.year >= 1900 && filters.year <= 9999) {
    const mm = filters.month && filters.month >= 1 && filters.month <= 12 ? filters.month : null;
    if (mm) {
      const from = `${filters.year}-${String(mm).padStart(2, "0")}-01`;
      const nextYear = mm === 12 ? filters.year + 1 : filters.year;
      const nextMonth = mm === 12 ? 1 : mm + 1;
      const toExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
      query = query.gte("tx_date", from).lt("tx_date", toExclusive);
    } else {
      const yearFrom = `${filters.year}-01-01`;
      const yearToExclusive = `${filters.year + 1}-01-01`;
      query = query.gte("tx_date", yearFrom).lt("tx_date", yearToExclusive);
    }
  }

  const { data: rows, error: listError } = await query.limit(50000);
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RelyBricks Admin";
  const sheet = workbook.addWorksheet("Matches");

  sheet.columns = [
    { header: "File", key: "file", width: 48 },
    { header: "Statement period (header)", key: "statementPeriod", width: 28 },
    { header: "Page", key: "pageNumber", width: 8 },
    { header: "Line", key: "line", width: 8 },
    { header: "Date", key: "date", width: 14 },
    { header: "Particulars", key: "particulars", width: 72 },
    { header: "Chq No/Ref No", key: "chqRefNo", width: 24 },
    { header: "Withdrawal", key: "withdrawal", width: 14 },
    { header: "Deposit", key: "deposit", width: 14 },
    { header: "Balance", key: "balance", width: 14 },
  ];

  for (const r of rows ?? []) {
    sheet.addRow({
      file: r.source_file,
      statementPeriod: r.statement_period ?? "",
      pageNumber: r.source_page ?? "",
      line: (r.source_line ?? 0) + 1,
      date: r.tx_date ?? "",
      particulars: r.particulars ?? "",
      chqRefNo: r.chq_ref_no ?? "",
      withdrawal: r.withdrawal ?? "",
      deposit: r.deposit ?? "",
      balance: r.balance ?? "",
    });
  }

  const meta = workbook.addWorksheet("Run info");
  meta.addRow(["Source", "Supabase: financial_reconciliation_transactions"]);
  meta.addRow(["Matched rows", (rows ?? []).length]);

  const buffer = await workbook.xlsx.writeBuffer();

  const filename = `financial-reconciliation-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
