import type { Env, MarketplaceId } from "@/lib/marketplaces/types";

/** One row of sourcing_queries. */
export interface SourcingQuery {
  id: string;
  marketplace: MarketplaceId;
  kind: "keyword" | "category";
  value: string;
  active: boolean;
  nextPage: string | null;
  lastRunAt: string | null;
  origin: "seed" | "demand";
  requestCount: number;
  lastRequestedAt: string | null;
}

export type SourcingMode = "all" | "demand";
/** Demand-only runs (every 3 hours) stay small: they share the marketplace quota with the collector. */
export const DEMAND_QUERIES_PER_RUN = 5;

/** A user asked for this and sourcing has not answered since. */
export function isPendingDemand(q: SourcingQuery): boolean {
  if (q.origin !== "demand") return false;
  if (!q.lastRunAt) return true;
  return q.lastRequestedAt != null && Date.parse(q.lastRequestedAt) > Date.parse(q.lastRunAt);
}

const DEFAULT_DAILY_CAP = 500;

/** New listings per marketplace per Vietnam day. 0 disables sourcing. */
export function sourcingCap(env: Env = process.env): number {
  const n = Number.parseInt(env.SOURCING_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

/**
 * Active queries to run, in order. Pure.
 * 'all': pending demand first (most requested first), then never-run, then least recently run.
 * 'demand': only pending demand, at most DEMAND_QUERIES_PER_RUN.
 */
export function planSourcing(queries: SourcingQuery[], opts: { mode?: SourcingMode } = {}): SourcingQuery[] {
  const active = queries.filter((q) => q.active);
  const pending = active.filter(isPendingDemand).sort((a, b) => b.requestCount - a.requestCount);
  if (opts.mode === "demand") return pending.slice(0, DEMAND_QUERIES_PER_RUN);
  const key = (q: SourcingQuery) => (q.lastRunAt ? Date.parse(q.lastRunAt) : -Infinity);
  const rest = active.filter((q) => !isPendingDemand(q)).sort((a, b) => key(a) - key(b));
  return [...pending, ...rest];
}
