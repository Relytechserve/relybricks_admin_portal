import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { recordAdminActivity } from "@/lib/record-admin-activity";

type Body = {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  summary?: string;
};

export async function POST(request: Request) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration incomplete." }, { status: 500 });
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
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!action || !summary) {
    return NextResponse.json({ error: "action and summary are required." }, { status: 400 });
  }

  const resourceType =
    typeof body.resourceType === "string" && body.resourceType.trim()
      ? body.resourceType.trim()
      : null;
  const resourceId =
    typeof body.resourceId === "string" && body.resourceId.trim() ? body.resourceId.trim() : null;

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await recordAdminActivity(serviceClient, {
    actor_user_id: caller.id,
    actor_email: caller.email ?? null,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    summary,
  });

  return NextResponse.json({ ok: true });
}
