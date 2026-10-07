import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { DEAL_SCORE_VERSION } from "@/lib/pricing/score";
import { ACCURACY_WEEKS, summarizeAccuracy, type AccuracyRow, type AccuracySummary } from "@/lib/transparency/accuracy";

/** Backtests run weekly; an hour of staleness is invisible. */
const ACCURACY_CACHE_SECONDS = 3600;

const n = (v: unknown) => (v == null ? 0 : Number(v));

async function readAccuracyRows(): Promise<AccuracyRow[]> {
  const { data, error } = await createPublicClient().rpc("deal_score_accuracy", { p_weeks: ACCURACY_WEEKS });
  if (error) throw new Error(`deal_score_accuracy failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    ranAt: r.ran_at,
    version: r.version ?? null,
    horizonDays: n(r.horizon_days),
    dropThreshold: n(r.drop_threshold),
    variants: n(r.variants),
    samples: n(r.samples),
    buyN: n(r.buy_n),
    buyCorrect: n(r.buy_correct),
    waitN: n(r.wait_n),
    waitCorrect: n(r.wait_correct),
    avoidN: n(r.avoid_n),
    avoidCorrect: n(r.avoid_correct),
    accuracy: r.accuracy == null ? null : Number(r.accuracy),
  }));
}

const cachedAccuracyRows = unstable_cache(readAccuracyRows, ["deal-score-accuracy-v1"], {
  revalidate: ACCURACY_CACHE_SECONDS,
});

/**
 * Backtest aggregates for /deal-score through the anon RPC (no service role, no session) and a shared
 * one-hour cache — the page itself stays dynamic for the nonce CSP. An RPC error throws (error page),
 * never a fake "no data".
 */
export async function loadAccuracy(): Promise<AccuracySummary> {
  return summarizeAccuracy(await cachedAccuracyRows(), DEAL_SCORE_VERSION);
}
