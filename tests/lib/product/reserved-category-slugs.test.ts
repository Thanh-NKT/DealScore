import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_FIRST_SEGMENTS } from "@/lib/product/slug-redirect-proxy";

// Final review Minor 7: a category whose slug is a top-level route is unreachable (/{category} renders the
// route) and skipped by the slug-redirect proxy. The LATEST categories_slug_reserved constraint must reserve every
// static top-level dir of src/app and every first segment the proxy treats as "never a category".
const MIGRATIONS = "supabase/migrations";

function latestReservedSlugs(): { file: string; slugs: Set<string> } {
  let found: { file: string; slugs: Set<string> } | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const re = /constraint categories_slug_reserved check\s*\(\s*slug not in\s*\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      found = { file: f, slugs: new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])) };
    }
  }
  if (!found) throw new Error("categories_slug_reserved not found");
  return found;
}

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/; // categories_slug_format (0002): anything else can never collide.

describe("categories_slug_reserved", () => {
  const { file, slugs } = latestReservedSlugs();

  it("reserves every static top-level route of src/app", () => {
    const dirs = readdirSync(join(process.cwd(), "src/app"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("(") && !d.name.startsWith("_"))
      .map((d) => d.name);
    expect(dirs.length).toBeGreaterThan(5);
    for (const d of dirs) expect(slugs.has(d), `${d} (latest constraint: ${file})`).toBe(true);
  });

  it("reserves every first segment the slug-redirect proxy skips", () => {
    for (const s of RESERVED_FIRST_SEGMENTS) {
      if (!SLUG_FORMAT.test(s)) continue;
      expect(slugs.has(s), `${s} (latest constraint: ${file})`).toBe(true);
    }
  });
});
