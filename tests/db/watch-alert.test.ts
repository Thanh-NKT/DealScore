import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MAX_ACTIVE_WATCHES } from "@/lib/watch/constants";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

let variants: Array<{ variant_id: string; price: number }> = [];
beforeAll(async () => {
  const { data } = await admin
    .from("variant_current_price")
    .select("variant_id, price")
    .eq("in_stock", true)
    .not("price", "is", null)
    .limit(60);
  variants = (data ?? []).map((v) => ({ variant_id: v.variant_id, price: Number(v.price) }));
  if (variants.length < 52) throw new Error("Cần ≥ 52 variant có giá — chạy pnpm seed:dev");
});

describe("watches — trigger và quyền", () => {
  it("user tạo Watch: trigger điền product_id và baseline_price", async () => {
    const u = await user();
    const v = variants[0];
    const { data, error } = await u.client
      .from("watches")
      .insert({ variant_id: v.variant_id, target_price: 1000 })
      .select("product_id, baseline_price, user_id")
      .single();
    expect(error).toBeNull();
    expect(data?.product_id).toBeTruthy();
    expect(Number(data?.baseline_price)).toBe(v.price);
    expect(data?.user_id).toBe(u.id);
  });

  it("user không tự gửi baseline_price / cond_state", async () => {
    const u = await user();
    const ins = await u.client
      .from("watches")
      .insert({ variant_id: variants[1].variant_id, target_price: 1, baseline_price: 1 } as never);
    expect(ins.error).not.toBeNull();

    const { data: w } = await u.client
      .from("watches")
      .insert({ variant_id: variants[1].variant_id, target_price: 1000 })
      .select("id")
      .single();
    const upd = await u.client.from("watches").update({ cond_state: { target_price: true } } as never).eq("id", w!.id);
    expect(upd.error).not.toBeNull();
  });

  it("không có điều kiện nào → vi phạm check", async () => {
    const u = await user();
    const { error } = await u.client.from("watches").insert({ variant_id: variants[2].variant_id });
    expect(error).not.toBeNull();
  });

  it("Watch thứ hai cho cùng variant → vi phạm unique", async () => {
    const u = await user();
    await u.client.from("watches").insert({ variant_id: variants[3].variant_id, target_price: 1000 });
    const { error } = await u.client.from("watches").insert({ variant_id: variants[3].variant_id, target_price: 2000 });
    expect(error?.code).toBe("23505");
  });

  it(`Watch hoạt động thứ ${MAX_ACTIVE_WATCHES + 1} → P0050; kích hoạt lại khi đủ 50 → P0050`, async () => {
    const u = await user();
    for (let i = 0; i < MAX_ACTIVE_WATCHES; i++) {
      const { error } = await u.client.from("watches").insert({ variant_id: variants[i].variant_id, target_price: 1000 });
      expect(error).toBeNull();
    }
    const over = await u.client.from("watches").insert({ variant_id: variants[50].variant_id, target_price: 1000 });
    expect(over.error?.code).toBe("P0050");

    const paused = await u.client
      .from("watches")
      .insert({ variant_id: variants[51].variant_id, target_price: 1000, status: "paused" })
      .select("id")
      .single();
    expect(paused.error).toBeNull();
    const reactivate = await u.client.from("watches").update({ status: "active" }).eq("id", paused.data!.id);
    expect(reactivate.error?.code).toBe("P0050");
  });

  it("đổi điều kiện → reset cond_state, tăng config_version, giữ last_alerted_at", async () => {
    const u = await user();
    const { data: w } = await u.client
      .from("watches")
      .insert({ variant_id: variants[4].variant_id, target_price: 1000 })
      .select("id")
      .single();
    const at = new Date().toISOString();
    await admin
      .from("watches")
      .update({ cond_state: { target_price: true }, last_alerted_at: at, last_alert_price: 900 })
      .eq("id", w!.id);

    await u.client.from("watches").update({ target_price: 2000 }).eq("id", w!.id);
    const { data } = await admin
      .from("watches")
      .select("cond_state, config_version, last_alerted_at, last_alert_price")
      .eq("id", w!.id)
      .single();
    expect(data?.cond_state).toEqual({});
    expect(data?.config_version).toBe(2);
    expect(new Date(data!.last_alerted_at!).toISOString()).toBe(at);
    expect(data?.last_alert_price).toBeNull();
  });
});

