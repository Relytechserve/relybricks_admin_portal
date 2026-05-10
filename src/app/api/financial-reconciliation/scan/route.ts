import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { existsSync, statSync } from "fs";
import { requireAdminSession } from "@/lib/require-admin-api";
import { scanStatements, type ReconciliationFilters } from "@/lib/financial-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const TABLE = "financial_reconciliation_transactions";
type SortBy = "date" | "withdrawal" | "deposit" | "balance";
type SortDir = "asc" | "desc";

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

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Clears `financial_reconciliation_transactions` and dependent invoice links.
 * Prefers DB RPC (truncate + sequence reset); falls back to deletes if the migration is not applied yet.
 */
async function resetFinancialReconciliationData(
  client: SupabaseClient,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error: rpcError } = await client.rpc("reset_financial_reconciliation_transactions");
  if (!rpcError) return { ok: true };

  const msg = rpcError.message ?? String(rpcError);
  const fnMissing =
    rpcError.code === "PGRST202" ||
    /could not find the function|function .* does not exist|schema cache/i.test(msg);
  if (!fnMissing) return { ok: false, message: msg };

  // PostgREST rejects unqualified DELETE calls; anchor each delete on bigint PK (service role bypasses RLS).
  const { error: delLinks } = await client.from("invoice_transaction_links").delete().gte("id", 1);
  if (delLinks) return { ok: false, message: delLinks.message };

  const { error: clearLines } = await client
    .from("invoice_line_items")
    .update({ source_transaction_id: null })
    .gte("id", 1)
    .not("source_transaction_id", "is", null);
  if (clearLines) return { ok: false, message: clearLines.message };

  const { error: delTx } = await client.from(TABLE).delete().gte("id", 1);
  if (delTx) return { ok: false, message: delTx.message };

  return { ok: true };
}

function parseSort(body: Record<string, unknown>): { sortBy: SortBy; sortDir: SortDir; dbColumn: string } {
  const sortByRaw = body.sortBy;
  const sortDirRaw = body.sortDir;
  const sortBy: SortBy =
    sortByRaw === "withdrawal" || sortByRaw === "deposit" || sortByRaw === "balance" ? sortByRaw : "date";
  const sortDir: SortDir = sortDirRaw === "asc" ? "asc" : "desc";
  const dbColumn =
    sortBy === "date" ? "tx_date" : sortBy === "withdrawal" ? "withdrawal" : sortBy === "deposit" ? "deposit" : "balance";
  return { sortBy, sortDir, dbColumn };
}


