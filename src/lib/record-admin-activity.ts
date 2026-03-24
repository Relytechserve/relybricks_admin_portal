import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminActivityRow = {
  actor_user_id: string;
  actor_email: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  summary: string;
};

/** Insert via service-role client (bypasses RLS). Fire-and-forget; logs errors only. */
export async function recordAdminActivity(
  serviceClient: SupabaseClient,
  row: AdminActivityRow,
): Promise<void> {
  const { error } = await serviceClient.from("admin_activity_log").insert({
    actor_user_id: row.actor_user_id,
    actor_email: row.actor_email,
    action: row.action,
    resource_type: row.resource_type ?? null,
    resource_id: row.resource_id ?? null,
    summary: row.summary,
  });
  if (error) {
    console.error("[recordAdminActivity]", error.message);
  }
}
