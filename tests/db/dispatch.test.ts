import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateWatches } from "@/lib/alerts/evaluate";
import { dispatchDueDeliveries } from "@/lib/alerts/dispatch";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (created.length) await deleteTestUser(created.pop()!.id);
});

async function userWithAlert() {
  const u = await createTestUser();
  created.push(u);
  const { data: v } = await admin
    .from("variant_current_price")
    .select("variant_id, price")
    .eq("in_stock", true)
    .not("price", "is", null)
    .limit(1)
    .single();
  await admin.from("variant_current_price").update({ observed_at: new Date().toISOString() }).eq("variant_id", v!.variant_id);
  await u.client.from("watches").insert({ variant_id: v!.variant_id, target_price: Number(v!.price) + 1000 });
  await evaluateWatches({ now: new Date(), variantIds: [v!.variant_id] }, admin);
  return u;
}

async function statusesOf(userId: string) {
  const { data } = await admin
    .from("alert_deliveries")
    .select("status, skip_reason, alert_events!inner(watches!inner(user_id))")
    .eq("alert_events.watches.user_id", userId);
  return (data ?? []).map((r) => [r.status, r.skip_reason]);
}

describe("dispatchDueDeliveries (email)", () => {
  it("gửi ở chế độ console → sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const u = await userWithAlert();
    await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(await statusesOf(u.id)).toEqual([["sent", null]]);
  });

  it("Watch đã tạm dừng trước khi gửi → skipped/watch_inactive", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await userWithAlert();
    await admin.from("watches").update({ status: "paused" }).eq("user_id", u.id);
    await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(await statusesOf(u.id)).toEqual([["skipped", "watch_inactive"]]);
  });
});
