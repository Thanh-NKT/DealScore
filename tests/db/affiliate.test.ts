import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let clickId: string;
let offerId: string;
const orderIds: string[] = [];

function row(o: Record<string, unknown> = {}) {
  const orderId = (o.order_id as string) ?? `T-${randomUUID()}`;
  if (!orderIds.includes(orderId)) orderIds.push(orderId);
  return {
    order_id: orderId,
    item_id: "i1",
    model_id: "",
    click_event_id: clickId,
    sub_ids: ["x", "web"],
    source_channel: "web",
    purchase_time: new Date().toISOString(),
    complete_time: null,
    status: "pending",
    raw_status: "PENDING",
    item_price: 100000,
    quantity: 1,
    order_value: 100000,
    commission: 5000,
    import_source: "api",
    raw: { test: true },
    ...o,
  };
}

beforeAll(async () => {
  const { data: offer } = await admin.from("offers").select("id").limit(1).single();
  offerId = offer!.id;
  const { data: click } = await admin.from("click_events").insert({ offer_id: offerId, source: "web" }).select("id").single();
  clickId = click!.id;
});
afterAll(async () => {
  await admin.from("conversions").delete().in("order_id", orderIds);
  await admin.from("click_events").delete().eq("id", clickId);
});

const upsert = (rows: unknown[]) => admin.rpc("upsert_conversions", { p_rows: rows as never });

describe("upsert_conversions", () => {
  it("upsert 2 lần cùng lô: lần 2 không chèn thêm", async () => {
    const r = row();
    const a = await upsert([r]);
    const b = await upsert([r]);
    expect(a.data?.[0]).toEqual({ inserted: 1, updated: 0, matched: 1 });
    expect(b.data?.[0]).toEqual({ inserted: 0, updated: 1, matched: 1 });
    const { count } = await admin.from("conversions").select("id", { count: "exact", head: true }).eq("order_id", r.order_id);
    expect(count).toBe(1);
  });

  it("pending → completed → cancelled; first_seen_at không đổi", async () => {
    const r = row();
    await upsert([r]);
    const { data: first } = await admin.from("conversions").select("first_seen_at").eq("order_id", r.order_id).single();
    await upsert([{ ...r, status: "completed", raw_status: "COMPLETED" }]);
    await upsert([{ ...r, status: "cancelled", raw_status: "CANCELLED" }]);
    const { data } = await admin.from("conversions").select("status, first_seen_at").eq("order_id", r.order_id).single();
    expect(data?.status).toBe("cancelled");
    expect(data?.first_seen_at).toBe(first?.first_seen_at);
  });

  it("bản sau thiếu sub_id: click đã khớp được giữ nguyên", async () => {
    const r = row();
    await upsert([r]);
    await upsert([{ ...r, click_event_id: null, sub_ids: [], source_channel: "unknown" }]);
    const { data } = await admin
      .from("conversions")
      .select("click_event_id, source_channel, sub_ids")
      .eq("order_id", r.order_id)
      .single();
    expect(data).toEqual({ click_event_id: clickId, source_channel: "web", sub_ids: ["x", "web"] });
  });

  it("click_event_id trỏ tới click không tồn tại → lưu với null", async () => {
    const r = row({ click_event_id: randomUUID() });
    const res = await upsert([r]);
    expect(res.data?.[0].matched).toBe(0);
    const { data } = await admin.from("conversions").select("click_event_id").eq("order_id", r.order_id).single();
    expect(data?.click_event_id).toBeNull();
  });
});

describe("upsert_conversions — hồi quy v_click", () => {
  it("đơn không khớp đứng SAU đơn khớp trong cùng lô không bị gán nhầm click", async () => {
    const matched = row();
    const unmatched = row({ click_event_id: randomUUID() });
    const res = await upsert([matched, unmatched]);
    expect(res.data?.[0]).toMatchObject({ inserted: 2, matched: 1 });
    const { data } = await admin.from("conversions").select("click_event_id").eq("order_id", unmatched.order_id).single();
    expect(data?.click_event_id).toBeNull();
  });
});

describe("views", () => {
  it("hai món cùng đơn → affiliate_daily đếm 1 đơn; match_rate đúng", async () => {
    const orderId = `T-${randomUUID()}`;
    const purchase = "2020-01-15T05:00:00Z"; // ngày cố định, không lẫn dữ liệu khác
    await upsert([
      row({ order_id: orderId, item_id: "a", purchase_time: purchase, source_channel: "push", status: "completed" }),
      row({ order_id: orderId, item_id: "b", purchase_time: purchase, source_channel: "push", status: "completed" }),
      row({ purchase_time: purchase, source_channel: "push", click_event_id: null }),
    ]);
    const { data } = await admin.from("affiliate_daily").select("*").eq("day", "2020-01-15").eq("channel", "push").single();
    expect(data).toMatchObject({ orders_total: 2, orders_matched: 1, commission_completed: 10000 });
    expect(Number(data?.match_rate)).toBe(0.5);
  });
});

describe("quyền", () => {
  let u: TestUser;
  beforeAll(async () => {
    u = await createTestUser();
  });
  afterAll(async () => deleteTestUser(u.id));

  it("user không đọc được conversions / views, không gọi được RPC", async () => {
    const r1 = await u.client.from("conversions").select("id").limit(1);
    const r2 = await u.client.from("affiliate_daily").select("*").limit(1);
    const r3 = await u.client.rpc("upsert_conversions", { p_rows: [] as never });
    expect(r1.error).not.toBeNull();
    expect(r2.error).not.toBeNull();
    expect(r3.error).not.toBeNull();
  });
});
