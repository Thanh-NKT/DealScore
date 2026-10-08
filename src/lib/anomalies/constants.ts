/**
 * Price-anomaly detection thresholds (roadmap P3 item 10, migration 0051). The SQL detector takes them as
 * parameters; the admin app only displays them (GET /api/admin/status → `anomalies`).
 *
 * Starting values chosen without real data — tune them once the collector has run on real listings.
 */

/** A price ≥ 3 × the offer's own 30-day median is a spike (catches an extra zero). */
export const ANOMALY_SPIKE_RATIO = 3;
/** A price ≤ 40% of the median (−60% or more) is a drop. */
export const ANOMALY_DROP_RATIO = 0.4;
/** Baseline window, days before the observation. */
export const ANOMALY_BASELINE_DAYS = 30;
/** Fewer baseline observations than this → no baseline, no anomaly. */
export const ANOMALY_MIN_BASELINE_OBS = 5;
/** The admin "Quét lại" scans at most this many hours back (7 days). */
export const ANOMALY_SCAN_MAX_HOURS = 168;

export type AnomalyThresholds = { spikeRatio: number; dropRatio: number; baselineDays: number; minBaselineObs: number };

export const ANOMALY_THRESHOLDS: AnomalyThresholds = {
  spikeRatio: ANOMALY_SPIKE_RATIO,
  dropRatio: ANOMALY_DROP_RATIO,
  baselineDays: ANOMALY_BASELINE_DAYS,
  minBaselineObs: ANOMALY_MIN_BASELINE_OBS,
};