export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const root = (process.env.BANK_STATEMENTS_ROOT ?? "").trim();
  const password = (process.env.BANK_STATEMENT_PASSWORD ?? "").trim();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!root || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "BANK_STATEMENTS_ROOT, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY is empty. Locally: copy .env.example to .env.local and fill values (do not commit). On Vercel: Project → Settings → Environment Variables with the same names (Production + Preview). The scan reads PDF/CSV files from BANK_STATEMENTS_ROOT on whichever machine runs Next.js—not from your laptop when the deployed app runs on Vercel.",
      },
      { status: 500 },
    );
  }

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return NextResponse.json(
      {
        error: `BANK_STATEMENTS_ROOT is not an existing folder on this server: "${root}". Deployed Vercel functions cannot see paths on your Mac/PC. Run "Scan" from a local dev server with .env.local pointing at your statement folder, or change the app to read statements from cloud storage (e.g. Supabase Storage) instead of the filesystem.`,
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
  const page = parsePositiveInt(json.page, 1);
  const pageSize = Math.min(parsePositiveInt(json.pageSize, 100), 500);
  const sort = parseSort(json);
  const truncateBeforeScan = json.truncateBeforeScan === true;

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (truncateBeforeScan) {
      const reset = await resetFinancialReconciliationData(serviceClient);
      if (!reset.ok) {
        return NextResponse.json(
          { error: `Failed to truncate financial reconciliation data: ${reset.message}` },
          { status: 500 },
        );
      }
    }

    const extracted = await scanStatements(root, { flow: "all" }, password || undefined);

    const payload = extracted.rows.map((r) => {
      /** Stable per extracted line (not withdrawal/deposit) so re-parsing can fix swapped columns via upsert. */
      const fingerprint = createHash("sha256")
        .update(
          [
            r.relativePath,
            String(r.pageNumber ?? ""),
            String(r.lineIndex),
            r.date,
            r.particulars,
            r.chqRefNo ?? "",
            String(r.balance ?? ""),
          ].join("|"),
        )
        .digest("hex");
      return {
        fingerprint,
        source_file: r.relativePath,
        source_page: r.pageNumber,
        source_line: r.lineIndex,
        statement_period: r.statementPeriod ?? null,
        tx_date: r.date,
        particulars: r.particulars,
        chq_ref_no: r.chqRefNo ?? null,
        withdrawal: r.withdrawal,
        deposit: r.deposit,
        transaction_amount: r.transactionAmount,
        balance: r.balance,
        flow: r.flow,
        last_seen_at: new Date().toISOString(),
      };
    });

    if (payload.length > 0) {
      const fingerprintList = Array.from(new Set(payload.map((p) => p.fingerprint)));
      const { data: existingRows, error: existingErr } = await serviceClient
        .from(TABLE)
        .select("fingerprint, customer_id")
        .in("fingerprint", fingerprintList);
      if (existingErr) {
        return NextResponse.json({ error: existingErr.message }, { status: 500 });
      }
      const preservedCustomerByFp = new Map<string, string>();
      for (const row of existingRows ?? []) {
        const fp = String((row as { fingerprint?: string }).fingerprint ?? "");
        const cid = (row as { customer_id?: string | null }).customer_id;
        if (fp && typeof cid === "string" && cid.length > 0) preservedCustomerByFp.set(fp, cid);
      }
      /** Keep manual/report customer mapping across re-ingest when the fingerprint is unchanged */
      const payloadWithPreserved = payload.map((p) => {
        const cid = preservedCustomerByFp.get(p.fingerprint);
        return cid ? { ...p, customer_id: cid } : p;
      });

      const { error: upsertError } = await serviceClient
        .from(TABLE)
        .upsert(payloadWithPreserved, { onConflict: "fingerprint" });
      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    let query = serviceClient
      .from(TABLE)
      .select(
        "id, source_file, source_page, source_line, statement_period, tx_date, particulars, chq_ref_no, withdrawal, deposit, balance, transaction_amount, flow",
      )
      .order(sort.dbColumn, { ascending: sort.sortDir === "asc", nullsFirst: false })
      .order("id", { ascending: false });

    let countQuery = serviceClient
      .from(TABLE)
      .select("id", { count: "exact", head: true });

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
    if (filters.year && filters.year >= 1900 && filters.year <= 9999) {
      const mm = filters.month && filters.month >= 1 && filters.month <= 12 ? filters.month : null;
      if (mm) {
        const from = `${filters.year}-${String(mm).padStart(2, "0")}-01`;
        const nextYear = mm === 12 ? filters.year + 1 : filters.year;
        const nextMonth = mm === 12 ? 1 : mm + 1;
        const toExclusive = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
        query = query.gte("tx_date", from).lt("tx_date", toExclusive);
        countQuery = countQuery.gte("tx_date", from).lt("tx_date", toExclusive);
      } else {
        const yearFrom = `${filters.year}-01-01`;
        const yearToExclusive = `${filters.year + 1}-01-01`;
        query = query.gte("tx_date", yearFrom).lt("tx_date", yearToExclusive);
        countQuery = countQuery.gte("tx_date", yearFrom).lt("tx_date", yearToExclusive);
      }
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const [{ data, error: listError }, { count, error: countError }] = await Promise.all([
      query.range(from, to),
      countQuery,
    ]);
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

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

    const txIds = rows.map((r) => Number(r.id)).filter((v) => Number.isFinite(v) && v > 0);
    const invoiceByTxId = new Map<number, { invoiceNumber: string; invoiceStatus: string }>();
    if (txIds.length > 0) {
      const { data: links } = await serviceClient
        .from("invoice_transaction_links")
        .select("transaction_id, invoice:invoices(invoice_number, status)")
        .in("transaction_id", txIds);
      for (const link of links ?? []) {
        const txId = Number((link as { transaction_id?: number }).transaction_id ?? 0);
        const invoice = (link as { invoice?: { invoice_number?: string; status?: string } | null }).invoice;
        if (!txId || !invoice?.invoice_number) continue;
        invoiceByTxId.set(txId, {
          invoiceNumber: String(invoice.invoice_number),
          invoiceStatus: String(invoice.status ?? "draft"),
        });
      }
    }
    const rowsWithInvoice = rows.map((r) => ({
      ...r,
      ...(invoiceByTxId.get(Number(r.id)) ?? {}),
    }));

    return NextResponse.json({
      rows: rowsWithInvoice,
      filesScanned: extracted.filesScanned,
      errors: extracted.errors,
      persistedRows: payload.length,
      totalMatchedRows: count ?? rowsWithInvoice.length,
      currentPage: page,
      pageSize,
      sortBy: sort.sortBy,
      sortDir: sort.sortDir,
      truncatedBeforeScan: truncateBeforeScan,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[financial-reconciliation/scan]", e);
    return NextResponse.json(
      { error: message || "Statement scan failed on the server." },
      { status: 500 },
    );
  }
}
