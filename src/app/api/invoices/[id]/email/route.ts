import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/invoice-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_: Request, { params }: { params: { id: string } }) {
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

  const customer = (invoice as { customer?: { name?: string; email?: string | null } | null }).customer;
  const recipient = String(customer?.email ?? "").trim();
  if (!recipient) {
    return NextResponse.json({ error: "Customer email is missing. Update customer email first." }, { status: 400 });
  }

  const { data: lineItems, error: lineError } = await serviceClient
    .from("invoice_line_items")
    .select("description, quantity, unit_price, line_total")
    .eq("invoice_id", invoiceId)
    .order("id", { ascending: true });
  if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });

  const invoiceNumber = String((invoice as { invoice_number?: string }).invoice_number ?? "");
  const pdfBuffer = await buildInvoicePdf({
    invoiceNumber,
    invoiceDate: String((invoice as { invoice_date?: string }).invoice_date ?? ""),
    dueDate: String((invoice as { due_date?: string }).due_date ?? ""),
    status: String((invoice as { status?: string }).status ?? "draft"),
    customerName: String(customer?.name ?? "Unknown customer"),
    customerEmail: customer?.email ?? null,
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

  const subject = `Invoice ${invoiceNumber} from RelyBricks`;
  const html = `
    <p>Hi ${customer?.name ?? "Customer"},</p>
    <p>Please find attached invoice <strong>${invoiceNumber}</strong>.</p>
    <p>Invoice Date: ${String((invoice as { invoice_date?: string }).invoice_date ?? "")}<br/>
    Due Date: ${String((invoice as { due_date?: string }).due_date ?? "")}<br/>
    Amount: ${Number((invoice as { grand_total?: number }).grand_total ?? 0).toFixed(2)}</p>
    <p>Regards,<br/>RelyBricks Team</p>
  `;

  let providerMessageId: string | null = null;
  try {
    providerMessageId = await sendInvoiceEmail({
      to: recipient,
      subject,
      html,
      pdfFilename: `${invoiceNumber.replace(/[^\w.-]/g, "_")}.pdf`,
      pdfBuffer,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await serviceClient.from("invoice_email_logs").insert({
      invoice_id: invoiceId,
      recipient_email: recipient,
      subject,
      status: "failed",
      error_message: err,
    });
    return NextResponse.json({ error: err }, { status: 500 });
  }

  await serviceClient.from("invoice_email_logs").insert({
    invoice_id: invoiceId,
    recipient_email: recipient,
    subject,
    status: "sent",
    provider_message_id: providerMessageId,
    sent_at: new Date().toISOString(),
  });

  const status = String((invoice as { status?: string }).status ?? "draft");
  if (status === "draft" || status === "generated") {
    await serviceClient
      .from("invoices")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }

  return NextResponse.json({ ok: true, invoiceId, recipient });
}
