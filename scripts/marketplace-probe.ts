/**
 * Check real marketplace keys before relying on them. Prints the RAW API response (secrets redacted)
 * and the normalized MarketplaceItem, plus fields the normalizer could not fill. Writes NOTHING to the
 * catalog (TikTok may refresh its OAuth token).
 * Run: pnpm marketplace:probe shopee https://shopee.vn/product/123/456
 *      pnpm marketplace:probe tiktok "tai nghe bluetooth"
 *
 * Wrapped in main(): tsx compiles .ts files to CJS, which forbids top-level await.
 */
import { getSource } from "@/lib/marketplaces/sources";
import { expectedFieldWarnings, missingEnv, probeTarget, redact } from "@/lib/marketplaces/probe";

async function main() {
  const [marketplace, ...rest] = process.argv.slice(2);
  const arg = rest.join(" ").trim();
  if ((marketplace !== "shopee" && marketplace !== "tiktok") || !arg) {
    throw new Error('Usage: pnpm marketplace:probe <shopee|tiktok> <url|id|"keyword">');
  }
  const missing = missingEnv(marketplace, process.env);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(", ")}`);
  const secrets = [process.env.SHOPEE_AFFILIATE_SECRET, process.env.TIKTOK_SHOP_APP_SECRET].filter((s): s is string => !!s);

  // Log raw bodies: wrap fetch for this process only.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    const text = await res.clone().text();
    const url = String(input).split("?")[0];
    if (!url.includes("/token/")) console.log(`\n--- RAW ${res.status} ${url}\n${redact(text, secrets).slice(0, 8000)}`);
    return res;
  };

  const source = getSource(marketplace)!;
  const target = probeTarget(marketplace, arg);
  const items =
    target.kind === "item"
      ? [await source.fetchItem(target.externalItemId)]
      : (await source.searchItems({ kind: "keyword", value: target.value, cursor: null, limit: 5 })).items;

  console.log(`\n--- NORMALIZED (${items.length})`);
  for (const item of items) {
    console.log(JSON.stringify(item, null, 2));
    const w = expectedFieldWarnings(item);
    if (w.length > 0) console.log(`!! empty after normalize: ${w.join(", ")} — check the RAW response above`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