describe("record_watch_evaluation", () => {
  async function newWatch() {
    const u = await user();
    const { data } = await u.client
      .from("watches")
      .insert({ variant_id: variants[5].variant_id, target_price: 1000 })
      .select("id, config_version")
      .single();
    return data!;
  }
  const event = {
    trigger_types: ["target_price"],
    price: 900,
    offer_id: null,
    baseline_price: 1000,
    previous_alert_price: null,
    deal_score: 80,
    recommendation: "buy",
    score_reasons: ["✓ lý do"],
    deliver_after: new Date().toISOString(),
    channels: ["email", "push"],
  };

  it("event + 2 kênh → 1 alert_event + 2 deliveries, trạng thái watch được ghi", async () => {
    const w = await newWatch();
    const now = new Date().toISOString();
    const { data: id, error } = await admin.rpc("record_watch_evaluation", {
      p_watch_id: w.id,
      p_config_version: w.config_version,
      p_now: now,
      p_state: { cond_state: { target_price: true }, last_in_stock: true, alerted: { price: 900, at: now } },
      p_event: event,
    });
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    const { count } = await admin
      .from("alert_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("alert_event_id", id!);
    expect(count).toBe(2);
    const { data: after } = await admin.from("watches").select("last_alert_price, cond_state").eq("id", w.id).single();
    expect(Number(after?.last_alert_price)).toBe(900);
    expect(after?.cond_state).toEqual({ target_price: true });
  });

  it("config_version cũ → không ghi gì, trả null", async () => {
    const w = await newWatch();
    const { data } = await admin.rpc("record_watch_evaluation", {
      p_watch_id: w.id,
      p_config_version: w.config_version + 99,
      p_now: new Date().toISOString(),
      p_state: {},
      p_event: event,
    });
    expect(data).toBeNull();
    const { count } = await admin.from("alert_events").select("id", { count: "exact", head: true }).eq("watch_id", w.id);
    expect(count).toBe(0);
  });
});

describe("claim_due_deliveries + job lock", () => {
  it("hai lượt nhận song song không trùng việc; 'sending' quá 15 phút nhận lại được", async () => {
    const u = await user();
    const { data: w } = await u.client
      .from("watches")
      .insert({ variant_id: variants[6].variant_id, target_price: 1000 })
      .select("id, config_version")
      .single();
    const past = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 3; i++) {
      const { data: e } = await admin
        .from("alert_events")
        .insert({ watch_id: w!.id, trigger_types: ["target_price"], price: 1, deliver_after: past })
        .select("id")
        .single();
      await admin.from("alert_deliveries").insert({ alert_event_id: e!.id, channel: "email", next_attempt_at: past });
    }

    const now = new Date().toISOString();
    const [a, b] = await Promise.all([
      admin.rpc("claim_due_deliveries", { p_now: now, p_limit: 1000 }),
      admin.rpc("claim_due_deliveries", { p_now: now, p_limit: 1000 }),
    ]);
    const mine = (rows: typeof a.data) => (rows ?? []).filter((r) => r.watch_id === w!.id).map((r) => r.delivery_id);
    const ids = [...mine(a.data), ...mine(b.data)];
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);

    const later = new Date(Date.now() + 16 * 60_000).toISOString();
    const { data: again } = await admin.rpc("claim_due_deliveries", { p_now: later, p_limit: 1000 });
    expect(mine(again).length).toBe(3);
  });

  it("lease lock: lần 2 null; sau release thì giành lại được", async () => {
    const name = `test-${Date.now()}`;
    const r1 = await admin.rpc("try_acquire_job_lock", { p_name: name, p_owner: "a", p_ttl_seconds: 600 });
    const r2 = await admin.rpc("try_acquire_job_lock", { p_name: name, p_owner: "b", p_ttl_seconds: 600 });
    expect(r1.data).toBe(true);
    expect(r2.data).toBeNull();
    await admin.rpc("release_job_lock", { p_name: name, p_owner: "a" });
    const r3 = await admin.rpc("try_acquire_job_lock", { p_name: name, p_owner: "b", p_ttl_seconds: 600 });
    expect(r3.data).toBe(true);
    await admin.from("job_locks").delete().eq("name", name);
  });
});

describe("RLS và quyền hàm", () => {
  it("user A không đọc được deliveries / push_subscriptions của B", async () => {
    const a = await user();
    const b = await user();
    await b.client.from("push_subscriptions").insert({ endpoint: `https://push.test/${b.id}`, p256dh: "k", auth: "a" });
    const { data } = await a.client.from("push_subscriptions").select("id");
    expect(data).toEqual([]);
  });

  it("anon / user không gọi được RPC của engine", async () => {
    const u = await user();
    const r1 = await u.client.rpc("claim_due_deliveries", { p_now: new Date().toISOString(), p_limit: 1 });
    const r2 = await u.client.rpc("try_acquire_job_lock", { p_name: "x", p_owner: "x", p_ttl_seconds: 1 });
    expect(r1.error).not.toBeNull();
    expect(r2.error).not.toBeNull();
  });

  it("xóa user → cascade watches, alert_events, deliveries, push_subscriptions", async () => {
    const u = await user();
    const { data: w } = await u.client
      .from("watches")
      .insert({ variant_id: variants[7].variant_id, target_price: 1000 })
      .select("id")
      .single();
    const { data: e } = await admin
      .from("alert_events")
      .insert({ watch_id: w!.id, trigger_types: ["target_price"], price: 1, deliver_after: new Date().toISOString() })
      .select("id")
      .single();
    await admin.from("alert_deliveries").insert({ alert_event_id: e!.id, channel: "email", next_attempt_at: new Date().toISOString() });
    await u.client.from("push_subscriptions").insert({ endpoint: `https://push.test/${u.id}`, p256dh: "k", auth: "a" });

    await deleteTestUser(u.id);
    const { count: c1 } = await admin.from("alert_deliveries").select("id", { count: "exact", head: true }).eq("alert_event_id", e!.id);
    const { count: c2 } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", u.id);
    expect(c1).toBe(0);
    expect(c2).toBe(0);
  });
});
