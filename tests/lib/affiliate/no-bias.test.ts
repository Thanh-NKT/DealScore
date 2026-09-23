import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ranking and recommendations are based on price only. These modules must not read anything
 * related to commission — don't "fix" this test to make it green.
 */
const GUARDED = [
  "src/lib/pricing/deal-score.ts",
  "src/lib/pricing/variant-pricing.ts",
  "src/lib/search.ts",
  "src/lib/alerts",
  "src/lib/watch",
];
const FORBIDDEN = /affiliate_offers|conversions|commission/i;

function files(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((f) => files(join(path, f))) : [path];
}

describe("no commission bias", () => {
  for (const f of GUARDED.flatMap(files).filter((f) => f.endsWith(".ts"))) {
    it(`${f} does not read affiliate data`, () => {
      expect(readFileSync(f, "utf8")).not.toMatch(FORBIDDEN);
    });
  }
});
