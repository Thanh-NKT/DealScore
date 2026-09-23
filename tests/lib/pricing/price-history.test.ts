import { describe, expect, it } from "vitest";
import { computeDealScore } from "@/lib/pricing/deal-score";
import { toVnDate } from "@/lib/format";
import {
  expandRollup,
  historyStats,
  medianWindow,
  type DailyPriceRow,
} from "@/lib/pricing/price-history";

/** Đồng hồ cố định, truyền vào computeDealScore qua `now`. 10:00 giờ VN. */
const NOW = new Date("2026-06-15T03:00:00Z");

function dayString(daysAgo: number, base: Date = NOW): string {
  return toVnDate(new Date(base.getTime() - daysAgo * 86_400_000));
}

function row(daysAgo: number, price: number | null, base?: Date): DailyPriceRow {
  return {
    day: dayString(daysAgo, base),
    min_price: price,
    median_price: price,
    max_price: price,
    obs_count: price == null ? 0 : 1,
    offer_count: price == null ? 0 : 1,
    has_flash_sale: false,
    flash_min_price: null,
  };
}

describe("expandRollup", () => {
  it("sinh đúng một quan sát cho mỗi ngày có dữ liệu", () => {
    const obs = expandRollup([row(2, 1000), row(1, 1000), row(0, 1000)]);
    expect(obs).toHaveLength(3);
  });

  it("bỏ qua ngày không có min_price", () => {
    const obs = expandRollup([row(2, 1000), row(1, null), row(0, 1000)]);
    expect(obs).toHaveLength(2);
  });

  it("đặt observed_at tại 12:00 giờ Việt Nam = 05:00Z", () => {
    const obs = expandRollup([
      {
        day: "2026-03-10",
        min_price: 1000,
        median_price: 1000,
        max_price: 1000,
        obs_count: 1,
        offer_count: 1,
        has_flash_sale: false,
        flash_min_price: null,
      },
    ]);
    expect(obs[0].observed_at).toBe("2026-03-10T05:00:00.000Z");
  });

  it("đánh dấu quan sát là hợp lệ và không phải flash sale", () => {
    const obs = expandRollup([row(0, 1000)]);
    expect(obs[0].is_valid).toBe(true);
    expect(obs[0].is_flash_sale).toBe(false);
  });
});

describe("ngưỡng dữ liệu của deal-score khi đi qua rollup", () => {
  it("13 ngày đầy đủ vẫn là chưa đủ dữ liệu (ngưỡng 14 ngày)", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row(12 - i, 1000));
    const r = computeDealScore({ price: 1000, history: expandRollup(rows), now: NOW });
    expect(r.recommendation).toBe("insufficient_data");
    expect(r.score).toBeNull();
  });

  it("trải 14 ngày nhưng chỉ 9 ngày có dữ liệu là chưa đủ (ngưỡng 10 quan sát)", () => {
    const rows = [row(14, 1000), ...Array.from({ length: 8 }, (_, i) => row(8 - i, 1000 + i))];
    expect(rows.filter((x) => x.min_price != null)).toHaveLength(9);
    const r = computeDealScore({ price: 1000, history: expandRollup(rows), now: NOW });
    expect(r.recommendation).toBe("insufficient_data");
  });

  it("trải 14 ngày và 10 ngày có dữ liệu thì chấm được điểm", () => {
    const rows = [row(14, 1000), ...Array.from({ length: 9 }, (_, i) => row(8 - i, 1000 + i))];
    expect(rows.filter((x) => x.min_price != null)).toHaveLength(10);
    const r = computeDealScore({ price: 900, history: expandRollup(rows), now: NOW });
    expect(r.recommendation).not.toBe("insufficient_data");
    expect(r.stats.daysCovered).toBe(14);
  });

  it("kết quả không đổi theo giờ trong ngày (đếm theo ngày lịch VN)", () => {
    const rows = [row(14, 1000), ...Array.from({ length: 9 }, (_, i) => row(8 - i, 1000 + i))];
    const at = (iso: string) =>
      computeDealScore({ price: 900, history: expandRollup(rows), now: new Date(iso) });
    // 00:30 và 23:30 giờ VN của cùng ngày NOW.
    const early = at("2026-06-14T17:30:00Z");
    const late = at("2026-06-15T16:30:00Z");
    expect(early).toEqual(late);
    expect(early.recommendation).not.toBe("insufficient_data");
  });
});

describe("medianWindow", () => {
  const FIXED = new Date("2026-03-20T10:00:00Z");

  it("trả rỗng khi cửa sổ không có dữ liệu", () => {
    expect(medianWindow([], 30, 0, FIXED)).toEqual({ value: null, dayCount: 0 });
  });

  it("chỉ đếm ngày thực sự có min_price", () => {
    const rows = [
      row(5, null, FIXED),
      row(4, null, FIXED),
      row(3, 2000, FIXED),
      row(2, 2000, FIXED),
      row(1, 2000, FIXED),
    ];
    const w = medianWindow(rows, 30, 0, FIXED);
    expect(w.dayCount).toBe(3);
    expect(w.value).toBe(2000);
  });

  it("cửa sổ [-74,-14) không giao với [-14,0)", () => {
    const recent = Array.from({ length: 13 }, (_, i) => row(13 - i, 1000, FIXED));
    const older = Array.from({ length: 50 }, (_, i) => row(70 - i, 2000, FIXED));
    const rows = [...older, ...recent];
    expect(medianWindow(rows, 14, 0, FIXED).value).toBe(1000);
    expect(medianWindow(rows, 74, 14, FIXED).value).toBe(2000);
  });

  it("KHÔNG phụ thuộc giờ trong ngày — cùng dữ liệu, cùng ngày lịch, cùng kết quả", () => {
    // Cửa sổ phải được định nghĩa theo NGÀY LỊCH. Nếu tính bằng hiệu số
    // mili-giây so với mốc 05:00Z của mỗi dòng, thì hôm nay lúc lọt vào lúc
    // không, tùy giờ chạy — cùng một trang sẽ cho hai con số khác nhau.
    const morning = new Date("2026-03-20T02:00:00Z");
    const evening = new Date("2026-03-20T16:00:00Z");
    const rows = Array.from({ length: 20 }, (_, i) => row(19 - i, 1000, morning));

    const a = medianWindow(rows, 30, 0, morning);
    const b = medianWindow(rows, 30, 0, evening);
    expect(b.dayCount).toBe(a.dayCount);
  });
});

describe("historyStats", () => {
  it("đáy / trung vị / đỉnh trong 90 ngày, bỏ ngày ngoài cửa sổ và ngày trống", () => {
    const rows = [row(91, 100), row(90, 3000), row(10, null), row(5, 1000), row(0, 2000)];
    expect(historyStats(rows, NOW)).toEqual({ low: 1000, median: 2000, high: 3000, dayCount: 3 });
  });

  it("không có dữ liệu thì trả null", () => {
    expect(historyStats([], NOW)).toEqual({ low: null, median: null, high: null, dayCount: 0 });
  });
});
