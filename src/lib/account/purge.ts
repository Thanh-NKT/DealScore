import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeCutoff } from "@/lib/account/purge-date";

export { PURGE_AFTER_DAYS, purgeCutoff, purgeDate } from "@/lib/account/purge-date";

/**
 * Hard-delete accounts whose deletion was requested more than 30 days ago.
 * Deleting auth.users cascades to users → watches → alert_events, notification_settings,
 * user_preferences (covered by tests/db/preferences.test.ts "is removed with the user");
 * click_events.user_id and lookup_requests.user_id → null.
 * One user failing does not stop the run. Safe to re-run.
 */
export async function purgeDeletedAccounts(
  opts: { now: Date; limit?: number },
  client: SupabaseClient<Database> = createAdminClient(),
): Promise<{ purged: string[]; failed: Array<{ userId: string; error: string }> }> {
  const { data, error } = await client
    .from("users")
    .select("id")
    .lt("deleted_at", purgeCutoff(opts.now).toISOString())
    .order("deleted_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (error) throw new Error(`Failed to read pending deletions: ${error.message}`);

  const purged: string[] = [];
  const failed: Array<{ userId: string; error: string }> = [];
  for (const { id } of data ?? []) {
    const { error: delError } = await client.auth.admin.deleteUser(id);
    if (delError) failed.push({ userId: id, error: delError.message });
    else purged.push(id);
  }
  return { purged, failed };
}
