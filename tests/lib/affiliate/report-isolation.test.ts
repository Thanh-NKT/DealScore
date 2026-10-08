import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Roadmap P3 (0052): the admin affiliate report is for the Admin app only. No DealScore module may call it,
 * and the P3 price / catalog functions must not read affiliate data (Deal Score, search and alerts never
 * see commission). Companion to no-bias.test.ts — don't "fix" this test to make it green.
 */
const MIGRATIONS = "supabase/migrations";
const FORBIDDEN = /affiliate_offers|conversions|commission/i;
const P3_PRICE_FUNCTIONS = [
  "refresh_variant_current_price",
  "admin_rebuild_variant_rollup",
  "detect_price_anomalies",
  "admin_review_price_anomalies",
  "admin_merge_products",
  "offer_latest_trusted_observation",
];

function files(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((f) => files(join(path, f))) : [path];
}

/** Body of the last `create [or replace] function public.<name>(` across the migrations, up to its closing $$. */
function latestDefinition(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const re = new RegExp(String.raw`create (?:or replace )?function public\.${name}\(`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const start = sql.indexOf("$$", m.index);
      const end = sql.indexOf("$$", start + 2);
      found = { file: f, body: sql.slice(m.index, end) };
    }
  }
  return found;
}

describe("admin affiliate report isolation", () => {
  // database.types.ts is generated from the schema: it declares the functions, it does not call them.
  const sources = files("src").filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.replace(/\\/g, "/").endsWith("lib/database.types.ts"),
  );

  it("scans the DealScore sources", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it("no file in src/ calls admin_affiliate_*", () => {
    expect(sources.filter((f) => /admin_affiliate_/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("the anomaly pipeline and the attribute comparison do not read affiliate data", () => {
    for (const f of [...files("src/lib/anomalies"), "src/lib/matching/compare.ts"].filter((f) => f.endsWith(".ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(FORBIDDEN);
    }
  });

  for (const name of P3_PRICE_FUNCTIONS) {
    it(`latest ${name} does not read affiliate data`, () => {
      const def = latestDefinition(name);
      expect(def, name).not.toBeNull();
      expect(def!.body).not.toMatch(FORBIDDEN);
    });
  }
});
