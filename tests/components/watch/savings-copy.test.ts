import { describe, expect, it } from "vitest";
import { formatVnd } from "@/lib/format";
import { purchaseNotice, savingsCopy, type Purchase } from "@/components/watch/savings-copy";

const p = (o: Partial<Purchase> = {}): Purchase => ({
  status: "saved",
  vsMedian: 100_000,
  vsBaseline: 200_000,
  purchasedAt: "2026-09-10T03:00:00Z",
  purchasedPrice: 900_000,
  ...o,
});

describe("savingsCopy", () => {
  it("saved → buy tone with the amount; sub-line with price, date and the baseline change", () => {
    const c = savingsCopy(p());
    expect(c).toMatchObject({ text: `Thấp hơn trung vị 30 ngày ${formatVnd(100_000)}`, tone: "buy" });
    expect(c.sub).toBe(`Mua lúc ${formatVnd(900_000)} · 10/9/2026 · so với lúc bắt đầu theo dõi: −${formatVnd(200_000)}`);
  });
  it("above → neutral, positive amount", () => {
    expect(savingsCopy(p({ status: "above", vsMedian: -50_000, vsBaseline: -10_000 }))).toMatchObject({
      text: `Cao hơn trung vị 30 ngày ${formatVnd(50_000)}`,
      tone: "ink-2",
    });
    expect(savingsCopy(p({ status: "above", vsMedian: -50_000, vsBaseline: -10_000 })).sub).toContain(`+${formatVnd(10_000)}`);
  });
  it("flat / unknown; no price → no invented price", () => {
    expect(savingsCopy(p({ status: "flat", vsMedian: 200 })).text).toBe("Ngang trung vị 30 ngày");
    const u = savingsCopy(p({ status: "unknown", vsMedian: null, vsBaseline: null, purchasedPrice: null }));
    expect(u).toEqual({ text: "Chưa đủ lịch sử giá để so", tone: "ink-3", sub: "Mua ngày 10/9/2026" });
  });
});

describe("purchaseNotice", () => {
  it("adds the saving only for a saved purchase", () => {
    expect(purchaseNotice("Tai nghe", p())).toBe(`Đã chuyển “Tai nghe” vào Đã mua. Bạn mua thấp hơn trung vị 30 ngày ${formatVnd(100_000)}.`);
    expect(purchaseNotice("Tai nghe", p({ status: "unknown", vsMedian: null }))).toBe("Đã chuyển “Tai nghe” vào Đã mua.");
  });
});
