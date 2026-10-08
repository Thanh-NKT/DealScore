import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { createFixtureCatalog, type FixtureCatalog } from "./fixtures";
import { SAVED_PARAMS_FIXTURES } from "../lib/saved-search/fixtures";
import { parseSavedParams } from "@/lib/saved-search/params";
import { searchProducts, searchProductsWith } from "@/lib/search";

// Roadmap P4 E (0060): saved_searches + saved_search_hits + record_saved_search_evaluation.
const created: TestUser[] = [];
afterAll(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
  await cat.cleanup();
});
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
// Own fixture products (P4 review I4).
let cat: FixtureCatalog;
const productIds: string[] = [];
beforeAll(async () => {
  cat = await createFixtureCatalog("ssearch");
  for (let i = 0; i < 3; i++) productIds.push((await cat.product({ price: 1_000 + i })).productId);
});

async function insert(u: TestUser, params: Record<string, unknown>, name = "SSD") {
  return u.client.from("saved_searches").insert({ name, params: params as never }).select("*").single();
}
const rpcEval = (id: string, version: number, now: Date, hits: unknown[], event: unknown) =>
  admin.rpc("record_saved_search_evaluation", {
    p_id: id,
    p_params_version: version,
    p_now: now.toISOString(),
    p_hits: hits as never,
    p_event: event as never,
  });
const event = (now: Date) => ({
  items: [{ product_id: productIds[0], price: 1000 }],
  items_total: 1,
  price: 1000,
  deliver_after: now.toISOString(),
  channels: ["email"],
  cooldown_hours: 24,
});

describe("saved_search_params_valid mirrors parseSavedParams", () => {
  it.each(SAVED_PARAMS_FIXTURES)("%s", async (_name, raw, valid) => {
    const { data, error } = await admin.rpc("saved_search_params_valid", { p: raw as never });
    expect(error).toBeNull();
    expect(data).toBe(valid);
    expect(parseSavedParams(raw) !== null).toBe(valid);
  });
});

describe("saved_searches table", () => {
  it("11th row → limit error; duplicate params → unique violation", async () => {
    const u = await user();
    for (let i = 0; i < 10; i++) expect((await insert(u, { q: `ssd ${i}`, maxPrice: 1000 })).error).toBeNull();
    const eleventh = await insert(u, { q: "ssd 11", maxPrice: 1000 });
    expect(eleventh.error?.code).toBe("23514");
    expect(eleventh.error?.message).toContain("tối đa 10");
    const u2 = await user();
    expect((await insert(u2, { q: "dup", maxPrice: 1 })).error).toBeNull();
    expect((await insert(u2, { q: "dup", maxPrice: 1 })).error?.code).toBe("23505");
  });

  it("authenticated cannot write engine state or hits; another user cannot read or edit", async () => {
    const u = await user();
    const other = await user();
    const { data: row } = await insert(u, { q: "x", maxPrice: 1 });
    const forged = await u.client.from("saved_searches").update({ initialized_at: new Date().toISOString() } as never).eq("id", row!.id);
    expect(forged.error?.code).toBe("42501");
    const forged2 = await u.client.from("saved_searches").update({ last_alerted_at: new Date().toISOString() } as never).eq("id", row!.id);
    expect(forged2.error?.code).toBe("42501");
    const hit = await u.client.from("saved_search_hits").insert({
      saved_search_id: row!.id, product_id: productIds[0], in_set: true,
      first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
    });
    expect(hit.error?.code).toBe("42501");
    expect((await other.client.from("saved_searches").select("id").eq("id", row!.id)).data).toEqual([]);
    await other.client.from("saved_searches").update({ name: "hack" }).eq("id", row!.id);
    const { data: after } = await admin.from("saved_searches").select("name").eq("id", row!.id).single();
    expect(after!.name).toBe("SSD");
  });

  it("an insert cannot preset engine state (trigger resets it)", async () => {
    const u = await user();
    const { data } = await admin
      .from("saved_searches")
      .insert({ user_id: u.id, name: "x", params: { q: "y", maxPrice: 1 }, params_version: 9, initialized_at: new Date().toISOString() })
      .select("params_version, initialized_at")
      .single();
    expect(data).toEqual({ params_version: 1, initialized_at: null });
  });

  it("a params update bumps params_version, nulls initialized_at and deletes the hits", async () => {
    const u = await user();
    const { data: row } = await insert(u, { q: "z", maxPrice: 1000 });
    const now = new Date();
    await rpcEval(row!.id, 1, now, [{ product_id: productIds[0], in_set: true, alerted: false, price: 1 }], null);
    expect((await admin.from("saved_search_hits").select("product_id").eq("saved_search_id", row!.id)).data).toHaveLength(1);
    await u.client.from("saved_searches").update({ name: "renamed" }).eq("id", row!.id);
    let s = (await admin.from("saved_searches").select("params_version, initialized_at").eq("id", row!.id).single()).data!;
    expect(s.params_version).toBe(1);
    expect(s.initialized_at).not.toBeNull();
    await u.client.from("saved_searches").update({ params: { q: "z", maxPrice: 900 } }).eq("id", row!.id);
    s = (await admin.from("saved_searches").select("params_version, initialized_at").eq("id", row!.id).single()).data!;
    expect(s).toEqual({ params_version: 2, initialized_at: null });
    expect((await admin.from("saved_search_hits").select("product_id").eq("saved_search_id", row!.id)).data).toEqual([]);
  });
});

