import type { Env } from "@/lib/marketplaces/types";

/** TikTok Shop Affiliate API settings from env. Hosts are assumptions T2/T3 and can be overridden. */
export interface TikTokConfig {
  appKey: string;
  appSecret: string;
  apiUrl: string;
  authUrl: string;
  /** T3 — creator authorization page (`app_key` + `state`), not the seller `services.tiktokshop.com` one. */
  authorizeUrl: string;
}

export function tiktokConfig(env: Env): TikTokConfig | null {
  const appKey = env.TIKTOK_SHOP_APP_KEY;
  const appSecret = env.TIKTOK_SHOP_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return {
    appKey,
    appSecret,
    apiUrl: (env.TIKTOK_SHOP_API_URL || "https://open-api.tiktokglobalshop.com").replace(/\/+$/, ""),
    authUrl: (env.TIKTOK_SHOP_AUTH_URL || "https://auth.tiktok-shops.com").replace(/\/+$/, ""),
    authorizeUrl: env.TIKTOK_SHOP_AUTHORIZE_URL || "https://shop.tiktok.com/alliance/creator/auth",
  };
}
