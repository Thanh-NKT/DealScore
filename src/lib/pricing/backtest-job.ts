import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  accuracy,
  backtestVariant,
  DEFAULT_DROP_THRESHOLD,
  DEFAULT_HORIZON_DAYS,
  mergeResults,
  type BacktestResult,
} from "@/lib/pricing/backtest";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { toVnDate } from "@/lib/format";
import { DEAL_SCORE_VERSION, type DealScoreVersion } from "@/lib/pricing/score";

/**
 * Weekly backtest (1.10): replay Buy/Wait/Avoid over the last LOOKBACK_DAYS of every variant and
 * store the accuracy in backtest_runs — the number behind the G2 gate "Buy/Wait ≥ 80%".
 */

const LOOKBACK_DAYS = 180;
const PAGE = 1000;
/** 5 variants × 180 days ≤ 900 rows per query — under the silent 1000-row cap of PostgREST. */
const HISTORY_CHUNK = 5;

export async function runBacktest(
  client: SupabaseClient<Database>,
  opts: { now?: Date; deadline?: number; version?: DealScoreVersion } = {},
): Promise<{ runId: string; version: DealScoreVersion; variants: number; result: BacktestResult; accuracy: number | null }> {
  const version = opts.version ?? DEAL_SCORE_VERSION;
  const now = opts.now ?? new Date();
  const since = toVnDate(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));

  const variantIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("variant_current_price")
      .select("variant_id")
      .order("variant_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to list variants: ${error.message}`);
    variantIds.push(...(data ?? []).map((r) => r.variant_id));
    if (!data || data.length < PAGE) break;
  }

  const results: BacktestResult[] = [];
  let variants = 0;
  for (let i = 0; i < variantIds.length; i += HISTORY_CHUNK) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const chunk = variantIds.slice(i, i + HISTORY_CHUNK);
    const { data, error } = await client
      .from("variant_daily_prices")
      .select("*")
      .in("variant_id", chunk)
      .gte("day", since)
      .order("day", { ascending: true });
    if (error) throw new Error(`Failed to read daily prices: ${error.message}`);

    const byVariant = new Map<string, DailyPriceRow[]>();
    for (const r of data ?? []) {
      const list = byVariant.get(r.variant_id) ?? [];
      list.push(r as unknown as DailyPriceRow);
      byVariant.set(r.variant_id, list);
    }
    for (const rows of byVariant.values()) {
      results.push(backtestVariant(rows, { version }));
      variants++;
    }
  }

  const result = mergeResults(results);
  const acc = accuracy(result);
  const { data: run, error } = await client
    .from("backtest_runs")
    .insert({
      ran_at: now.toISOString(),
      version,
      horizon_days: DEFAULT_HORIZON_DAYS,
      drop_threshold: DEFAULT_DROP_THRESHOLD,
      variants,
      samples: result.samples,
      buy_n: result.buy.n,
      buy_correct: result.buy.correct,
      wait_n: result.wait.n,
      wait_correct: result.wait.correct,
      avoid_n: result.avoid.n,
      avoid_correct: result.avoid.correct,
      accuracy: acc == null ? null : Math.round(acc * 10_000) / 10_000,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(`Failed to store backtest run: ${error?.message}`);

  return { runId: run.id, version, variants, result, accuracy: acc };
}
