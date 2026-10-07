import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { seedVariantWithHistory, type SeededVariant } from "./seed-history";

// Migration 0041: opt-in price-hike alert with its own state.
const created: TestUser[] = [];
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

let hiked: SeededVariant;
beforeAll(async () => {
  // 60 days at 1,000,000 then the last 14 days at 1,200,000; current price still 1,200,000.
  hiked = await seedVariantWithHistory({ price: 1_200_000, days: 74, daily: (d) => (d <= 14 ? 1_200_000 : 1_000_000) });
});
afterAll(async () => {
  await hiked.cleanup();
});

describe("watches.notify_price_hike (0041)", () => {
  it("is a condition on its own; toggling it bumps config_version and forgets hike_active", async () => {
    const u = await user();
    const { data: w, error } = await u.client
      .from("watches")
      .insert({ variant_id: hiked.variantId, notify_price_hike: true })
      .select("id, config_version")
      .single();
    expect(error).toBeNull();
    await admin.from("watches").update({ hike_active: true }).eq("id", w!.id);
    const { error: upErr } = await u.client.from("watches").update({ notify_price_hike: false, notify_low: true }).eq("id", w!.id);
    expect(upErr).toBeNull();
    const { data: after } = await admin.from("watches").select("config_version, hike_active").eq("id", w!.id).single();
    expect(after).toEqual({ config_version: w!.config_version + 1, hike_active: null });
  });

  it("the user cannot write hike_active / last_hike_alerted_at", async () => {
    const u = await user();
    const { data: w } = await u.client.from("watches").insert({ variant_id: hiked.variantId, notify_low: true }).select("id").single();
    const up1 = await u.client.from("watches").update({ hike_active: true }).eq("id", w!.id);
    expect(up1.error?.code).toBe("42501");
    const up2 = await u.client.from("watches").update({ last_hike_alerted_at: new Date().toISOString() }).eq("id", w!.id);
    expect(up2.error?.code).toBe("42501");
  });

  it("alert_events accepts price_hike and still rejects unknown trigger types", async () => {
    const u = await user();
    const { data: w } = await u.client.from("watches").insert({ variant_id: hiked.variantId, notify_price_hike: true }).select("id").single();
    const ok = await admin.from("alert_events").insert({ watch_id: w!.id, trigger_types: ["price_hike"] });
    expect(ok.error).toBeNull();
    const bad = await admin.from("alert_events").insert({ watch_id: w!.id, trigger_types: ["price_jump"] });
    expect(bad.error?.code).toBe("23514");
  });

  it("record_watch_evaluation writes the two hike keys and leaves last_alerted_at alone", async () => {
    const u = await user();
    const { data: w } = await u.client
      .from("watches")
      .insert({ variant_id: hiked.variantId, notify_price_hike: true })
      .select("id, config_version")
      .single();
    const at = new Date().toISOString();
    const { error } = await admin.rpc("record_watch_evaluation", {
      p_watch_id: w!.id,
      p_config_version: w!.config_version,
      p_now: at,
      p_state: { cond_state: {}, hike_active: true, hike_alerted_at: at },
      p_event: null as never,
    });
    expect(error).toBeNull();
    const { data } = await admin.from("watches").select("hike_active, last_hike_alerted_at, last_alerted_at").eq("id", w!.id).single();
    expect(data!.hike_active).toBe(true);
    expect(new Date(data!.last_hike_alerted_at!).toISOString()).toBe(at);
    expect(data!.last_alerted_at).toBeNull();
  });
});

describe("evaluateWatches — price hike end to end", () => {
  it("one price_hike event with the prior median; a second run sends nothing; last_alerted_at untouched", async () => {
    const u = await user();
    const { data: w } = await u.client.from("watches").insert({ variant_id: hiked.variantId, notify_price_hike: true }).select("id").single();
    await evaluateWatches({ now: new Date(), variantIds: [hiked.variantId] }, admin);
    await evaluateWatches({ now: new Date(), variantIds: [hiked.variantId] }, admin);
    const { data: events } = await admin.from("alert_events").select("trigger_types, reference_price, price").eq("watch_id", w!.id);
    expect(events).toHaveLength(1);
    expect(events![0].trigger_types).toEqual(["price_hike"]);
    expect(Number(events![0].reference_price)).toBe(1_000_000);
    const { data: after } = await admin.from("watches").select("hike_active, last_hike_alerted_at, last_alerted_at").eq("id", w!.id).single();
    expect(after!.hike_active).toBe(true);
    expect(after!.last_hike_alerted_at).not.toBeNull();
    expect(after!.last_alerted_at).toBeNull();
  });

  it("not opted in → no price_hike event", async () => {
    const u = await user();
    const { data: w } = await u.client.from("watches").insert({ variant_id: hiked.variantId, notify_low: true }).select("id").single();
    await evaluateWatches({ now: new Date(), variantIds: [hiked.variantId] }, admin);
    const { data: events } = await admin.from("alert_events").select("trigger_types").eq("watch_id", w!.id);
    expect((events ?? []).flatMap((e) => e.trigger_types)).not.toContain("price_hike");
  });
});
