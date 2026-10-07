import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VariantPicker } from "@/components/product/variant-picker";
import type { VariantVerdict } from "@/lib/pricing/variant-verdict";

const v = (id: string, verdict: VariantVerdict, o: Partial<{ price: number | null; inStock: boolean; variantKey: string }> = {}) => ({
  id, variantKey: o.variantKey ?? `Màu ${id}`, price: o.price === undefined ? 1_000_000 : o.price, inStock: o.inStock ?? true, verdict,
});
const render = (variants: ReturnType<typeof v>[], selectedId = "a") =>
  renderToStaticMarkup(createElement(VariantPicker, { variants, selectedId, range: 30 }));

describe("VariantPicker verdict labels", () => {
  it("shows verdict words and score, with the score in title / aria-label", () => {
    const html = render([
      v("a", { kind: "score", score: 82, recommendation: "buy", live: true }),
      v("b", { kind: "score", score: 41, recommendation: "avoid", live: false }),
    ]);
    expect(html).toContain("Nên mua · <span class=\"num\">82</span>");
    expect(html).toContain("Chưa nên mua · <span class=\"num\">41</span>");
    expect(html).toContain('title="Màu a (1.000.000đ) · Deal Score 82/100 — Nên mua"');
    expect(html).toContain('aria-label="Màu a (1.000.000đ) · Deal Score 82/100 — Nên mua"');
    expect(html).toContain("bg-buy");
    expect(html).toContain("bg-avoid");
  });

  it("insufficient → 'Chưa đủ dữ liệu' with an outlined dot; none → no label", () => {
    const html = render([
      v("a", { kind: "insufficient", live: true }),
      v("b", { kind: "none" }, { inStock: false }),
    ]);
    expect(html).toContain("Chưa đủ dữ liệu");
    expect(html).toContain('title="Màu a (1.000.000đ) · Chưa đủ dữ liệu để chấm điểm"');
    expect(html).toContain("border-ink-3");
    expect(html).toContain('title="Màu b (Hết hàng)"');
    expect((html.match(/Deal Score/g) ?? []).length).toBe(0);
  });

  it("the selected chip keeps the verdict dot colour and uses night ink for the words", () => {
    const html = render([
      v("a", { kind: "score", score: 70, recommendation: "wait", live: true }),
      v("b", { kind: "none" }),
    ]);
    const selected = html.slice(html.indexOf('aria-current="true"'));
    expect(selected.slice(0, 2000)).toContain("bg-wait");
    expect(selected.slice(0, 2000)).toContain("text-night-ink-2");
  });
});
