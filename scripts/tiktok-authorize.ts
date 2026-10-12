/**
 * Print the one-time TikTok Shop authorization link (valid 30 minutes, usable once).
 * Needs TIKTOK_SHOP_APP_KEY / TIKTOK_SHOP_APP_SECRET, ADMIN_API_SECRET,
 * NEXT_PUBLIC_SITE_URL and the Supabase service-role env — the SAME ADMIN_API_SECRET and database as the
 * deployed app, or the callback rejects the state.
 * Run: pnpm tiktok:authorize
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { tiktokConfig } from "@/lib/tiktok/config";
import { buildAuthorizeUrl, oauthStateKey, registerState, signState } from "@/lib/tiktok/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const cfg = tiktokConfig(process.env);
  const key = oauthStateKey(process.env);
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const missing = [
    !cfg && "TIKTOK_SHOP_APP_KEY / TIKTOK_SHOP_APP_SECRET",
    !key && "ADMIN_API_SECRET",
    !site && "NEXT_PUBLIC_SITE_URL",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(", ")}`);

  const state = signState(key!, new Date());
  await registerState(createAdminClient(), state);

  console.log("Redirect URI to register on TikTok Shop Partner Center:");
  console.log(`  ${site!.replace(/\/+$/, "")}/api/tiktok/oauth/callback\n`);
  console.log("Open this link (valid 30 minutes, works once) and approve:");
  console.log(`  ${buildAuthorizeUrl(cfg!, state)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
