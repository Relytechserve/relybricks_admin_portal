import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";
import { buildInvoicePdf } from "@/lib/invoice-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const invoiceId = Number(params.id);
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

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

  const { data: invoice, error: invoiceError } = await serviceClient
    .from("invoices")
    .select(
      "id, invoice_number, status, invoice_date, due_date, payment_terms_days, notes, subtotal, grand_total, customer:customers(name, email)",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return NextResponse.json({ error: invoiceError.message }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const { data: lineItems, error: lineError } = await serviceClient
    .from("invoice_line_items")
    .select("description, quantity, unit_price, line_total")
    .eq("invoice_id", invoiceId)
    .order("id", { ascending: true });
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });

  const customerObj = (invoice as { customer?: { name?: string; email?: string | null } | null }).customer;
  const pdfBuffer = await buildInvoicePdf({
    invoiceNumber: String((invoice as { invoice_number?: string }).invoice_number ?? ""),
    invoiceDate: String((invoice as { invoice_date?: string }).invoice_date ?? ""),
    dueDate: String((invoice as { due_date?: string }).due_date ?? ""),
    status: String((invoice as { status?: string }).status ?? "draft"),
    customerName: String(customerObj?.name ?? "Unknown customer"),
    customerEmail: customerObj?.email ?? null,
    paymentTermsDays: Number((invoice as { payment_terms_days?: number }).payment_terms_days ?? 7),
    notes: (invoice as { notes?: string | null }).notes ?? null,
    subtotal: Number((invoice as { subtotal?: number }).subtotal ?? 0),
    grandTotal: Number((invoice as { grand_total?: number }).grand_total ?? 0),
    lineItems: (lineItems ?? []).map((item) => ({
      description: String((item as { description?: string }).description ?? ""),
      quantity: Number((item as { quantity?: number }).quantity ?? 1),
      unitPrice: Number((item as { unit_price?: number }).unit_price ?? 0),
      lineTotal: Number((item as { line_total?: number }).line_total ?? 0),
    })),
  });

  if ((invoice as { status?: string }).status === "draft") {
    await serviceClient
      .from("invoices")
      .update({ status: "generated", updated_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }

  const filename = `${String((invoice as { invoice_number?: string }).invoice_number ?? "invoice").replace(/[^\w.-]/g, "_")}.pdf`;
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
