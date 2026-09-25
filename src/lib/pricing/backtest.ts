/**
 * Backtest of the Buy / Wait / Avoid recommendation (1.10, G2 gate "Buy/Wait ≥ 80%"). Pure.
 *
 * At each evaluation day d the recommendation is recomputed from the history up to d only, then
 * judged against what the price did over the next `horizonDays`:
 *   buy         is right when the price did NOT drop by ≥ dropThreshold afterwards;
 *   wait/avoid  are right when it did.
 */
import type { PriceObservation, Recommendation } from "@/lib/pricing/deal-score";
import { scoreDeal, type DealScoreVersion } from "@/lib/pricing/score";
import { expandRollup, type DailyPriceRow } from "@/lib/pricing/price-history";

export type BacktestClassifier = (price: number, history: PriceObservation[], now: Date) => Recommendation;

export interface BacktestOptions {
  horizonDays?: number;
  dropThreshold?: number;
  stepDays?: number;
  windowDays?: number;
  /** Injected in tests; defaults to scoreDeal() with `version`. */
  classify?: BacktestClassifier;
  /** Deal Score version replayed by the default classifier. */
  version?: DealScoreVersion;
}

export interface BacktestTally {
  n: number;
  correct: number;
}

export interface BacktestResult {
  samples: number;
  buy: BacktestTally;
  wait: BacktestTally;
  avoid: BacktestTally;
}

export const DEFAULT_HORIZON_DAYS = 30;
export const DEFAULT_DROP_THRESHOLD = 0.05;
const DEFAULT_STEP_DAYS = 7;
const MS_PER_DAY = 86_400_000;

function emptyResult(): BacktestResult {
  return { samples: 0, buy: { n: 0, correct: 0 }, wait: { n: 0, correct: 0 }, avoid: { n: 0, correct: 0 } };
}

function dayIndex(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY);
}

export function backtestVariant(rows: DailyPriceRow[], opts: BacktestOptions = {}): BacktestResult {
  const horizon = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const drop = opts.dropThreshold ?? DEFAULT_DROP_THRESHOLD;
  const step = opts.stepDays ?? DEFAULT_STEP_DAYS;
  const classify: BacktestClassifier =
    opts.classify ??
    ((price, history, now) => scoreDeal({ price, history, now, windowDays: opts.windowDays }, opts.version).recommendation);

  const result = emptyResult();
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  if (sorted.length === 0) return result;

  const byIndex = new Map<number, DailyPriceRow>();
  for (const r of sorted) byIndex.set(dayIndex(r.day), r);
  const first = dayIndex(sorted[0].day);
  const last = dayIndex(sorted[sorted.length - 1].day);

  for (let d = last - horizon; d >= first; d -= step) {
    const today = byIndex.get(d);
    const price = today?.min_price;
    if (!today || price == null || !(price > 0)) continue;

    const history = expandRollup(sorted.filter((r) => dayIndex(r.day) <= d));
    // 12:00 Vietnam time on day d — same convention as expandRollup().
    const rec = classify(price, history, new Date(`${today.day}T05:00:00.000Z`));
    if (rec === "insufficient_data") continue;

    let futureMin = Infinity;
    for (let k = d + 1; k <= d + horizon; k++) {
      const p = byIndex.get(k)?.min_price;
      if (p != null && p > 0) futureMin = Math.min(futureMin, p);
    }
    if (futureMin === Infinity) continue;

    const dropped = futureMin <= price * (1 - drop);
    const tally = result[rec];
    tally.n++;
    if (rec === "buy" ? !dropped : dropped) tally.correct++;
    result.samples++;
  }
  return result;
}

export function mergeResults(results: BacktestResult[]): BacktestResult {
  const out = emptyResult();
  for (const r of results) {
    out.samples += r.samples;
    for (const k of ["buy", "wait", "avoid"] as const) {
      out[k].n += r[k].n;
      out[k].correct += r[k].correct;
    }
  }
  return out;
}

export function accuracy(r: BacktestResult): number | null {
  if (r.samples === 0) return null;
  return (r.buy.correct + r.wait.correct + r.avoid.correct) / r.samples;
}
