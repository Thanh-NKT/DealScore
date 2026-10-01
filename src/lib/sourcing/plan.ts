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
}

const DEFAULT_DAILY_CAP = 500;

/** New listings per marketplace per Vietnam day. 0 disables sourcing. */
export function sourcingCap(env: Env = process.env): number {
  const n = Number.parseInt(env.SOURCING_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

/** Active queries, never-run first, then the least recently run. Pure. */
export function planSourcing(queries: SourcingQuery[]): SourcingQuery[] {
  const key = (q: SourcingQuery) => (q.lastRunAt ? Date.parse(q.lastRunAt) : -Infinity);
  return queries.filter((q) => q.active).sort((a, b) => key(a) - key(b));
}
