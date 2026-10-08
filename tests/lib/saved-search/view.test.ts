import { describe, expect, it } from "vitest";
import { conditionLine, demandFollowRowView, savedSearchHref, savedSearchRowView } from "@/lib/saved-search/view";

describe("saved search views", () => {
  it("condition line and link without the price_asc sort", () => {
    expect(conditionLine({ q: "x", maxPrice: 1_500_000, onlyBuy: true })).toBe("Dưới 1.500.000đ · Nên mua");
    expect(savedSearchHref({ q: "ssd", maxPrice: 1000 })).toBe("/search?q=ssd&max=1000&intent=0");
  });
  it("row status lines", () => {
    const base = { id: "s", name: "N", params: { q: "ssd", onlyBuy: true as const }, status: "active" as const, createdAt: "c", lastAlertedAt: null, latestEventAt: null };
    expect(savedSearchRowView(base).statusLine).toBe("Chưa có sản phẩm mới");
    expect(savedSearchRowView({ ...base, latestEventAt: "2026-10-07T20:00:00Z" }).statusLine).toBe("Lần báo gần nhất 08/10/2026");
    const f = { id: "f", keyword: "g10", createdAt: "c", expiresAt: "2026-11-01T00:00:00Z", foundAt: null };
    expect(demandFollowRowView({ ...f, status: "waiting" }).line).toBe("Hết hạn 01/11/2026");
    expect(demandFollowRowView({ ...f, status: "found", foundAt: "2026-10-05T00:00:00Z" }).line).toBe("Đã có — đã báo 05/10/2026");
    expect(demandFollowRowView({ ...f, status: "expired" }).line).toBe("Đã hết hạn, chưa có sản phẩm");
  });
});
