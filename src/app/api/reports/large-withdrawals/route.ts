import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

/**
 * Largest debits: filter, sort, and display use **only** the `withdrawal` column in Postgres.
 * No `deposit`, no `transaction_amount`, no client-side heuristics.
 */
export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const minAmount = Math.max(0, Number(url.searchParams.get("minAmount") ?? 10_000));
  const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));

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

  const base = () =>
    serviceClient.from("financial_reconciliation_transactions").select("*", { count: "exact", head: true });

  const [{ count: rowCount, error: countError }, { data: rows, error: listError }] = await Promise.all([
    base().gte("withdrawal", minAmount),
    serviceClient
      .from("financial_reconciliation_transactions")
      .select("id, tx_date, particulars, withdrawal, source_file")
      .gte("withdrawal", minAmount)
      .order("withdrawal", { ascending: false })
      .limit(limit),
  ]);

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  const out = (rows ?? []).map((row) => {
    const w = Number((row as { withdrawal?: unknown }).withdrawal ?? 0);
    return {
      id: Number((row as { id: number }).id),
      tx_date: String((row as { tx_date: string }).tx_date),
      /** Always the stored withdrawal column (debit) */
      amount: Math.round(w * 100) / 100,
      particulars: String((row as { particulars?: string }).particulars ?? "").trim() || "(empty)",
      source_file: String((row as { source_file: string }).source_file),
    };
  });

  return NextResponse.json(
    {
      params: { minAmount, limit, basis: "withdrawal_column_only" as const },
      rowCount: rowCount ?? out.length,
      rows: out,
    },
    { headers: NO_STORE_HEADERS },
  );
}
