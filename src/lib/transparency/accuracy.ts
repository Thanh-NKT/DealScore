import type { DealScoreVersion } from "@/lib/pricing/score";

/**
 * Deal Score transparency page (roadmap P2 item I). Pure: turns backtest_runs aggregates
 * (deal_score_accuracy RPC) into what /deal-score may publish. Rates are recomputed from the counts and
 * hidden below the sample minimums — tune with real data.
 */
export const ACCURACY_WEEKS = 12;
/** The headline rate is published only from this many samples in the latest run. */
export const ACCURACY_MIN_SAMPLES = 200;
/** A per-verdict rate is published only from this many samples of that verdict. */
export const ACCURACY_MIN_CLASS_SAMPLES = 30;

export interface AccuracyRow {
  ranAt: string;
  version: string | null;
  horizonDays: number;
  dropThreshold: number;
  variants: number;
  samples: number;
  buyN: number;
  buyCorrect: number;
  waitN: number;
  waitCorrect: number;
  avoidN: number;
  avoidCorrect: number;
  accuracy: number | null;
}

export interface Rate {
  n: number;
  correct: number;
  /** 0..1, null under ACCURACY_MIN_CLASS_SAMPLES. */
  pct: number | null;
}

export interface AccuracySummary {
  latest: {
    ranAt: string;
    version: string;
    samples: number;
    variants: number;
    horizonDays: number;
    dropThreshold: number;
    /** 0..1, recomputed from the counts; null without samples. */
    overall: number | null;
    buy: Rate;
    wait: Rate;
    avoid: Rate;
  } | null;
  /** Oldest → newest, live version only. */
  trend: Array<{ ranAt: string; overall: number | null }>;
  /** latest.samples ≥ ACCURACY_MIN_SAMPLES */
  enough: boolean;
}

const rate = (n: number, correct: number): Rate => ({ n, correct, pct: n >= ACCURACY_MIN_CLASS_SAMPLES ? correct / n : null });
const overallOf = (r: AccuracyRow) => (r.samples > 0 ? (r.buyCorrect + r.waitCorrect + r.avoidCorrect) / r.samples : null);

export function summarizeAccuracy(rows: AccuracyRow[], liveVersion: DealScoreVersion): AccuracySummary {
  const live = rows.filter((r) => r.version === liveVersion).sort((a, b) => Date.parse(a.ranAt) - Date.parse(b.ranAt));
  const last = live.at(-1);
  if (!last) return { latest: null, trend: [], enough: false };
  return {
    latest: {
      ranAt: last.ranAt,
      version: liveVersion,
      samples: last.samples,
      variants: last.variants,
      horizonDays: last.horizonDays,
      dropThreshold: last.dropThreshold,
      overall: overallOf(last),
      buy: rate(last.buyN, last.buyCorrect),
      wait: rate(last.waitN, last.waitCorrect),
      avoid: rate(last.avoidN, last.avoidCorrect),
    },
    trend: live.map((r) => ({ ranAt: r.ranAt, overall: overallOf(r) })),
    enough: last.samples >= ACCURACY_MIN_SAMPLES,
  };
}
