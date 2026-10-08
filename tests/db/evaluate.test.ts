import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { createFixtureCatalog, type FixtureCatalog } from "./fixtures";

const created: TestUser[] = [];
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

// A fresh fixture variant per test (P4 review I4): never edits a pre-existing catalog row.
let cat: FixtureCatalog;
beforeAll(async () => {
  cat = await createFixtureCatalog("evaluate");
});
afterAll(async () => {
  await cat.cleanup();
});
async function freshVariant() {
  const p = await cat.product({ price: 1_000_000 });
  return { variantId: p.variantId, price: p.price };
}

describe("evaluateWatches", () => {
  it("target above current price → 1 event + 1 pending email delivery; second run reports nothing more", async () => {
    const u = await createTestUser();
    created.push(u);
    const v = await freshVariant();
    await u.client.from("watches").insert({ variant_id: v.variantId, target_price: v.price + 1000 });

    const r1 = await evaluateWatches({ now: new Date(), variantIds: [v.variantId] }, admin);
    expect(r1.alerts).toBeGreaterThanOrEqual(1);

    const { data: events } = await admin
      .from("alert_events")
      .select("id, trigger_types, alert_deliveries(channel, status), watches!inner(user_id)")
      .eq("watches.user_id", u.id);
    expect(events).toHaveLength(1);
    expect(events![0].trigger_types).toEqual(["target_price"]);
    // 1.6 defaults: email on, push off.
    expect(events![0].alert_deliveries).toEqual([{ channel: "email", status: "pending" }]);

    await evaluateWatches({ now: new Date(), variantIds: [v.variantId] }, admin);
    const { count } = await admin
      .from("alert_events")
      .select("id, watches!inner(user_id)", { count: "exact", head: true })
      .eq("watches.user_id", u.id);
    expect(count).toBe(1);
  });

  it("all channels off → nothing written, last_evaluated_at not moved", async () => {
    const u = await createTestUser();
    created.push(u);
    const v = await freshVariant();
    await admin.from("notification_settings").update({ email_enabled: false }).eq("user_id", u.id);
    const { data: w } = await u.client
      .from("watches")
      .insert({ variant_id: v.variantId, target_price: v.price + 1000 })
      .select("id")
      .single();
    await evaluateWatches({ now: new Date(), variantIds: [v.variantId] }, admin);
    const { data } = await admin.from("watches").select("last_evaluated_at").eq("id", w!.id).single();
    expect(data?.last_evaluated_at).toBeNull();
  });

  it("user pending deletion → skipped", async () => {
    const u = await createTestUser();
    created.push(u);
    const v = await freshVariant();
    await u.client.from("watches").insert({ variant_id: v.variantId, target_price: v.price + 1000 });
    await admin.from("users").update({ deleted_at: new Date().toISOString() }).eq("id", u.id);
    await evaluateWatches({ now: new Date(), variantIds: [v.variantId] }, admin);
    const { count } = await admin
      .from("alert_events")
      .select("id, watches!inner(user_id)", { count: "exact", head: true })
      .eq("watches.user_id", u.id);
    expect(count).toBe(0);
  });
});