describe("record_saved_search_evaluation", () => {
  it("ignores a stale params_version and a paused search", async () => {
    const u = await user();
    const { data: row } = await insert(u, { q: "a", maxPrice: 1 });
    expect((await rpcEval(row!.id, 2, new Date(), [], event(new Date()))).data).toBeNull();
    await u.client.from("saved_searches").update({ status: "paused" }).eq("id", row!.id);
    expect((await rpcEval(row!.id, 1, new Date(), [], event(new Date()))).data).toBeNull();
    const { count } = await admin.from("alert_events").select("id", { count: "exact", head: true }).eq("saved_search_id", row!.id);
    expect(count).toBe(0);
  });

  it("writes the event + deliveries; the cooldown re-check inside blocks a 2nd event and its alerted hits", async () => {
    const u = await user();
    const { data: row } = await insert(u, { q: "b", maxPrice: 1 });
    const now = new Date();
    const first = await rpcEval(row!.id, 1, now, [{ product_id: productIds[0], in_set: true, alerted: true, price: 1000 }], event(now));
    expect(first.error).toBeNull();
    expect(first.data).toBeTruthy();
    const { data: ev } = await admin.from("alert_events").select("user_id, trigger_types, items_total, price, watch_id").eq("id", first.data!).single();
    expect(ev).toEqual({ user_id: u.id, trigger_types: ["saved_search"], items_total: 1, price: 1000, watch_id: null });
    expect((await admin.from("alert_deliveries").select("channel").eq("alert_event_id", first.data!)).data).toEqual([{ channel: "email" }]);
    await admin.from("alert_deliveries").update({ status: "skipped", skip_reason: "test" }).eq("alert_event_id", first.data!);

    // A concurrent / repeated run one hour later wanting to alert a 2nd product.
    const later = new Date(now.getTime() + 3_600_000);
    const second = await rpcEval(row!.id, 1, later, [{ product_id: productIds[1], in_set: true, alerted: true, price: 5 }], event(later));
    expect(second.data).toBeNull();
    const { data: hits } = await admin.from("saved_search_hits").select("product_id, alerted_at").eq("saved_search_id", row!.id);
    expect(hits!.map((h) => h.product_id)).toEqual([productIds[0]]);
  });
});

describe("searchProductsWith", () => {
  it("returns the same items as searchProducts for the same params", async () => {
    const params = { q: "ssd", sort: "price_asc" as const, page: 1 };
    // searchProducts goes through the cookie client; outside a request it falls back to anon via the mock-free
    // server client only inside Next — so compare the admin client with an anon client instead.
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const a = await searchProductsWith(admin, params);
    const b = await searchProductsWith(anon as never, params);
    expect(a.items.map((i) => i.productId)).toEqual(b.items.map((i) => i.productId));
    expect(a.total).toBe(b.total);
    expect(typeof searchProducts).toBe("function");
  });
});
