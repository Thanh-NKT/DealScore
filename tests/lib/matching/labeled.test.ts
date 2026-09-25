import { describe, expect, it } from "vitest";
import { AUTO_MATCH_THRESHOLD, bestMatch, type MatchCandidate } from "@/lib/matching/match";

/**
 * Hand-labeled listings vs a small catalog. The G2 gate is "matching ≥ 95%": for auto-attach the
 * bar here is stricter — ZERO wrong auto matches on this set. Recall (how many right answers clear
 * the auto threshold) is reported and must not regress below the floor.
 */

function c(variantId: string, brand: string, model: string, variantKey: string, siblingCount: number, gtin?: string): MatchCandidate {
  return { variantId, productId: variantId.split(":")[0], brand, model, canonicalName: `${brand} ${model}`, variantKey, variantSpecs: {}, siblingCount, gtin };
}

const CATALOG: MatchCandidate[] = [
  c("990pro:1tb", "Samsung", "990 Pro", "dung-luong=1TB", 2),
  c("990pro:2tb", "Samsung", "990 Pro", "dung-luong=2TB", 2),
  c("980:1tb", "Samsung", "980", "dung-luong=1TB", 1),
  c("sn850x:1tb", "Western Digital", "SN850X", "dung-luong=1TB", 2, "0718037891234"),
  c("sn850x:2tb", "Western Digital", "SN850X", "dung-luong=2TB", 2),
  c("g304:black", "Logitech", "G304", "mau=Đen", 2),
  c("g304:white", "Logitech", "G304", "mau=Trắng", 2),
  c("xm5:std", "Sony", "WH-1000XM5", "Tiêu chuẩn", 1),
  c("xm4:std", "Sony", "WH-1000XM4", "Tiêu chuẩn", 1),
  c("u2723qe:std", "Dell", "U2723QE", "kich-thuoc=27 inch", 1),
  c("fury:16", "Kingston", "Fury Beast", "dung-luong=16GB", 2),
  c("fury:32", "Kingston", "Fury Beast", "dung-luong=32GB", 2),
];

const LABELED: Array<{ title: string; model: string; gtin?: string; expect: string | null }> = [
  { title: "Ổ cứng SSD Samsung 990 PRO NVMe PCIe 4.0", model: "2TB", expect: "990pro:2tb" },
  { title: "SSD Samsung 990 Pro chính hãng", model: "1TB", expect: "990pro:1tb" },
  { title: "Samsung 990PRO M.2 2280", model: "2TB", expect: "990pro:2tb" },
  { title: "SSD SAMSUNG 990 PRO 1TB bảo hành 5 năm", model: "Mặc định", expect: "990pro:1tb" },
  { title: "Ổ cứng Samsung 980 NVMe", model: "1TB", expect: "980:1tb" },
  { title: "WD Black SN850X NVMe", model: "1TB", expect: "sn850x:1tb" },
  { title: "Western Digital SN850X Gaming SSD", model: "2TB", expect: "sn850x:2tb" },
  { title: "SSD WD_BLACK SN850X", model: "2TB", expect: "sn850x:2tb" },
  { title: "Ổ cứng gắn trong chính hãng", model: "1TB", gtin: "718037891234", expect: "sn850x:1tb" },
  { title: "Chuột không dây Logitech G304 Lightspeed", model: "Đen", expect: "g304:black" },
  { title: "Logitech G304 Wireless", model: "Trắng", expect: "g304:white" },
  { title: "Chuột Logitech G304 màu trắng", model: "", expect: "g304:white" },
  { title: "Tai nghe Sony WH-1000XM5 chống ồn", model: "Tiêu chuẩn", expect: "xm5:std" },
  { title: "Sony WH1000XM4 Noise Cancelling", model: "", expect: "xm4:std" },
  { title: "Màn hình Dell UltraSharp U2723QE 27 inch 4K", model: "", expect: "u2723qe:std" },
  { title: "RAM Kingston Fury Beast DDR5", model: "16GB", expect: "fury:16" },
  { title: "Kingston FURY Beast 32GB 5600MHz", model: "", expect: "fury:32" },
  // Must NOT auto-match:
  { title: "SSD Samsung 990 Pro", model: "4TB", expect: null },
  { title: "Samsung 990 EVO Plus", model: "1TB", expect: null },
  { title: "WD Blue SN580 NVMe", model: "1TB", expect: null },
  { title: "Chuột Logitech G502 Hero", model: "Đen", expect: null },
  { title: "Chuột gaming Logitech", model: "Đen", expect: null },
  { title: "Tai nghe Sony WH-CH720N", model: "", expect: null },
  { title: "Màn hình Dell U2723QE", model: "32 inch", expect: null },
  { title: "Kingston Fury Beast DDR5", model: "64GB", expect: null },
  { title: "Ốp lưng cho Samsung Galaxy", model: "Đen", expect: null },
  { title: "Dây cáp Sony", model: "", expect: null },
  { title: "SSD 2TB NVMe giá rẻ", model: "2TB", expect: null },
  { title: "Bàn phím Logitech", model: "", expect: null },
  { title: "Ổ cứng gắn trong chính hãng", model: "4TB", gtin: "718037891234", expect: null },
];

const RECALL_FLOOR = 0.8;

describe("matching — labeled set", () => {
  const results = LABELED.map((l) => {
    const m = bestMatch({ title: l.title, modelName: l.model, gtin: l.gtin }, CATALOG);
    const auto = m != null && m.confidence >= AUTO_MATCH_THRESHOLD ? m.variantId : null;
    return { ...l, auto, m };
  });

  it("never auto-matches the wrong variant (precision 100%)", () => {
    const wrong = results.filter((r) => r.auto != null && r.auto !== r.expect);
    expect(wrong.map((r) => `${r.title} [${r.model}] → ${r.auto}`)).toEqual([]);
  });

  it(`auto-matches at least ${RECALL_FLOOR * 100}% of the matchable listings`, () => {
    const matchable = results.filter((r) => r.expect != null);
    const hit = matchable.filter((r) => r.auto === r.expect);
    const recall = hit.length / matchable.length;
    console.info(`matching recall: ${hit.length}/${matchable.length}`);
    const missed = matchable.filter((r) => r.auto !== r.expect).map((r) => `${r.title} [${r.model}] (${r.m?.confidence ?? 0})`);
    expect({ recall: recall >= RECALL_FLOOR, missed }).toMatchObject({ recall: true });
  });
});
