import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ANOMALY_THRESHOLDS } from "@/lib/anomalies/constants";

/**
 * Queue observations since `since` whose price is far from the offer's own median (rpc
 * detect_price_anomalies, 0051). Never invalidates anything: only the admin does. Returns the number of
 * new anomaly rows; throws on a DB error.
 */
export async function detectPriceAnomalies(
  client: SupabaseClient<Database>,
  opts: { since: Date; offerIds?: string[] },
): Promise<number> {
  const t = ANOMALY_THRESHOLDS;
  const { data, error } = await client.rpc("detect_price_anomalies", {
    p_since: opts.since.toISOString(),
    p_baseline_days: t.baselineDays,
    p_spike_ratio: t.spikeRatio,
    p_drop_ratio: t.dropRatio,
    p_min_baseline_obs: t.minBaselineObs,
    ...(opts.offerIds ? { p_offer_ids: opts.offerIds } : {}),
  });
  if (error) throw new Error(`detect_price_anomalies: ${error.message}`);
  return Number(data ?? 0);
}
