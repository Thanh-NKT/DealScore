import "server-only";
import { fakeShopeeItem, fakeShopeeSearch } from "@/lib/shopee/fake-source";
import { shopeeAffiliateCredentials } from "@/lib/shopee/affiliate-http";
import { fetchShopeeItem, searchShopeeItems } from "@/lib/shopee/affiliate-source";
import { isFakeEnabled, type Env, type MarketplaceSource } from "@/lib/marketplaces/types";

/** fake (dev) → real Shopee Affiliate API → none (fetch throws MarketplaceUnavailableError). */
export const shopeeSource: MarketplaceSource = {
  id: "shopee",
  isConfigured: (env: Env = process.env) => isFakeEnabled(env, "SHOPEE_CLIENT") || shopeeAffiliateCredentials(env) != null,
  isFake: (env: Env = process.env) => isFakeEnabled(env, "SHOPEE_CLIENT"),
  async fetchItem(ext) {
    if (isFakeEnabled(process.env, "SHOPEE_CLIENT")) return fakeShopeeItem(ext);
    return fetchShopeeItem(ext);
  },
  async searchItems(q) {
    if (isFakeEnabled(process.env, "SHOPEE_CLIENT")) return fakeShopeeSearch(q);
    return searchShopeeItems(q);
  },
};
