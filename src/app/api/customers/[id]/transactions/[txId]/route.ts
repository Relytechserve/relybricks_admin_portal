import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type Payload = {
  type: "renewal" | "payment" | "other";
  date: string;
  amount?: number | null;
  description?: string | null;
  edit_reason: string;
};

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string; txId: string }> | { id: string; txId: string };
  },
) {
  const params = await Promise.resolve(context.params);
  const customerId = typeof params?.id === "string" ? params.id : "";
  const txId = typeof params?.txId === "string" ? params.txId : "";

  if (!customerId || !txId) {
    return NextResponse.json(
      { error: "Missing customer id or transaction id." },
      { status: 400 },
    );
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      {
        error:
          "Server configuration is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 500 },
    );
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is required. Add it to .env.local (Supabase Dashboard > Settings > API > service_role key).",
      },
      { status: 500 },
    );
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user: caller },
  } = await sessionClient.auth.getUser();

  if (!caller) {
    return NextResponse.json(
      { error: "You must be signed in as admin." },
      { status: 401 },
    );
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can edit transactions." },
      { status: 403 },
    );
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const editReason =
    typeof body?.edit_reason === "string" ? body.edit_reason.trim() : "";
  if (!editReason) {
    return NextResponse.json(
      { error: "Edit reason is required when editing a transaction." },
      { status: 400 },
    );
  }

  const type = body?.type;
  const date = typeof body?.date === "string" ? body.date.trim() : "";
  const amount =
    body?.amount != null && body?.amount !== ""
      ? Number(body.amount)
      : null;
  const description =
    typeof body?.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const validTypes = ["renewal", "payment", "other"];
  if (!type || !validTypes.includes(type)) {
    return NextResponse.json(
      { error: "Invalid type. Use renewal, payment, or other." },
      { status: 400 },
    );
  }

  if (!date) {
    return NextResponse.json(
      { error: "Date is required." },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await serviceClient
    .from("transactions")
    .update({
      type,
      date,
      amount: amount != null && !Number.isNaN(amount) ? amount : null,
      description,
      updated_at: new Date().toISOString(),
      last_edit_reason: editReason,
    })
    .eq("id", txId)
    .eq("customer_id", customerId)
    .select("id, type, amount, description, date, last_edit_reason")
    .single();

  if (error) {
    console.error("[transactions] Update error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update transaction." },
      { status: 400 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Transaction not found or access denied." },
      { status: 404 },
    );
  }

  let nextRenewalDate: string | null = null;
  if (type === "renewal" && date) {
    const renewalDate = new Date(date);
    if (!Number.isNaN(renewalDate.getTime())) {
      renewalDate.setFullYear(renewalDate.getFullYear() + 1);
      nextRenewalDate = renewalDate.toISOString().slice(0, 10);
      await serviceClient
        .from("customers")
        .update({ next_renewal_date: nextRenewalDate })
        .eq("id", customerId);
    }
  }

  return NextResponse.json({ data, nextRenewalDate });
}
