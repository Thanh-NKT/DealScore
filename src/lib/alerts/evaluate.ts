import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow, resolveChannels } from "@/lib/notification-settings";
import { decideAlert } from "@/lib/watch/decide";
import { configFromRow, stateFromRow, toRpcState, type WatchRow } from "@/lib/watch/rows";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import { computeDeliverAfter } from "@/lib/alerts/schedule";

const NEW_TRACKING_REASON = "⚠ Hệ thống mới theo dõi";

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
  if (error) throw new Error(`Đọc Watch để đánh giá thất bại: ${error.message}`);
  if (!watches || watches.length === 0) return stats;

  // Lỗi tải snapshot → cả lượt thất bại (route trả 500).
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

      // Không kênh nào → không ghi trạng thái: bật lại kênh thì điều kiện đang đúng vẫn được báo.
      const channels = resolveChannels(settings, config.channels);
      if (channels.length === 0) continue;

      const snap = snaps.get(w.variant_id)!;
      const d = decideAlert(config, state, snap, opts.now);
      stats.evaluated++;

      let pState: Record<string, unknown> = {};
      let pEvent: Record<string, unknown> | null = null;

      if (d.kind === "skip_stale") {
        stats.skippedStale++; // chỉ dời last_evaluated_at để luân phiên
      } else {
        pState = toRpcState(d.nextState!);
        if (d.kind === "suppressed_cooldown") stats.suppressed++;
        if (d.kind === "alert") {
          pEvent = {
            trigger_types: d.triggerTypes,
            price: snap.price,
            offer_id: snap.offerId,
            baseline_price: state.baselinePrice, // mốc TRƯỚC khi dời
            previous_alert_price: state.lastAlertPrice,
            deal_score: snap.deal?.score ?? null,
            recommendation: snap.deal?.recommendation ?? null,
            score_reasons: (snap.deal?.reasons ?? []).filter((r) => !r.startsWith(NEW_TRACKING_REASON)),
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
      console.error(`evaluateWatches: lỗi ở watch ${w.id}:`, err);
    }
  }
  return stats;
}
