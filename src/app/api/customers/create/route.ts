import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createAuthUser, deleteAuthUser } from "@/lib/supabase-auth-admin";
import { recordAdminActivity } from "@/lib/record-admin-activity";

type CreateCustomerPayload = {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  whatsapp?: string;
  preferred_contact?: "email" | "whatsapp" | "both" | "";
};

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    return NextResponse.json({ error: "Only admins can create customer accounts." }, { status: 403 });
  }

  const payload = (await request.json()) as CreateCustomerPayload;
  const name = payload.name?.trim() ?? "";
  const email = payload.email?.trim().toLowerCase() ?? "";
  const password = payload.password ?? "";
  const phone = payload.phone?.trim() || null;
  const whatsapp = payload.whatsapp?.trim() || null;
  const preferredContact = payload.preferred_contact || null;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existingCustomer } = await serviceClient
    .from("customers")
    .select("id")
    .eq("email", email)
    .is("archived_at", null)
    .maybeSingle();

  if (existingCustomer) {
    return NextResponse.json({ error: "A customer with this email already exists." }, { status: 409 });
  }

  const authResult = await createAuthUser(supabaseUrl, serviceRoleKey, {
    email,
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

  const { data: createdCustomer, error: createCustomerError } = await serviceClient
    .from("customers")
    .insert({
      auth_user_id: authUserId,
      name,
      email,
      phone,
      whatsapp,
      preferred_contact: preferredContact,
      status: "Active",
    })
    .select("id, name, email, status")
    .single();

  if (createCustomerError || !createdCustomer) {
    await deleteAuthUser(supabaseUrl, serviceRoleKey, authUserId);
    return NextResponse.json(
      { error: createCustomerError?.message ?? "Failed to create customer profile." },
      { status: 400 },
    );
  }

  const { error: profileError } = await serviceClient.from("profiles").upsert(
    {
      user_id: authUserId,
      role: "customer",
      customer_id: createdCustomer.id,
    },
    { onConflict: "user_id" },
  );

  if (profileError) {
    await serviceClient.from("customers").delete().eq("id", createdCustomer.id);
    await deleteAuthUser(supabaseUrl, serviceRoleKey, authUserId);
    return NextResponse.json({ error: "Failed to link customer access profile." }, { status: 400 });
  }

  await recordAdminActivity(serviceClient, {
    actor_user_id: caller.id,
    actor_email: caller.email ?? null,
    action: "customer.created",
    resource_type: "customer",
    resource_id: createdCustomer.id,
    summary: `Created customer account: ${createdCustomer.name} (${createdCustomer.email})`,
  });

  return NextResponse.json({
    customer: createdCustomer,
    message: "Customer account created successfully.",
  });
}
