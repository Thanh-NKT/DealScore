import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "@/lib/email";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// Roadmap P4 T1: alert_events with more than one source (0061) + dispatch of discovery alerts.
const sentMessages: EmailMessage[] = [];
/** Recipient whose next send fails once. */
let failFor: string | null = null;
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendEmail: async (msg: EmailMessage) => {
      sentMessages.push(msg);
      if (failFor && msg.to === failFor) {
        failFor = null;
        throw new Error("provider down");
      }
      return { id: "test-id" };
    },
  };
});
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

const { evaluateWatches } = await import("@/lib/alerts/evaluate");
const { dispatchDueDeliveries, deliveryIdempotencyKey } = await import("@/lib/alerts/dispatch");

let products: Array<{ id: string; price: number }> = [];
beforeAll(async () => {
  const { data } = await admin
    .from("variant_current_price")
    .select("price, product_variants!inner(product_id)")
    .not("price", "is", null)
    .limit(4);
  products = (data ?? []).map((r) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id: (r.product_variants as any).product_id,
    price: Number(r.price),
  }));
});

const created: TestUser[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  sentMessages.length = 0;
});
afterAll(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}

async function savedSearch(u: TestUser, q = `ssd ${Math.random()}`) {
  const { data, error } = await u.client
    .from("saved_searches")
    .insert({ name: "SSD rẻ", params: { q, maxPrice: 5_000_000 } })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function fireSavedSearch(id: string, now = new Date()) {
  const p = products[0];
  const { data, error } = await admin.rpc("record_saved_search_evaluation", {
    p_id: id,
    p_params_version: 1,
    p_now: now.toISOString(),
    p_hits: [{ product_id: p.id, in_set: true, alerted: true, price: p.price }],
    p_event: {
      items: [{ product_id: p.id, variant_id: null, price: p.price, recommendation: "buy", score: 80 }],
      items_total: 1,
      price: p.price,
      deliver_after: now.toISOString(),
      channels: ["email"],
      cooldown_hours: 24,
    },
  });
  if (error) throw error;
  return data as string;
}

describe("alert_events sources (0061)", () => {
  it("a watch alert inserted without user_id gets the watch owner", async () => {
    const u = await user();
    const { data: v } = await admin.from("product_variants").select("id").limit(1).single();
    const { data: w } = await u.client.from("watches").insert({ variant_id: v!.id, target_price: 1 }).select("id").single();
    const { data: e, error } = await admin
      .from("alert_events")
      .insert({ watch_id: w!.id, trigger_types: ["target_price"], price: 1 })
      .select("user_id")
      .single();
    expect(error).toBeNull();
    expect(e!.user_id).toBe(u.id);
  });

  it("rejects two sources, a watch row with a discovery trigger, a discovery row with a watch trigger", async () => {
    const u = await user();
    const ss = await savedSearch(u);
    const { data: v } = await admin.from("product_variants").select("id").limit(1).single();
    const { data: w } = await u.client.from("watches").insert({ variant_id: v!.id, target_price: 1 }).select("id").single();
    const two = await admin.from("alert_events").insert({ watch_id: w!.id, saved_search_id: ss, trigger_types: ["saved_search"] });
    expect(two.error?.code).toBe("23514");
    const watchDisc = await admin.from("alert_events").insert({ watch_id: w!.id, trigger_types: ["saved_search"] });
    expect(watchDisc.error?.code).toBe("23514");
    const discWatch = await admin.from("alert_events").insert({ user_id: u.id, saved_search_id: ss, trigger_types: ["target_price"] });
    expect(discWatch.error?.code).toBe("23514");
    const mixed = await admin.from("alert_events").insert({ user_id: u.id, saved_search_id: ss, trigger_types: ["saved_search", "demand_found"] });
    expect(mixed.error?.code).toBe("23514");
  });

  it("claim_due_deliveries returns a null watch_id and the right user_id for a discovery event", async () => {
    const u = await user();
    const ev = await fireSavedSearch(await savedSearch(u));
    const { data: d } = await admin.from("alert_deliveries").select("id").eq("alert_event_id", ev).single();
    const { data: claimed } = await admin.rpc("claim_due_deliveries", { p_now: new Date().toISOString(), p_limit: 999 });
    const row = (claimed ?? []).find((r) => r.delivery_id === d!.id);
    expect(row).toMatchObject({ watch_id: null, user_id: u.id, alert_event_id: ev });
    // put it back so other tests are not affected
    await admin.from("alert_deliveries").update({ status: "skipped", skip_reason: "test" }).eq("id", d!.id);
  });

  it("RLS: user B cannot read A's discovery events or deliveries; A can", async () => {
    const a = await user();
    const b = await user();
    const ev = await fireSavedSearch(await savedSearch(a));
    expect((await a.client.from("alert_events").select("id").eq("id", ev)).data).toHaveLength(1);
    expect((await a.client.from("alert_deliveries").select("id").eq("alert_event_id", ev)).data).toHaveLength(1);
    expect((await b.client.from("alert_events").select("id").eq("id", ev)).data).toEqual([]);
    expect((await b.client.from("alert_deliveries").select("id").eq("alert_event_id", ev)).data).toEqual([]);
    await admin.from("alert_deliveries").update({ status: "skipped", skip_reason: "test" }).eq("alert_event_id", ev);
  });
});

async function statuses(eventIds: string[]) {
  const { data } = await admin.from("alert_deliveries").select("alert_event_id, status, skip_reason, attempts").in("alert_event_id", eventIds);
  return data ?? [];
}

describe("dispatchDueDeliveries with discovery alerts", () => {
  it("one email holds a watch item and a saved-search block", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await user();
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
    const ev = await fireSavedSearch(await savedSearch(u));

    await dispatchDueDeliveries({ now: new Date() }, admin);
    const mine = sentMessages.filter((m) => m.to === u.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toBe("2 tin mới từ DealScore");
    expect(mine[0].html).toContain("Có sản phẩm mới khớp “SSD rẻ”");
    expect(mine[0].html).toContain("Tạm dừng tìm kiếm này");
    expect((await statuses([ev]))[0].status).toBe("sent");
  });

  it("a paused saved search is skipped as source_inactive", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await user();
    const ss = await savedSearch(u);
    const ev = await fireSavedSearch(ss);
    await u.client.from("saved_searches").update({ status: "paused" }).eq("id", ss);
    await dispatchDueDeliveries({ now: new Date() }, admin);
    expect(await statuses([ev])).toMatchObject([{ status: "skipped", skip_reason: "source_inactive" }]);
  });

  it("provider failure → retried with the same idempotency key", async () => {
    vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret");
    const u = await user();
    const ev = await fireSavedSearch(await savedSearch(u));
    const { data: d } = await admin.from("alert_deliveries").select("id").eq("alert_event_id", ev).single();
    failFor = u.email;
    await dispatchDueDeliveries({ now: new Date() }, admin);
    const [st] = await statuses([ev]);
    expect(st).toMatchObject({ status: "pending", attempts: 1 });
    await admin.from("alert_deliveries").update({ next_attempt_at: new Date().toISOString() }).eq("id", d!.id);
    await dispatchDueDeliveries({ now: new Date() }, admin);
    const mine = sentMessages.filter((m) => m.to === u.email);
    expect(mine).toHaveLength(2);
    expect(mine[1].idempotencyKey).toBe(mine[0].idempotencyKey);
    expect(mine[0].idempotencyKey).toBe(deliveryIdempotencyKey([d!.id]));
    expect((await statuses([ev]))[0].status).toBe("sent");
  });
});
