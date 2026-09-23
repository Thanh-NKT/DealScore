import { describe, expect, it } from "vitest";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import { admin } from "./helpers";

describe("loadVariantSnapshots", () => {
  it("đọc đủ rollup 90 ngày cho 25 variant (qua ngưỡng 1000 dòng nếu không chia lô)", async () => {
    const { data } = await admin.from("variant_current_price").select("variant_id").not("price", "is", null).limit(25);
    const ids = (data ?? []).map((r) => r.variant_id);
    const now = new Date();
    const snaps = await loadVariantSnapshots(admin, ids, now);
    expect(snaps.size).toBe(ids.length);
    // Seed có 120 ngày dữ liệu → phần lớn variant đủ ngưỡng chấm điểm.
    const scored = [...snaps.values()].filter((s) => s.deal?.score != null);
    expect(scored.length).toBeGreaterThan(0);
  });

  it("variant không có trong variant_current_price → stale, không giá", async () => {
    const snaps = await loadVariantSnapshots(admin, ["00000000-0000-0000-0000-000000000001"], new Date());
    expect(snaps.get("00000000-0000-0000-0000-000000000001")).toMatchObject({
      price: null,
      inStock: false,
      isStale: true,
      deal: null,
    });
  });
});
