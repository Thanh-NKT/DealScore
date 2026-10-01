import "server-only";
import { shopeeSource } from "@/lib/shopee/source";
import { tiktokSource } from "@/lib/tiktok/source";
import type { Env, MarketplaceId, MarketplaceSource } from "@/lib/marketplaces/types";

/** Data sources by marketplace. Lazada has none yet. Adding one = one entry here. */
const SOURCES: readonly MarketplaceSource[] = [shopeeSource, tiktokSource];

export function getSource(id: string): MarketplaceSource | null {
  return SOURCES.find((s) => s.id === id) ?? null;
}

/** Marketplaces the collector / lookup / sourcing can use right now. */
export function configuredMarketplaces(env: Env = process.env): MarketplaceId[] {
  return SOURCES.filter((s) => s.isConfigured(env)).map((s) => s.id);
}
