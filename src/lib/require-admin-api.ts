import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function requireAdminSession(): Promise<
  { ok: true } | { ok: false; response: NextResponse }
> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Server configuration is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        },
        { status: 500 },
      ),
    };
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
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You must be signed in as admin." }, { status: 401 }),
    };
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Only admins can use this feature." }, { status: 403 }),
    };
  }

  return { ok: true };
}
