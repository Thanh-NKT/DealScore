import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow, resolveChannels, type Channel } from "@/lib/account/notification-settings";
import { computeDeliverAfter } from "@/lib/alerts/schedule";
import { toEventItems } from "@/lib/alerts/discovery";
import { searchProductsWith, type SearchItem } from "@/lib/search";
import { parseSavedParams, savedToSearchParams } from "@/lib/saved-search/params";
import { decideSavedSearch, type SavedSearchMatch, type SavedSearchHitState } from "@/lib/saved-search/decide";
import {
  SAVED_SEARCH_COOLDOWN_HOURS,
  SAVED_SEARCH_EVAL_BATCH,
  SAVED_SEARCH_EVAL_INTERVAL_HOURS,
  SAVED_SEARCH_SCAN_LIMIT,
} from "@/lib/saved-search/constants";
import type { Recommendation } from "@/lib/pricing/deal-score";

type Client = SupabaseClient<Database>;

/** A search card → a match. Cards without a price never match (nothing to announce). */
export function toMatches(items: SearchItem[]): SavedSearchMatch[] {
  return items
    .filter((i) => i.bestPrice != null && i.bestPrice > 0)
    .map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      price: i.bestPrice!,
      recommendation: (i.recommendation as Recommendation | null) ?? null,
      score: i.score,
      lastObservedAt: i.lastObservedAt,
    }));
}

/** The alert_events payload for record_saved_search_evaluation / record_demand_follow_check. */
export function discoveryEventPayload(
  items: SavedSearchMatch[],
  totalNew: number,
  deliverAfter: Date,
  channels: Channel[],
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    items: toEventItems(items),
    items_total: Math.max(totalNew, items.length),
    price: items.length > 0 ? Math.min(...items.map((i) => i.price)) : null,
    deal_score: items[0]?.score ?? null,
    recommendation: items[0]?.recommendation ?? null,
    deliver_after: deliverAfter.toISOString(),
    channels,
    ...extra,
  };
}

const HITS_PAGE = 1000;

/**
 * Saved-search pass of the discovery cron (spec §2.2). Due = active, owner not deleted, never evaluated or
 * evaluated more than SAVED_SEARCH_EVAL_INTERVAL_HOURS ago. Never writes watches or calls decideAlert().
 */
export async function evaluateSavedSearches(
  opts: { now: Date; deadline?: number; limit?: number },
  client: Client = createAdminClient(),
): Promise<{ evaluated: number; alerts: number; suppressed: number; errors: number }> {
  const stats = { evaluated: 0, alerts: 0, suppressed: 0, errors: 0 };
  const dueBefore = new Date(opts.now.getTime() - SAVED_SEARCH_EVAL_INTERVAL_HOURS * 3_600_000).toISOString();
  const { data: rows, error } = await client
    .from("saved_searches")
    .select("id, user_id, params, params_version, channels, initialized_at, last_alerted_at, users!inner(deleted_at, notification_settings(*))")
    .eq("status", "active")
    .is("users.deleted_at", null)
    .or(`last_evaluated_at.is.null,last_evaluated_at.lt.${dueBefore}`)
    .order("last_evaluated_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(opts.limit ?? SAVED_SEARCH_EVAL_BATCH, SAVED_SEARCH_EVAL_BATCH));
  if (error) throw new Error(`Failed to read saved searches: ${error.message}`);
  if (!rows || rows.length === 0) return stats;

  // Hits of the batch (≤ 20 × ~48 rows), paged past the 1,000-row cap.
  const hitsBy = new Map<string, SavedSearchHitState[]>();
  const ids = rows.map((r) => r.id);
  for (let from = 0; ; from += HITS_PAGE) {
    const { data: hits, error: hErr } = await client
      .from("saved_search_hits")
      .select("saved_search_id, product_id, in_set, alerted_at")
      .in("saved_search_id", ids)
      .order("saved_search_id")
      .order("product_id")
      .range(from, from + HITS_PAGE - 1);
    if (hErr) throw new Error(`Failed to read saved search hits: ${hErr.message}`);
    for (const h of hits ?? []) {
      const list = hitsBy.get(h.saved_search_id) ?? [];
      list.push({ productId: h.product_id, inSet: h.in_set, alertedAt: h.alerted_at });
      hitsBy.set(h.saved_search_id, list);
    }
    if (!hits || hits.length < HITS_PAGE) break;
  }

  for (const r of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = r.users as any;
      const settings = u?.notification_settings ? fromRow(u.notification_settings) : DEFAULT_NOTIFICATION_SETTINGS;
      // No channel → write no state (same as watches): turning a channel back on still reports what is new.
      const channels = resolveChannels(settings, (r.channels as Channel[] | null) ?? null);
      if (channels.length === 0) continue;
      const params = parseSavedParams(r.params);
      if (!params) {
        stats.errors++;
        continue;
      }
      const result = await searchProductsWith(client, savedToSearchParams(params), { limit: SAVED_SEARCH_SCAN_LIMIT });
      const d = decideSavedSearch(
        { initializedAt: r.initialized_at, lastAlertedAt: r.last_alerted_at, hits: hitsBy.get(r.id) ?? [] },
        toMatches(result.items),
        opts.now,
      );
      stats.evaluated++;
      if (d.kind === "suppressed_cooldown") stats.suppressed++;
      const event =
        d.kind === "alert"
          ? discoveryEventPayload(d.items, d.totalNew, computeDeliverAfter(settings, opts.now), channels, {
              cooldown_hours: SAVED_SEARCH_COOLDOWN_HOURS,
            })
          : null;
      const { data: eventId, error: rpcError } = await client.rpc("record_saved_search_evaluation", {
        p_id: r.id,
        p_params_version: r.params_version,
        p_now: opts.now.toISOString(),
        p_hits: d.hits.map((h) => ({ product_id: h.productId, in_set: h.inSet, alerted: h.alerted, price: h.price })) as never,
        p_event: event as never,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (eventId) stats.alerts++;
      else if (d.kind === "alert") stats.suppressed++;
    } catch (err) {
      stats.errors++;
      console.error(`evaluateSavedSearches: error on saved search ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return stats;
}
