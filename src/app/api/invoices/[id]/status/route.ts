import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/lib/require-admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_STATUSES = ["draft", "generated", "sent", "paid", "cancelled"] as const;
type InvoiceStatus = (typeof ALLOWED_STATUSES)[number];

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["generated", "cancelled"],
  generated: ["sent", "paid", "cancelled"],
  sent: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
};

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const invoiceId = Number(params.id);
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

  let nextStatusRaw: unknown;
  try {
    const body = (await request.json()) as { status?: unknown };
    nextStatusRaw = body.status;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const nextStatus = String(nextStatusRaw ?? "") as InvoiceStatus;
  if (!ALLOWED_STATUSES.includes(nextStatus)) {
    return NextResponse.json({ error: "Invalid status value." }, { status: 400 });
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

  const { data: existing, error: existingError } = await serviceClient
    .from("invoices")
    .select("id, invoice_number, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const currentStatus = String((existing as { status?: string }).status ?? "draft") as InvoiceStatus;
  if (!TRANSITIONS[currentStatus].includes(nextStatus)) {
    return NextResponse.json(
      { error: `Status transition not allowed from ${currentStatus} to ${nextStatus}.` },
      { status: 409 },
    );
  }

  const { data: updated, error: updateError } = await serviceClient
    .from("invoices")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .select("id, invoice_number, status, invoice_date, due_date, payment_terms_days, grand_total, created_at")
    .single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ invoice: updated });
}
