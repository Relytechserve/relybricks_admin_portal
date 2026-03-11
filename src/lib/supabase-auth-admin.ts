/**
 * Supabase Auth Admin API via fetch.
 * Bypasses supabase-js client to avoid "Invalid API key" issues with service_role.
 */

const trim = (s: string | undefined) => (s ?? "").trim();

export async function createAuthUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  options: { email: string; password: string; emailConfirm?: boolean }
): Promise<{ id: string; email: string } | { error: string }> {
  const url = `${trim(supabaseUrl).replace(/\/$/, "")}/auth/v1/admin/users`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email: options.email,
      password: options.password,
      email_confirm: options.emailConfirm ?? true,
    }),
  });

  const data = (await res.json()) as {
    id?: string;
    email?: string;
    user?: { id?: string; email?: string };
    msg?: string;
    message?: string;
    error_description?: string;
  };
  if (!res.ok) {
    const msg = data.msg ?? data.message ?? data.error_description ?? `Auth API ${res.status}`;
    return { error: String(msg) };
  }
  const id = data.id ?? data.user?.id;
  const email = data.email ?? data.user?.email;
  if (!id || !email) {
    return { error: "Auth API returned invalid response (missing id or email)" };
  }
  return { id, email };
}

export async function deleteAuthUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string
): Promise<{ error?: string }> {
  const url = `${trim(supabaseUrl).replace(/\/$/, "")}/auth/v1/admin/users/${userId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!res.ok) {
    const data = (await res.json()) as { msg?: string; message?: string };
    return { error: data.msg ?? data.message ?? `Auth API ${res.status}` };
  }
  return {};
}

export async function updateAuthUserPassword(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  newPassword: string
): Promise<{ error?: string }> {
  const url = `${trim(supabaseUrl).replace(/\/$/, "")}/auth/v1/admin/users/${userId}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ password: newPassword }),
  });

  if (!res.ok) {
    const data = (await res.json()) as { msg?: string; message?: string };
    return { error: data.msg ?? data.message ?? `Auth API ${res.status}` };
  }
  return {};
}
