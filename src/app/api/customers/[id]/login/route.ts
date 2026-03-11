import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  createAuthUser,
  deleteAuthUser,
  updateAuthUserPassword,
} from "@/lib/supabase-auth-admin";

type Payload = { action: "setup" | "reset"; password: string };

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

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Server configuration is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 500 },
    );
  }

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required. Add it to .env.local (Supabase Dashboard > Settings > API > service_role key)." },
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
    return NextResponse.json({ error: "You must be signed in as admin." }, { status: 401 });
  }

  const { data: callerProfile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("user_id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return NextResponse.json({ error: "Only admins can manage customer login." }, { status: 403 });
  }

  const body = (await request.json()) as Payload;
  const action = body?.action;
  const password = typeof body?.password === "string" ? body.password : "";

  if (action !== "setup" && action !== "reset") {
    return NextResponse.json({ error: "Invalid action. Use 'setup' or 'reset'." }, { status: 400 });
  }

  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: customer, error: fetchError } = await serviceClient
    .from("customers")
    .select("id, email, auth_user_id")
    .eq("id", customerId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { error: `Customer lookup failed: ${fetchError.message}. Check that the customers table exists and you have access.` },
      { status: 500 },
    );
  }

  if (!customer) {
    return NextResponse.json(
      { error: `No customer found with id ${customerId}. The customer may have been deleted or the link is incorrect.` },
      { status: 404 },
    );
  }

  if (action === "setup") {
    if (customer.auth_user_id) {
      return NextResponse.json(
        { error: "This customer already has login. Use Reset password instead." },
        { status: 400 },
      );
    }

    const authResult = await createAuthUser(supabaseUrl, serviceRoleKey, {
      email: customer.email,
      password,
      emailConfirm: true,
    });

    if ("error" in authResult) {
      return NextResponse.json(
        { error: authResult.error },
        { status: 400 },
      );
    }

    const authUserId = authResult.id;

    const { error: updateError } = await serviceClient
      .from("customers")
      .update({ auth_user_id: authUserId })
      .eq("id", customerId);

    if (updateError) {
      await deleteAuthUser(supabaseUrl, serviceRoleKey, authUserId);
      return NextResponse.json(
        { error: `Failed to link customer: ${updateError.message}` },
        { status: 400 },
      );
    }

    const { error: profileError } = await serviceClient.from("profiles").upsert(
      {
        user_id: authUserId,
        role: "customer",
        customer_id: customerId,
      },
      { onConflict: "user_id" },
    );

    if (profileError) {
      return NextResponse.json(
        { error: `Profile link failed: ${profileError.message}` },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      message: `Login created for ${customer.email}. They can sign in on the website with this email and password.`,
    });
  }

  if (action === "reset") {
    if (!customer.auth_user_id) {
      return NextResponse.json(
        { error: "This customer has no login yet. Use Set up login instead." },
        { status: 400 },
      );
    }

    const { error } = await updateAuthUserPassword(
      supabaseUrl,
      serviceRoleKey,
      customer.auth_user_id,
      password,
    );

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: "Password reset. Customer can sign in with the new password.",
    });
  }

  return NextResponse.json({ error: "Invalid action." }, { status: 400 });
}
