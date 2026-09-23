import { describe, expect, it } from "vitest";
import { computeDealScore, detectFakeSale, type PriceObservation } from "@/lib/pricing/deal-score";

const NOW = new Date("2026-06-15T03:00:00Z"); // 10:00 giờ VN

/** Một quan sát mỗi ngày, lúc 12:00 giờ VN, từ `days - 1` ngày trước tới hôm nay. */
function daily(days: number, price: (i: number) => number, base = NOW): PriceObservation[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(base.getTime() - (days - 1 - i) * 86_400_000);
    return { observed_at: `${d.toISOString().slice(0, 10)}T05:00:00.000Z`, price: price(i) };
  });
}

describe("computeDealScore — percentile mid-rank", () => {
  it("giá đứng yên KHÔNG bị chấm 🔴 Chưa nên mua", () => {
    const r = computeDealScore({ price: 1000, history: daily(30, () => 1000), now: NOW });
    expect(r.stats.percentileRank).toBe(0.5);
    expect(r.recommendation).not.toBe("avoid");
    expect(r.reasons).toContain("✓ Đang ở mức đáy ghi nhận");
  });

  it("giá dưới mọi giá lịch sử có rank 0, trên mọi giá lịch sử có rank 1", () => {
    const hist = daily(30, (i) => 1000 + i * 10);
    expect(computeDealScore({ price: 900, history: hist, now: NOW }).stats.percentileRank).toBe(0);
    expect(computeDealScore({ price: 5000, history: hist, now: NOW }).stats.percentileRank).toBe(1);
  });

  it("giá bằng đúng một mức lịch sử chỉ tính một nửa phần bằng nhau", () => {
    // 1000, 1100, 1200, 1300 ×(mỗi mức nhiều ngày) — giá 1100 có 1/4 thấp hơn, 1/4 bằng.
    const hist = daily(40, (i) => 1000 + Math.floor(i / 10) * 100);
    const r = computeDealScore({ price: 1100, history: hist, now: NOW });
    expect(r.stats.percentileRank).toBeCloseTo(0.25 + 0.125);
  });
});

describe("computeDealScore — tham số now", () => {
  it("backtest được tại một thời điểm trong quá khứ", () => {
    const past = new Date("2025-01-10T03:00:00Z");
    const hist = daily(30, (i) => 1000 + i, past);
    expect(computeDealScore({ price: 990, history: hist, now: past }).score).not.toBeNull();
    // Cùng dữ liệu, tính "hôm nay" thì đã rơi ngoài cửa sổ 90 ngày.
    expect(computeDealScore({ price: 990, history: hist, now: NOW }).recommendation).toBe(
      "insufficient_data",
    );
  });

  it("bỏ quan sát nằm sau thời điểm now", () => {
    const hist = daily(30, () => 1000);
    const earlier = new Date(NOW.getTime() - 5 * 86_400_000);
    expect(computeDealScore({ price: 1000, history: hist, now: earlier }).stats.observations).toBe(
      25,
    );
  });
});

describe("detectFakeSale", () => {
  it("giảm ≥20% so với giá niêm yết mà giá vẫn quanh trung vị → cảnh báo", () => {
    expect(detectFakeSale({ currentPrice: 1000, listedPrice: 1400, median30d: 1000 })).not.toBeNull();
  });

  it("giảm thật (giá dưới trung vị rõ rệt) → không cảnh báo", () => {
    expect(detectFakeSale({ currentPrice: 800, listedPrice: 1400, median30d: 1000 })).toBeNull();
  });

  it("trung vị 14 ngày cao hơn 60 ngày trước đó >15% → cảnh báo tăng giá trước sale", () => {
    expect(
      detectFakeSale({
        currentPrice: 1000,
        listedPrice: 0,
        median30d: 1000,
        median14dBeforeSale: 1200,
        median60dBefore: 1000,
      }),
    ).toBe("Giá tăng gần đây trước đợt giảm.");
  });
});
