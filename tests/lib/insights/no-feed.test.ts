import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Roadmap P4 insights — unit prices (G), seller price profiles (H), voucher patterns (K) and the price-season
 * calendar (A) — are facts shown next to the price. They NEVER feed Deal Score, search ranking or alerts
 * (watch, saved search, demand follow). Don't "fix" this test to make it green: move the read instead.
 */
const GUARDED = [
  "src/lib/pricing/deal-score.ts",
  "src/lib/pricing/deal-score-v1.ts",
  "src/lib/pricing/score.ts",
  "src/lib/pricing/recompute-scores.ts",
  "src/lib/pricing/variant-pricing.ts",
  "src/lib/pricing/best-buy.ts",
  "src/lib/pricing/variant-verdict.ts",
  "src/lib/watch",
  "src/lib/alerts",
  "src/lib/saved-search",
  "src/lib/demand-follow",
];
const FORBIDDEN_IMPORT = /from\s+["']@\/lib\/(pricing\/unit-price|sellers\/|seasons\/|vouchers\/patterns)/;
const FORBIDDEN_TABLES = /seller_price_profiles|category_season_stats|voucher_sightings|voucher_seller_checks|seller_voucher_history/;

/** SQL that ranks, scores or alerts: the LATEST body must not read the insight tables. */
const RANKING_FUNCTIONS = [
  "search_products",
  "price_drop_radar",
  "trending_products",
  "refresh_variant_current_price",
  "record_watch_evaluation",
  "record_saved_search_evaluation",
  "record_demand_follow_check",
  "claim_due_deliveries",
];
const MIGRATIONS = "supabase/migrations";

function files(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((f) => files(join(path, f))) : [path];
}

function latestDefinition(name: string): string | null {
  let found: string | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const re = new RegExp(String.raw`create (?:or replace )?function public\.${name}\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const start = sql.indexOf("$$", m.index);
      const end = sql.indexOf("$$", start + 2);
      found = sql.slice(m.index, end);
    }
  }
  return found;
}

describe("P4 insights never feed Deal Score / search / alerts", () => {
  const guarded = GUARDED.flatMap(files).filter((f) => /\.(ts|tsx)$/.test(f));
  it("guards something", () => {
    expect(guarded.length).toBeGreaterThan(10);
  });
  it.each(guarded)("%s imports no unit price / seller / season / voucher-pattern module and reads no insight table", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(FORBIDDEN_IMPORT);
    expect(src).not.toMatch(FORBIDDEN_TABLES);
  });
  it.each(RANKING_FUNCTIONS)("latest %s body reads no insight table", (name) => {
    const body = latestDefinition(name);
    expect(body, `no definition of ${name}`).not.toBeNull();
    expect(body!).not.toMatch(FORBIDDEN_TABLES);
  });
  it("search.ts uses unit prices for display only: never passed to search_products", () => {
    const src = readFileSync("src/lib/search.ts", "utf8");
    const rpc = src.slice(src.indexOf('rpc("search_products"'), src.indexOf("});", src.indexOf('rpc("search_products"')));
    expect(rpc).not.toMatch(/unit/i);
  });
});
