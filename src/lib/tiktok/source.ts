import "server-only";
import { fakeTikTokItem, fakeTikTokSearch } from "@/lib/tiktok/fake-source";
import { isFakeEnabled, MarketplaceUnavailableError, type Env, type MarketplaceSource } from "@/lib/marketplaces/types";

const notConfigured = () => new MarketplaceUnavailableError("TikTok Shop source is not configured", { marketplace: "tiktok" });

/** fake (dev) → real TikTok Shop Affiliate API (Task 8) → none. */
export const tiktokSource: MarketplaceSource = {
  id: "tiktok",
  isConfigured: (env: Env = process.env) => isFakeEnabled(env, "TIKTOK_CLIENT"),
  isFake: (env: Env = process.env) => isFakeEnabled(env, "TIKTOK_CLIENT"),
  async fetchItem(id) {
    if (isFakeEnabled(process.env, "TIKTOK_CLIENT")) return fakeTikTokItem(id);
    throw notConfigured();
  },
  async searchItems(q) {
    if (isFakeEnabled(process.env, "TIKTOK_CLIENT")) return fakeTikTokSearch(q);
    throw notConfigured();
  },
};
