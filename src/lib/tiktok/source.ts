import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fakeTikTokItem, fakeTikTokSearch } from "@/lib/tiktok/fake-source";
import { tiktokConfig, type TikTokConfig } from "@/lib/tiktok/config";
import { callTikTok, type TikTokCaller } from "@/lib/tiktok/api";
import { getTikTokAccessToken, supabaseTokenStore, type RefreshBackoff } from "@/lib/tiktok/credentials";
import { refreshTokens } from "@/lib/tiktok/oauth";
import { fetchTikTokItem, fetchTikTokItems, searchTikTokItems } from "@/lib/tiktok/affiliate-source";
import { isFakeEnabled, MarketplaceUnavailableError, type Env, type MarketplaceSource } from "@/lib/marketplaces/types";

/** Shared by every call in this process: a failing refresh is retried at most every REFRESH_BACKOFF_MS. */
const refreshBackoff: RefreshBackoff = { failedAt: null };

function realCaller(cfg: TikTokConfig): TikTokCaller {
  return async <T>(path: string, opts: { query?: Record<string, string>; body?: unknown }) => {
    const accessToken = await getTikTokAccessToken(supabaseTokenStore(createAdminClient()), {
      refresh: (refreshToken) => refreshTokens(cfg, refreshToken),
      backoff: refreshBackoff,
    });
    return callTikTok<T>(cfg, path, opts, { accessToken });
  };
}

function caller(): TikTokCaller {
  const cfg = tiktokConfig(process.env);
  if (!cfg) throw new MarketplaceUnavailableError("TikTok Shop source is not configured", { marketplace: "tiktok" });
  return realCaller(cfg);
}

/**
 * fake (dev) → real TikTok Shop Affiliate API → none. A missing OAuth token does NOT make it unconfigured:
 * calls then fail with "not authorized", which shows up in collector/sourcing error summaries.
 */
export const tiktokSource: MarketplaceSource = {
  id: "tiktok",
  isConfigured: (env: Env = process.env) => isFakeEnabled(env, "TIKTOK_CLIENT") || tiktokConfig(env) != null,
  isFake: (env: Env = process.env) => isFakeEnabled(env, "TIKTOK_CLIENT"),
  async fetchItem(id) {
    if (isFakeEnabled(process.env, "TIKTOK_CLIENT")) return fakeTikTokItem(id);
    return fetchTikTokItem(id, caller());
  },
  async fetchItems(ids) {
    if (isFakeEnabled(process.env, "TIKTOK_CLIENT")) return new Map(ids.map((id) => [id, fakeTikTokItem(id)]));
    return fetchTikTokItems(ids, caller());
  },
  async searchItems(q) {
    if (isFakeEnabled(process.env, "TIKTOK_CLIENT")) return fakeTikTokSearch(q);
    return searchTikTokItems(q, caller());
  },
};
