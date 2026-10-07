import { describe, expect, it } from "vitest";
import { changeLabel, countDropped7d } from "@/components/watch/change-label";

const ch = (amount: number, refPrice = 1_000_000) => ({ amount, pct: amount / refPrice, refPrice, days: 7 });
const since = (amount: number) => ({ amount, pct: amount / 1_200_000, since: "2026-09-01T00:00:00Z" });

describe("changeLabel", () => {
  it("7-day drop / rise / no change", () => {
    expect(changeLabel({ change7d: ch(-200_000), changeSinceStart: since(-50_000) })).toEqual({
      text: "↓ 200.000đ · 7 ngày", tone: "buy", sub: null, title: "So với 1.000.000đ cách đây 7 ngày",
    });
    expect(changeLabel({ change7d: ch(150_000), changeSinceStart: null })).toMatchObject({ text: "↑ 150.000đ · 7 ngày", tone: "avoid" });
    expect(changeLabel({ change7d: ch(0), changeSinceStart: null })).toMatchObject({ text: "Không đổi · 7 ngày", tone: "neutral", sub: null });
  });

  it("no 7-day number: 'Chưa đủ 7 ngày' plus the since-tracking line when it is non-zero", () => {
    expect(changeLabel({ change7d: null, changeSinceStart: since(-150_000) })).toEqual({
      text: "Chưa đủ 7 ngày", tone: "neutral", sub: "↓ 150.000đ từ lúc theo dõi", title: null,
    });
    expect(changeLabel({ change7d: null, changeSinceStart: since(90_000) }).sub).toBe("↑ 90.000đ từ lúc theo dõi");
    expect(changeLabel({ change7d: null, changeSinceStart: since(0) })).toMatchObject({ text: "Chưa đủ 7 ngày", sub: null });
  });

  it("nothing to compare", () => {
    expect(changeLabel({ change7d: null, changeSinceStart: null })).toEqual({
      text: "Chưa có giá để so", tone: "neutral", sub: null, title: null,
    });
  });
});

describe("countDropped7d", () => {
  const item = (status: "active" | "paused" | "done", amount: number | null) => ({
    status, view: { change7d: amount == null ? null : ch(amount) },
  });
  it("counts watches (not 'Đã mua') whose 7-day change is negative", () => {
    expect(countDropped7d([
      item("active", -1), item("paused", -5000), item("done", -9000), item("active", 0), item("active", 10), item("active", null),
    ])).toBe(2);
    expect(countDropped7d([])).toBe(0);
  });
});
