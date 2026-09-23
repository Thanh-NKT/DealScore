import { afterEach, describe, expect, it } from "vitest";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

async function freshVariant() {
  const { data } = await admin
    .from("variant_current_price")
    .select("variant_id, price")
    .eq("in_stock", true)
    .not("price", "is", null)
    .limit(1)
    .single();
  // Seed có thể đã cũ hơn 48 giờ — làm tươi để không bị coi là stale.
  await admin.from("variant_current_price").update({ observed_at: new Date().toISOString() }).eq("variant_id", data!.variant_id);
  return { variantId: data!.variant_id, price: Number(data!.price) };
}

describe("evaluateWatches", () => {
  it("target cao hơn giá hiện tại → 1 event + 1 delivery email pending; lượt 2 không báo thêm", async () => {
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
    // Mặc định 1.6: email bật, push tắt.
    expect(events![0].alert_deliveries).toEqual([{ channel: "email", status: "pending" }]);

    await evaluateWatches({ now: new Date(), variantIds: [v.variantId] }, admin);
    const { count } = await admin
      .from("alert_events")
      .select("id, watches!inner(user_id)", { count: "exact", head: true })
      .eq("watches.user_id", u.id);
    expect(count).toBe(1);
  });

  it("tắt hết kênh → không ghi gì, không dời last_evaluated_at", async () => {
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

  it("user đang chờ xóa → bị bỏ qua", async () => {
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
