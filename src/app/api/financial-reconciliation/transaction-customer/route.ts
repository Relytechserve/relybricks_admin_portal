import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin: set or clear `customer_id` on a reconciliation deposit line (manual match override). */

export async function PATCH(request: Request) {
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const transactionId = Number(body.transactionId ?? body.id);
  if (!Number.isFinite(transactionId) || transactionId <= 0) {
    return NextResponse.json({ error: "transactionId must be a positive number." }, { status: 400 });
  }

  const rawCustomerId = body.customerId;
  const customerId =
    rawCustomerId === null || rawCustomerId === undefined || rawCustomerId === ""
      ? null
      : String(rawCustomerId).trim() || null;

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: fetchErr } = await serviceClient
    .from("financial_reconciliation_transactions")
    .select("id, flow, deposit")
    .eq("id", transactionId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });

  const flow = String((row as { flow?: string }).flow ?? "");
  const dep = Number((row as { deposit?: unknown }).deposit ?? 0);
  if (flow !== "deposit" || !Number.isFinite(dep) || dep <= 0) {
    return NextResponse.json(
      { error: "Only incoming deposit lines (flow = deposit, deposit > 0) can be assigned a customer." },
      { status: 400 },
    );
  }

  if (customerId) {
    const { data: cust, error: custErr } = await serviceClient
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .is("archived_at", null)
      .maybeSingle();

    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });
    if (!cust) {
      return NextResponse.json(
        { error: "Customer not found or is archived. Only active customers can be linked." },
        { status: 400 },
      );
    }
  }

  const { error: updateErr } = await serviceClient
    .from("financial_reconciliation_transactions")
    .update({ customer_id: customerId })
    .eq("id", transactionId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, transactionId, customerId });
}
