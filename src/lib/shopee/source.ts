import "server-only";
import { fakeShopeeItem, fakeShopeeSearch } from "@/lib/shopee/fake-source";
import { isFakeEnabled, MarketplaceUnavailableError, type Env, type MarketplaceSource } from "@/lib/marketplaces/types";

const notConfigured = () => new MarketplaceUnavailableError("Shopee source is not configured", { marketplace: "shopee" });

/** fake (dev) → real Shopee Affiliate API (Task 5) → none. */
export const shopeeSource: MarketplaceSource = {
  id: "shopee",
  isConfigured: (env: Env = process.env) => isFakeEnabled(env, "SHOPEE_CLIENT"),
  isFake: (env: Env = process.env) => isFakeEnabled(env, "SHOPEE_CLIENT"),
  async fetchItem(ext) {
    if (isFakeEnabled(process.env, "SHOPEE_CLIENT")) return fakeShopeeItem(ext);
    throw notConfigured();
  },
  async searchItems(q) {
    if (isFakeEnabled(process.env, "SHOPEE_CLIENT")) return fakeShopeeSearch(q);
    throw notConfigured();
  },
};
