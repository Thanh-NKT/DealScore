import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { createFixtureCatalog, type FixtureCatalog } from "./fixtures";

// Final review Minor 4 (0074): alert_click_rate_daily measures alert → /go click-through. Discovery alerts link to
// product pages, never /go, so they must not dilute it. DB tests run serially, so a global before/after is stable.
let cat: FixtureCatalog;
let u: TestUser;
beforeAll(async () => {
  cat = await createFixtureCatalog("almet");
  u = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(u.id);
  await cat.cleanup();
});

const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10); // Asia/Ho_Chi_Minh
async function sentToday() {
  const { data, error } = await admin.from("alert_click_rate_daily").select("alerts_sent").eq("day", today());
  if (error) throw error;
  return Number(data?.[0]?.alerts_sent ?? 0);
}
async function sentEvent(source: Record<string, unknown>) {
  const { data: e, error } = await admin
    .from("alert_events")
    .insert({ user_id: u.id, items: [], items_total: 1, ...source } as never)
    .select("id")
    .single();
  if (error) throw error;
  const { error: dErr } = await admin.from("alert_deliveries").insert({
    alert_event_id: e.id, channel: "email", status: "sent", next_attempt_at: new Date().toISOString(), sent_at: new Date().toISOString(),
  });
  if (dErr) throw dErr;
}

describe("alert_click_rate_daily", () => {
  it("counts sent watch alerts only", async () => {
    const p = await cat.product({ price: 1_000_000 });
    const { data: w } = await admin.from("watches").insert({ user_id: u.id, variant_id: p.variantId, target_price: 1 }).select("id").single();
    const { data: s, error: sErr } = await u.client
      .from("saved_searches")
      .insert({ name: "m", params: { categorySlug: cat.categorySlug, maxPrice: 5_000_000 } as never })
      .select("id")
      .single();
    expect(sErr).toBeNull();

    const before = await sentToday();
    await sentEvent({ saved_search_id: s!.id, trigger_types: ["saved_search"] });
    expect(await sentToday()).toBe(before);
    await sentEvent({ watch_id: w!.id, trigger_types: ["target_price"] });
    expect(await sentToday()).toBe(before + 1);
  });
});
