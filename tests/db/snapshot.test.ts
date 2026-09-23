import { describe, expect, it } from "vitest";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import { admin } from "./helpers";

describe("loadVariantSnapshots", () => {
  it("reads the full 90-day rollup for 25 variants (over the 1000-row cap without batching)", async () => {
    const { data } = await admin.from("variant_current_price").select("variant_id").not("price", "is", null).limit(25);
    const ids = (data ?? []).map((r) => r.variant_id);
    const now = new Date();
    const snaps = await loadVariantSnapshots(admin, ids, now);
    expect(snaps.size).toBe(ids.length);
    // Seed has 120 days of data → most variants meet the scoring threshold.
    const scored = [...snaps.values()].filter((s) => s.deal?.score != null);
    expect(scored.length).toBeGreaterThan(0);
  });

  it("variant missing from variant_current_price → stale, no price", async () => {
    const snaps = await loadVariantSnapshots(admin, ["00000000-0000-0000-0000-000000000001"], new Date());
    expect(snaps.get("00000000-0000-0000-0000-000000000001")).toMatchObject({
      price: null,
      inStock: false,
      isStale: true,
      deal: null,
    });
  });
});
