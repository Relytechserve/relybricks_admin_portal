import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";
import {
  normalizeParticularsKey,
  withdrawalAmountFromRow,
  type ReconciliationFlowRow,
} from "@/lib/reconciliation-withdrawal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

type FrtRow = ReconciliationFlowRow;

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "10", 10) || 10));
  const minLineAmount = Math.max(0, Number(url.searchParams.get("minLineAmount") ?? 0) || 0);
  const sortBy = url.searchParams.get("sortBy") === "volume" ? "volume" : "frequency";

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

  const agg = new Map<
    string,
    {
      count: number;
      totalWithdrawn: number;
      sampleParticulars: string;
    }
  >();

  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const { data: batch, error } = await serviceClient
      .from("financial_reconciliation_transactions")
      .select("particulars, withdrawal, transaction_amount, flow")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (batch ?? []) as FrtRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const amt = withdrawalAmountFromRow(row);
      if (amt <= 0) continue;
      if (minLineAmount > 0 && amt < minLineAmount) continue;

      const raw = String(row.particulars ?? "").trim();
      const key = normalizeParticularsKey(raw || "(empty)");
      const prev = agg.get(key) ?? { count: 0, totalWithdrawn: 0, sampleParticulars: raw || "(empty)" };
      prev.count += 1;
      prev.totalWithdrawn += amt;
      if ((raw || "(empty)").length > prev.sampleParticulars.length) {
        prev.sampleParticulars = raw || "(empty)";
      }
      agg.set(key, prev);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  let list = Array.from(agg.entries()).map(([normalizedKey, v]) => ({
    normalizedKey,
    particulars: v.sampleParticulars,
    occurrenceCount: v.count,
    totalWithdrawn: Math.round(v.totalWithdrawn * 100) / 100,
  }));

  if (sortBy === "volume") {
    list.sort((a, b) => b.totalWithdrawn - a.totalWithdrawn);
  } else {
    list.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  }

  list = list.slice(0, limit);

  return NextResponse.json(
    {
      limit,
      params: { minLineAmount: minLineAmount || null, sortBy },
      rows: list,
    },
    { headers: NO_STORE_HEADERS },
  );
}
