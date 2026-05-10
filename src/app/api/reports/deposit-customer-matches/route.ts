import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";
import { bestCustomerMatchForParticulars, type CustomerMatchRef } from "@/lib/deposit-customer-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));
  const dateFrom = (url.searchParams.get("from") ?? "").trim();
  const dateTo = (url.searchParams.get("to") ?? "").trim();

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

  const { data: customerRows, error: custErr } = await serviceClient
    .from("customers")
    .select("id, name")
    .is("archived_at", null);

  if (custErr) {
    return NextResponse.json({ error: custErr.message }, { status: 500 });
  }

  const customers: CustomerMatchRef[] = (customerRows ?? [])
    .map((r) => ({
      id: String((r as { id?: string }).id ?? ""),
      name: String((r as { name?: string }).name ?? "").trim(),
    }))
    .filter((r) => r.id && r.name);

  let q = serviceClient
    .from("financial_reconciliation_transactions")
    .select("id, tx_date, particulars, deposit, source_file, customer_id")
    .eq("flow", "deposit")
    .gt("deposit", 0)
    .order("tx_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (dateFrom) q = q.gte("tx_date", dateFrom);
  if (dateTo) q = q.lte("tx_date", dateTo);

  const { data: txRows, error: txErr } = await q;
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  const activeNameById = new Map(customers.map((c) => [c.id, c.name] as const));
  const storedIds = Array.from(
    new Set(
      (txRows ?? [])
        .map((row) => (row as { customer_id?: string | null }).customer_id)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const missingNameIds = storedIds.filter((id) => !activeNameById.has(id));
  if (missingNameIds.length > 0) {
    const { data: extraNames, error: nameErr } = await serviceClient
      .from("customers")
      .select("id, name")
      .in("id", missingNameIds);
    if (nameErr) return NextResponse.json({ error: nameErr.message }, { status: 500 });
    for (const r of extraNames ?? []) {
      const id = String((r as { id?: string }).id ?? "");
      const name = String((r as { name?: string }).name ?? "").trim();
      if (id && name) activeNameById.set(id, name);
    }
  }

  type OutRow = {
    id: number;
    tx_date: string;
    deposit: number;
    particulars: string;
    source_file: string;
    /** Shown in table: manual `customer_id` if set, else text heuristic */
    matchedCustomerId: string | null;
    matchedCustomerName: string | null;
    matchKind: string;
    manualCustomerId: string | null;
    suggestedCustomerId: string | null;
    suggestedCustomerName: string | null;
    suggestedMatchKind: string;
  };

  const rows: OutRow[] = [];
  for (const row of txRows ?? []) {
    const id = Number((row as { id?: number }).id ?? 0);
    const particulars = String((row as { particulars?: string }).particulars ?? "").trim() || "(empty)";
    const d = Number((row as { deposit?: unknown }).deposit ?? 0);
    const deposit = Number.isFinite(d) ? Math.round(d * 100) / 100 : 0;
    const storedCustId = (row as { customer_id?: string | null }).customer_id;
    const manualId = storedCustId ? String(storedCustId) : null;
    const manualName = manualId ? (activeNameById.get(manualId) ?? null) : null;

    const m = bestCustomerMatchForParticulars(particulars, customers);
    const suggestedId = m?.customer.id ?? null;
    const suggestedName = m?.customer.name ?? null;
    const suggestedKind = m?.matchKind ?? "unknown";

    const useManual = Boolean(manualId);
    rows.push({
      id,
      tx_date: String((row as { tx_date?: string }).tx_date ?? ""),
      deposit,
      particulars,
      source_file: String((row as { source_file?: string }).source_file ?? ""),
      matchedCustomerId: useManual ? manualId : suggestedId,
      matchedCustomerName: useManual ? manualName ?? "Customer record unavailable" : suggestedName,
      matchKind: useManual ? "Manual assignment" : suggestedKind,
      manualCustomerId: manualId,
      suggestedCustomerId: suggestedId,
      suggestedCustomerName: suggestedName,
      suggestedMatchKind: suggestedKind,
    });
  }

  return NextResponse.json(
    {
      params: {
        limit,
        from: dateFrom || null,
        to: dateTo || null,
        basis: "deposit_rows_only",
      },
      customerCount: customers.length,
      rows,
    },
    { headers: NO_STORE_HEADERS },
  );
}
