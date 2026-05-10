import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
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

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await serviceClient
    .from("invoices")
    .select(
      "id, invoice_number, customer_id, status, invoice_date, due_date, payment_terms_days, grand_total, created_at, customer:customers(name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const invoiceIds = (data ?? []).map((r) => Number(r.id)).filter((v) => Number.isFinite(v) && v > 0);
  const latestEmailByInvoice = new Map<number, { status: string; sentAt: string | null; recipientEmail: string }>();
  if (invoiceIds.length > 0) {
    const { data: logs } = await serviceClient
      .from("invoice_email_logs")
      .select("invoice_id, status, sent_at, recipient_email, created_at")
      .in("invoice_id", invoiceIds)
      .order("created_at", { ascending: false });
    for (const log of logs ?? []) {
      const invoiceId = Number((log as { invoice_id?: number }).invoice_id ?? 0);
      if (!invoiceId || latestEmailByInvoice.has(invoiceId)) continue;
      latestEmailByInvoice.set(invoiceId, {
        status: String((log as { status?: string }).status ?? "queued"),
        sentAt: ((log as { sent_at?: string | null }).sent_at ?? null) as string | null,
        recipientEmail: String((log as { recipient_email?: string }).recipient_email ?? ""),
      });
    }
  }

  const invoices = (data ?? []).map((invoice) => ({
    ...invoice,
    latestEmail: latestEmailByInvoice.get(Number(invoice.id)) ?? null,
  }));
  return NextResponse.json({ invoices });
}
