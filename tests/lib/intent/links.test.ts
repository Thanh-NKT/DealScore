import { describe, expect, it } from "vitest";
import { searchLinkParams } from "@/lib/intent/links";
import { capacityLabel } from "@/lib/intent/parse";
import { applyIntent } from "@/lib/intent/merge";
import { parseQueryIntent } from "@/lib/intent/parse";
import { parseSearchParams, toSearchParams, type SearchParams } from "@/lib/search";

const vocab = { categories: [{ slug: "ssd", name: "Ổ cứng SSD" }], brands: ["Samsung"] };

function setup(qs: string) {
  const raw = parseSearchParams(new URLSearchParams(qs));
  const { params: intentParams, applied } = applyIntent(raw, parseQueryIntent(raw.q!, vocab));
  return { raw, intentParams, applied };
}

describe("searchLinkParams", () => {
  it("without applied intent, both link kinds use the searched params unchanged", () => {
    const raw: SearchParams = parseSearchParams(new URLSearchParams("q=tai nghe&page=2"));
    const links = searchLinkParams({ raw, intentParams: raw, applied: [], fallback: false });
    expect(links.pagination).toEqual(raw);
    expect(links.nav).toEqual(raw);
  });

  it("with applied intent, pagination re-parses from the raw URL (intent on) and keeps chips and boost", () => {
    const { raw, intentParams, applied } = setup("q=ssd 2tb màu đen dưới 3 triệu");
    expect(applied.length).toBeGreaterThan(0);
    const { pagination } = searchLinkParams({ raw, intentParams, applied, fallback: false });

    const page2 = toSearchParams({ ...pagination, page: 2 });
    expect(page2.get("q")).toBe("ssd 2tb màu đen dưới 3 triệu");
    expect(page2.has("intent")).toBe(false);
    expect(page2.has("cap")).toBe(false);

    // Page 2 re-parses to exactly the same applied params (chips, colour boost) as page 1.
    const again = setup(page2.toString());
    expect(again.applied).toEqual(applied);
    expect({ ...again.intentParams, page: 1 }).toEqual({ ...intentParams, page: 1 });
  });

  it("with applied intent, sort/filter links use the applied params with intent=0", () => {
    const { raw, intentParams, applied } = setup("q=ssd 2tb dưới 3 triệu");
    const { nav } = searchLinkParams({ raw, intentParams, applied, fallback: false });
    expect(nav).toEqual({ ...intentParams, intent: false });
    const qs = toSearchParams(nav);
    expect(qs.get("cat")).toBe("ssd");
    expect(qs.get("cap")).toBe("2048");
    expect(qs.get("max")).toBe("3000000");
    expect(qs.get("intent")).toBe("0");
  });

  it("in fallback, every link keeps the plain text search (raw + intent=0)", () => {
    const { raw, intentParams, applied } = setup("q=ssd 2tb dưới 100k");
    const links = searchLinkParams({ raw, intentParams, applied, fallback: true });
    expect(links.pagination).toEqual({ ...raw, intent: false });
    expect(links.nav).toEqual({ ...raw, intent: false });
  });
});

describe("capacityLabel", () => {
  it("uses TB for whole terabytes and GB otherwise", () => {
    expect(capacityLabel(2048)).toBe("2TB");
    expect(capacityLabel(512)).toBe("512GB");
    expect(capacityLabel(1536)).toBe("1536GB");
  });
});
