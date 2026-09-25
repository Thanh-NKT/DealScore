/**
 * Health verdict for /api/health (1.10 uptime monitoring). Pure.
 *
 * "down" (HTTP 503) only when the DB is unreachable — that is an outage. A late collector is
 * "degraded" (HTTP 200): the site still works, prices are just ageing; uptime tools catch it
 * with a keyword check on the body.
 */

export const COLLECTOR_STALE_HOURS = 6;

export type HealthStatus = "ok" | "degraded" | "down";

export interface Health {
  status: HealthStatus;
  checks: { db: "ok" | "error"; collector: "ok" | "stale" | "not_configured" | "unknown" };
}

export function assessHealth(input: {
  dbOk: boolean;
  collectorConfigured: boolean;
  lastRunFinishedAt: string | null;
  now: Date;
}): Health {
  if (!input.dbOk) return { status: "down", checks: { db: "error", collector: "unknown" } };
  if (!input.collectorConfigured) return { status: "ok", checks: { db: "ok", collector: "not_configured" } };

  const age = input.lastRunFinishedAt
    ? (input.now.getTime() - new Date(input.lastRunFinishedAt).getTime()) / 3_600_000
    : Infinity;
  return age > COLLECTOR_STALE_HOURS
    ? { status: "degraded", checks: { db: "ok", collector: "stale" } }
    : { status: "ok", checks: { db: "ok", collector: "ok" } };
}
