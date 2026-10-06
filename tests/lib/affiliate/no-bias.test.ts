import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ranking and recommendations are based on price only. These modules must not read anything
 * related to commission — don't "fix" this test to make it green.
 */
const GUARDED = [
  // The whole engine: v0, v1 (production), scoreDeal, the score cache, best buy, marketplace compare…
  "src/lib/pricing",
  "src/lib/search.ts",
  "src/lib/discovery",
  "src/lib/alerts",
  "src/lib/watch",
];

/** SQL functions that rank or pick products; their LATEST definition must not read affiliate data either. */
const RANKING_FUNCTIONS = ["search_products", "price_drop_radar", "trending_products", "refresh_variant_current_price"];
const MIGRATIONS = "supabase/migrations";
const FORBIDDEN = /affiliate_offers|conversions|commission/i;

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

describe("no commission bias in the ranking SQL", () => {
  for (const name of RANKING_FUNCTIONS) {
    it(`latest ${name} does not read affiliate data`, () => {
      const def = latestDefinition(name);
      expect(def, name).not.toBeNull();
      expect(def!.body).not.toMatch(FORBIDDEN);
    });
  }
});

describe("no commission bias", () => {
  for (const f of GUARDED.flatMap(files).filter((f) => f.endsWith(".ts"))) {
    it(`${f} does not read affiliate data`, () => {
      expect(readFileSync(f, "utf8")).not.toMatch(FORBIDDEN);
    });
  }
});
