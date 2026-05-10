import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Payload = {
  transactionIds: Array<number | string>;
  customerId: string;
  invoiceDate?: string;
  paymentTermsDays?: number;
  notes?: string;
  lineItems?: Array<{
    transactionId: number | string;
    description?: string;
    amount?: number;
  }>;
};

function toDateOnly(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
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

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const transactionIds = Array.isArray(body.transactionIds)
    ? body.transactionIds
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
    : [];
  if (transactionIds.length === 0) {
    return NextResponse.json({ error: "Select at least one transaction." }, { status: 400 });
  }
  if (!body.customerId || !body.customerId.trim()) {
    return NextResponse.json({ error: "Customer is required." }, { status: 400 });
  }

  const invoiceDate = toDateOnly(body.invoiceDate);
  const terms = body.paymentTermsDays === 7 || body.paymentTermsDays === 15 || body.paymentTermsDays === 30
    ? body.paymentTermsDays
    : 7;
  const due = new Date(`${invoiceDate}T00:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() + terms);
  const dueDate = due.toISOString().slice(0, 10);

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: customer, error: customerError } = await serviceClient
    .from("customers")
    .select("id, name, archived_at")
    .eq("id", body.customerId)
    .maybeSingle();
  if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 });
  if (!customer || (customer as { archived_at?: string | null }).archived_at) {
    return NextResponse.json({ error: "Customer not found or archived." }, { status: 400 });
  }

  const { data: txRows, error: txError } = await serviceClient
    .from("financial_reconciliation_transactions")
    .select(
      "id, tx_date, particulars, transaction_amount, withdrawal, deposit, source_file, source_page, source_line",
    )
    .in("id", transactionIds);
  if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });
  if (!txRows || txRows.length === 0) {
    return NextResponse.json({ error: "No transactions found for the selected rows." }, { status: 400 });
  }

  const { data: existingLinks, error: linkError } = await serviceClient
    .from("invoice_transaction_links")
    .select("transaction_id")
    .in("transaction_id", transactionIds);
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if ((existingLinks ?? []).length > 0) {
    return NextResponse.json(
      { error: "Some selected transactions are already linked to an invoice." },
      { status: 409 },
    );
  }

  const { data: nextNumberData, error: numberError } = await serviceClient.rpc("next_invoice_number", {
    p_invoice_date: invoiceDate,
    p_prefix: "RB",
  });
  if (numberError || !nextNumberData) {
    return NextResponse.json({ error: numberError?.message ?? "Could not generate invoice number." }, { status: 500 });
  }
  const invoiceNumber = String(nextNumberData);

  const subtotal = (txRows ?? []).reduce((sum, row) => {
    const amt = Number((row as { transaction_amount?: number | null }).transaction_amount ?? 0);
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);

  const { data: invoiceInsert, error: invoiceError } = await serviceClient
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      customer_id: body.customerId,
      status: "draft",
      invoice_date: invoiceDate,
      due_date: dueDate,
      payment_terms_days: terms,
      subtotal,
      grand_total: subtotal,
      notes: body.notes?.trim() || null,
    })
    .select("id, invoice_number, customer_id, invoice_date, due_date, payment_terms_days, subtotal, grand_total, status")
    .single();
  if (invoiceError) {
    return NextResponse.json({ error: invoiceError.message }, { status: 500 });
  }

  const invoiceId = (invoiceInsert as { id: number }).id;

  const lineItemByTxId = new Map<number, { description?: string; amount?: number }>();
  for (const li of body.lineItems ?? []) {
    const txId = Number(li.transactionId);
    if (!Number.isFinite(txId) || txId <= 0) continue;
    lineItemByTxId.set(txId, {
      description: typeof li.description === "string" ? li.description.trim() : undefined,
      amount: typeof li.amount === "number" && Number.isFinite(li.amount) ? li.amount : undefined,
    });
  }

  const lineItems = (txRows ?? []).map((row) => {
    const txId = Number((row as { id: number }).id);
    const override = lineItemByTxId.get(txId);
    const amount = Number(
      override?.amount ??
        Number((row as { transaction_amount?: number | null }).transaction_amount ?? 0),
    );
    const particulars = String((row as { particulars?: string | null }).particulars ?? "Transaction");
    const txDate = String((row as { tx_date?: string | null }).tx_date ?? "");
    return {
      invoice_id: invoiceId,
      source_transaction_id: txId,
      description: override?.description || `${txDate} - ${particulars}`,
      quantity: 1,
      unit_price: amount,
      line_total: amount,
    };
  });

  const links = (txRows ?? []).map((row) => ({
    invoice_id: invoiceId,
    transaction_id: Number((row as { id: number }).id),
    allocated_amount: Number((row as { transaction_amount?: number | null }).transaction_amount ?? 0),
  }));

  const [{ error: lineError }, { error: linkInsertError }, { error: txUpdateError }] = await Promise.all([
    serviceClient.from("invoice_line_items").insert(lineItems),
    serviceClient.from("invoice_transaction_links").insert(links),
    serviceClient
      .from("financial_reconciliation_transactions")
      .update({ customer_id: body.customerId })
      .in("id", transactionIds),
  ]);
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  if (linkInsertError) return NextResponse.json({ error: linkInsertError.message }, { status: 500 });
  if (txUpdateError) return NextResponse.json({ error: txUpdateError.message }, { status: 500 });

  return NextResponse.json({
    invoice: invoiceInsert,
    linkedTransactions: transactionIds.length,
  });
}
