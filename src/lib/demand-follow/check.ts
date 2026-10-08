import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow, resolveChannels } from "@/lib/account/notification-settings";
import { computeDeliverAfter } from "@/lib/alerts/schedule";
import { searchProductsWith } from "@/lib/search";
import { resolveSearchParams } from "@/lib/search/resolve-params";
import { discoveryEventPayload, toMatches } from "@/lib/saved-search/evaluate";
import { decideDemandFollow } from "@/lib/demand-follow/decide";
import {
  DEMAND_FOLLOW_CHECK_BATCH,
  DEMAND_FOLLOW_CHECK_INTERVAL_HOURS,
  DEMAND_FOLLOW_SCAN_LIMIT,
  DEMAND_FOUND_USER_COOLDOWN_HOURS,
} from "@/lib/demand-follow/constants";

type Client = SupabaseClient<Database>;

/**
 * Demand-follow pass of the discovery cron (spec §3.2): re-run each waiting keyword the way the user searched it
 * (intent on, never preferences); one alert when it now finds a product it did not have, then the follow is done.
 */
export async function checkDemandFollows(
  opts: { now: Date; deadline?: number; limit?: number },
  client: Client = createAdminClient(),
): Promise<{ checked: number; found: number; expired: number; deferred: number; errors: number }> {
  const stats = { checked: 0, found: 0, expired: 0, deferred: 0, errors: 0 };
  const dueBefore = new Date(opts.now.getTime() - DEMAND_FOLLOW_CHECK_INTERVAL_HOURS * 3_600_000).toISOString();
  const { data: rows, error } = await client
    .from("demand_follows")
    .select("id, keyword, known_product_ids, expires_at, users!inner(deleted_at, notification_settings(*))")
    .eq("status", "waiting")
    .is("users.deleted_at", null)
    .or(`last_checked_at.is.null,last_checked_at.lt.${dueBefore}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(opts.limit ?? DEMAND_FOLLOW_CHECK_BATCH, DEMAND_FOLLOW_CHECK_BATCH));
  if (error) throw new Error(`Failed to read demand follows: ${error.message}`);

  for (const f of rows ?? []) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      const record = async (status: "waiting" | "found" | "expired", event: Record<string, unknown> | null) => {
        const { data, error: rpcError } = await client.rpc("record_demand_follow_check", {
          p_id: f.id,
          p_now: opts.now.toISOString(),
          p_status: status,
          p_event: event as never,
        });
        if (rpcError) throw new Error(rpcError.message);
        return data;
      };
      stats.checked++;
      if (opts.now.getTime() >= Date.parse(f.expires_at)) {
        await record("expired", null);
        stats.expired++;
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = f.users as any;
      const settings = u?.notification_settings ? fromRow(u.notification_settings) : DEFAULT_NOTIFICATION_SETTINGS;
      const { params } = await resolveSearchParams({ q: f.keyword, sort: "relevance", page: 1 });
      const result = await searchProductsWith(client, { ...params, page: 1 }, { limit: DEMAND_FOLLOW_SCAN_LIMIT });
      const d = decideDemandFollow(
        { keyword: f.keyword, knownProductIds: f.known_product_ids, expiresAt: f.expires_at },
        toMatches(result.items),
        opts.now,
      );
      if (d.kind === "expire") {
        await record("expired", null);
        stats.expired++;
        continue;
      }
      const channels = resolveChannels(settings, null);
      if (d.kind === "wait" || channels.length === 0) {
        // No channel: only last_checked_at moves; the follow keeps waiting for a channel to be turned on.
        await record("waiting", null);
        continue;
      }
      const eventId = await record(
        "found",
        discoveryEventPayload(d.items, d.totalNew, computeDeliverAfter(settings, opts.now), channels, {
          user_cooldown_hours: DEMAND_FOUND_USER_COOLDOWN_HOURS,
        }),
      );
      if (eventId) stats.found++;
      else stats.deferred++; // the user had a demand_found alert in the last 24 h: stays waiting
    } catch (err) {
      stats.errors++;
      console.error(`checkDemandFollows: error on follow ${f.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return stats;
}
