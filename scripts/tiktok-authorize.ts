/**
 * Print the one-time TikTok Shop authorization link (valid 30 minutes).
 * Needs TIKTOK_SHOP_APP_KEY / TIKTOK_SHOP_APP_SECRET / TIKTOK_SHOP_SERVICE_ID, CRON_SECRET and
 * NEXT_PUBLIC_SITE_URL — the SAME CRON_SECRET as the deployed app, or the callback rejects the state.
 * Run: pnpm tiktok:authorize
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { tiktokConfig } from "@/lib/tiktok/config";
import { buildAuthorizeUrl, signState } from "@/lib/tiktok/oauth";

async function main() {
  const cfg = tiktokConfig(process.env);
  const secret = process.env.CRON_SECRET;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const missing = [
    !cfg && "TIKTOK_SHOP_APP_KEY / TIKTOK_SHOP_APP_SECRET / TIKTOK_SHOP_SERVICE_ID",
    !secret && "CRON_SECRET",
    !site && "NEXT_PUBLIC_SITE_URL",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(", ")}`);

  console.log("Redirect URI to register on TikTok Shop Partner Center:");
  console.log(`  ${site!.replace(/\/+$/, "")}/api/tiktok/oauth/callback\n`);
  console.log("Open this link (valid 30 minutes) and approve:");
  console.log(`  ${buildAuthorizeUrl(cfg!, signState(secret!, new Date()))}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
