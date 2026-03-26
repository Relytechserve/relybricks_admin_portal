import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { deleteAuthUser } from "@/lib/supabase-auth-admin";
import { recordAdminActivity } from "@/lib/record-admin-activity";

type Body = { reason?: string | null };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const params = await Promise.resolve(context.params);
  const customerId = typeof params?.id === "string" ? params.id : "";
  if (!customerId) {
    return NextResponse.json({ error: "Missing customer id." }, { status: 400 });
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server configuration is incomplete. Please set Supabase environment variables." },
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
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });

  const {
    data: { user: caller },
  } = await sessionClient.auth.getUser();

  if (!caller) {
    return NextResponse.json({ error: "You must be signed in as admin." }, { status: 401 });
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json({ error: "Only admins can archive customers." }, { status: 403 });
  }

  let reason: string | null = null;
  try {
    const json = (await request.json()) as Body;
    const raw = typeof json?.reason === "string" ? json.reason.trim() : "";
    reason = raw || null;
  } catch {
    reason = null;
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: fetchError } = await serviceClient
    .from("customers")
    .select("id, name, email, auth_user_id, archived_at")
    .eq("id", customerId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { error: `Customer lookup failed: ${fetchError.message}` },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  const archivedAt = (row as { archived_at?: string | null }).archived_at;
  if (archivedAt) {
    return NextResponse.json({ error: "This customer is already archived." }, { status: 400 });
  }

  const authUserId = (row as { auth_user_id?: string | null }).auth_user_id ?? null;

  if (authUserId) {
    const { error: profileDelErr } = await serviceClient.from("profiles").delete().eq("user_id", authUserId);
    if (profileDelErr) {
      return NextResponse.json(
        { error: `Could not remove access profile: ${profileDelErr.message}` },
        { status: 400 },
      );
    }

    const delAuth = await deleteAuthUser(supabaseUrl, serviceRoleKey, authUserId);
    if (delAuth.error) {
      return NextResponse.json(
        { error: `Could not remove login account: ${delAuth.error}` },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const { error: updateError } = await serviceClient
    .from("customers")
    .update({
      archived_at: now,
      archived_reason: reason,
      auth_user_id: null,
    })
    .eq("id", customerId)
    .is("archived_at", null);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message ?? "Failed to archive customer." },
      { status: 400 },
    );
  }

  const name = (row as { name?: string }).name ?? "Customer";
  const email = (row as { email?: string }).email ?? "";

  await recordAdminActivity(serviceClient, {
    actor_user_id: caller.id,
    actor_email: caller.email ?? null,
    action: "customer.archived",
    resource_type: "customer",
    resource_id: customerId,
    summary: `Archived customer: ${name}${email ? ` (${email})` : ""}`,
  });

  return NextResponse.json({
    ok: true,
    archived_at: now,
    message: "Customer archived. Properties and transactions are retained for audit; the email can be used for a new customer.",
  });
}
