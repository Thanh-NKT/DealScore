import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow, resolveChannels } from "@/lib/account/notification-settings";
import { decideAlert } from "@/lib/watch/decide";
import { decideHikeAlert } from "@/lib/watch/price-hike";
import { configFromRow, stateFromRow, toRpcState, type WatchRow } from "@/lib/watch/rows";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import { computeDeliverAfter } from "@/lib/alerts/schedule";
import { FEW_OBSERVATIONS_REASON_PREFIX, NEW_TRACKING_REASON_PREFIX } from "@/lib/pricing/deal-score";

/** Data-coverage notes are not reasons to buy: they stay out of the alert. */
const isCoverageReason = (r: string) => r.startsWith(NEW_TRACKING_REASON_PREFIX) || r.startsWith(FEW_OBSERVATIONS_REASON_PREFIX);

export async function evaluateWatches(
  opts: { now: Date; variantIds?: string[]; limit?: number; deadline?: number },
  client: SupabaseClient<Database> = createAdminClient(),
): Promise<{ evaluated: number; alerts: number; suppressed: number; skippedStale: number; errors: number }> {
  const stats = { evaluated: 0, alerts: 0, suppressed: 0, skippedStale: 0, errors: 0 };

  let q = client
    .from("watches")
    .select("*, users!inner(deleted_at, notification_settings(*))")
    .eq("status", "active")
    .is("users.deleted_at", null)
    .order("last_evaluated_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(opts.limit ?? 500, 999));
  if (opts.variantIds) q = q.in("variant_id", opts.variantIds);
  const { data: watches, error } = await q;
  if (error) throw new Error(`Failed to read Watches for evaluation: ${error.message}`);
  if (!watches || watches.length === 0) return stats;

  // Snapshot load failure → the whole run fails (route returns 500).
  const snaps = await loadVariantSnapshots(client, watches.map((w) => w.variant_id), opts.now);

  for (const w of watches) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    try {
      const u = w.users as unknown as {
        notification_settings: Database["public"]["Tables"]["notification_settings"]["Row"] | null;
      };
      const settings = u.notification_settings ? fromRow(u.notification_settings) : DEFAULT_NOTIFICATION_SETTINGS;
      const config = configFromRow(w as WatchRow);
      const state = stateFromRow(w as WatchRow);

      // No channel → write no state: re-enabling a channel still reports a condition that is currently true.
      const channels = resolveChannels(settings, config.channels);
      if (channels.length === 0) continue;

      const snap = snaps.get(w.variant_id)!;
      const d = decideAlert(config, state, snap, opts.now);
      // Separate alert kind with its own state and cooldown; a price-drop alert in this run wins.
      const h = decideHikeAlert(config, state, snap, opts.now, d);
      stats.evaluated++;

      let pState: Record<string, unknown> = {};
      let pEvent: Record<string, unknown> | null = null;

      if (d.kind === "skip_stale") {
        stats.skippedStale++; // only bump last_evaluated_at so watches rotate
      } else {
        pState = toRpcState(d.nextState!, h.next);
        if (d.kind === "suppressed_cooldown") stats.suppressed++;
        if (d.kind === "alert") {
          pEvent = {
            trigger_types: d.triggerTypes,
            price: snap.price,
            offer_id: snap.offerId,
            baseline_price: state.baselinePrice, // baseline BEFORE it is moved
            previous_alert_price: state.lastAlertPrice,
            deal_score: snap.deal?.score ?? null,
            recommendation: snap.deal?.recommendation ?? null,
            score_reasons: (snap.deal?.reasons ?? []).filter((r) => !isCoverageReason(r)),
            deliver_after: computeDeliverAfter(settings, opts.now).toISOString(),
            channels,
          };
        } else if (h.fire) {
          pEvent = {
            trigger_types: ["price_hike"],
            price: snap.price,
            offer_id: snap.offerId,
            baseline_price: state.baselinePrice,
            previous_alert_price: state.lastAlertPrice,
            // The prior 60-day median the hike was measured against (trigger text).
            reference_price: snap.hike?.priorMedian ?? null,
            deal_score: snap.deal?.score ?? null,
            recommendation: snap.deal?.recommendation ?? null,
            score_reasons: (snap.deal?.reasons ?? []).filter((r) => !isCoverageReason(r)),
            deliver_after: computeDeliverAfter(settings, opts.now).toISOString(),
            channels,
          };
        }
      }

      const { data: eventId, error: rpcError } = await client.rpc("record_watch_evaluation", {
        p_watch_id: w.id,
        p_config_version: w.config_version,
        p_now: opts.now.toISOString(),
        p_state: pState as never,
        p_event: pEvent as never,
      });
      if (rpcError) throw new Error(rpcError.message);
      if (eventId) stats.alerts++;
    } catch (err) {
      stats.errors++;
      console.error(`evaluateWatches: error on watch ${w.id}:`, err);
    }
  }
  return stats;
}
