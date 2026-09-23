import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Xếp hạng và khuyến nghị chỉ dựa trên giá. Các module này không được đọc bất
 * kỳ thứ gì liên quan tới hoa hồng — đừng "sửa" test này để nó xanh.
 */
const GUARDED = [
  "src/lib/deal-score.ts",
  "src/lib/variant-pricing.ts",
  "src/lib/search.ts",
  "src/lib/alerts",
  "src/lib/watch",
];
const FORBIDDEN = /affiliate_offers|conversions|commission/i;

function files(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((f) => files(join(path, f))) : [path];
}

describe("chống thiên vị theo hoa hồng", () => {
  for (const f of GUARDED.flatMap(files).filter((f) => f.endsWith(".ts"))) {
    it(`${f} không đọc dữ liệu affiliate`, () => {
      expect(readFileSync(f, "utf8")).not.toMatch(FORBIDDEN);
    });
  }
});
