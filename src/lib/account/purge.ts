import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeCutoff } from "@/lib/account/purge-date";

export { PURGE_AFTER_DAYS, purgeCutoff, purgeDate } from "@/lib/account/purge-date";

/**
 * Hard-delete accounts whose deletion was requested more than 30 days ago.
 * Deleting auth.users cascades to users → watches → alert_events, notification_settings,
 * user_preferences (covered by tests/db/preferences.test.ts "is removed with the user"), and the user's
 * extension_observations / extension_contributions (user_id FK, migration 0023; tests/db/user-data.test.ts);
 * click_events.user_id, lookup_requests.user_id and data_reports.user_id → null (migration 0043: a "Góp ý dữ
 * liệu" report is kept anonymised — its kind and free-text message stay for the admin queue, unlinked from the
 * person; the form asks not to write personal data).
 * Roadmap P4 (0060–0062), all cascading from users: saved_searches (→ saved_search_hits, their alert_events),
 * demand_follows (→ their alert_events), watch_folder_shares; alert_events.user_id cascades for every source
 * (tests/db/demand-follows.test.ts "purging the account…").
 * A new table holding user data must reference users(id) the same way (cascade, or set null when the row is kept
 * anonymised on purpose) — erasure relies on it.
 * One user failing does not stop the run. Safe to re-run.
 *
 * Works in batches of `limit` until the backlog is empty or `deadline` (ms epoch) passes, then
 * reports how many due accounts are still `remaining`: a backlog means accounts kept past the
 * promised 30 days, so the caller must alert on it.
 */
export async function purgeDeletedAccounts(
  opts: { now: Date; limit?: number; deadline?: number },
  client: SupabaseClient<Database> = createAdminClient(),
): Promise<{ purged: string[]; failed: Array<{ userId: string; error: string }>; remaining: number }> {
  const cutoff = purgeCutoff(opts.now).toISOString();
  const batchSize = opts.limit ?? 100;
  const deadline = opts.deadline ?? Date.now() + 50_000;

  const purged: string[] = [];
  const failed: Array<{ userId: string; error: string }> = [];
  while (Date.now() < deadline && failed.length < MAX_FAILURES) {
    let query = client
      .from("users")
      .select("id")
      .lt("deleted_at", cutoff)
      .order("deleted_at", { ascending: true })
      .limit(batchSize);
    // Accounts that failed in this run are not retried until the next run.
    if (failed.length > 0) query = query.not("id", "in", `(${failed.map((f) => f.userId).join(",")})`);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read pending deletions: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const { id } of data) {
      if (Date.now() >= deadline) break;
      const { error: delError } = await client.auth.admin.deleteUser(id);
      if (delError) failed.push({ userId: id, error: delError.message });
      else purged.push(id);
    }
    if (data.length < batchSize) break;
  }

  const { count, error: countError } = await client
    .from("users")
    .select("id", { count: "exact", head: true })
    .lt("deleted_at", cutoff);
  if (countError) throw new Error(`Failed to count pending deletions: ${countError.message}`);
  return { purged, failed, remaining: count ?? 0 };
}

/** Past this many failures in one run, stop: something systemic is wrong (and the id list stays short). */
const MAX_FAILURES = 50;
