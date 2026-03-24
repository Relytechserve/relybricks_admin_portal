/**
 * Log an admin action from the browser (uses session; server verifies admin).
 * Does not throw — failures are silent so UX is not blocked.
 */
export async function logClientAdminActivity(payload: {
  action: string;
  resourceType?: string;
  resourceId?: string;
  summary: string;
}): Promise<void> {
  try {
    await fetch("/api/admin/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: payload.action,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId,
        summary: payload.summary,
      }),
    });
  } catch {
    /* ignore */
  }
}
