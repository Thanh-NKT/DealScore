import type { Env } from "@/lib/marketplaces/types";

/** TikTok Shop Affiliate API settings from env. Hosts are assumptions T2/T3 and can be overridden. */
export interface TikTokConfig {
  appKey: string;
  appSecret: string;
  serviceId: string;
  apiUrl: string;
  authUrl: string;
  authorizeUrl: string;
}

export function tiktokConfig(env: Env): TikTokConfig | null {
  const appKey = env.TIKTOK_SHOP_APP_KEY;
  const appSecret = env.TIKTOK_SHOP_APP_SECRET;
  const serviceId = env.TIKTOK_SHOP_SERVICE_ID;
  if (!appKey || !appSecret || !serviceId) return null;
  return {
    appKey,
    appSecret,
    serviceId,
    apiUrl: (env.TIKTOK_SHOP_API_URL || "https://open-api.tiktokglobalshop.com").replace(/\/+$/, ""),
    authUrl: (env.TIKTOK_SHOP_AUTH_URL || "https://auth.tiktok-shops.com").replace(/\/+$/, ""),
    authorizeUrl: env.TIKTOK_SHOP_AUTHORIZE_URL || "https://services.tiktokshop.com/open/authorize",
  };
}
