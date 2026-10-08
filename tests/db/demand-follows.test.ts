import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { createFixtureCatalog, type FixtureCatalog } from "./fixtures";
import { purgeDeletedAccounts } from "@/lib/account/purge";

// Roadmap P4 F (0060): demand_follows, record_demand_follow_check, admin_demand_follow_counts, prune.
const created: TestUser[] = [];
let cat: FixtureCatalog;
beforeAll(async () => {
  cat = await createFixtureCatalog("dfollow");
});
afterAll(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
  await cat.cleanup();
});
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
const DAY = 86_400_000;
const kw = () => `kw ${Math.random().toString(36).slice(2, 10)}`;

async function follow(u: TestUser, keyword = kw(), o: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("demand_follows")
    .insert({ user_id: u.id, keyword, expires_at: new Date(Date.now() + 30 * DAY).toISOString(), ...o })
    .select("id, keyword")
    .single();
  if (error) throw error;
  return data;
}
const found = (now: Date) => ({
  items: [{ product_id: "11111111-1111-4111-8111-111111111111", price: 10 }],
  items_total: 1,
  price: 10,
  deliver_after: now.toISOString(),
  channels: ["email"],
  user_cooldown_hours: 24,
});

describe("demand_follows privileges", () => {
  it("anon / authenticated cannot insert or update; the owner selects and deletes only their own", async () => {
    const u = await user();
    const other = await user();
    const ins = await u.client.from("demand_follows").insert({ user_id: u.id, keyword: "abc", expires_at: new Date().toISOString() });
    expect(ins.error?.code).toBe("42501");
    const f = await follow(u);
    const upd = await u.client.from("demand_follows").update({ keyword: "zzz" } as never).eq("id", f.id);
    expect(upd.error?.code).toBe("42501");
    expect((await other.client.from("demand_follows").select("id").eq("id", f.id)).data).toEqual([]);
    await other.client.from("demand_follows").delete().eq("id", f.id);
    expect((await admin.from("demand_follows").select("id").eq("id", f.id)).data).toHaveLength(1);
    expect((await u.client.from("demand_follows").select("id, keyword").eq("id", f.id)).data).toEqual([f]);
    await u.client.from("demand_follows").delete().eq("id", f.id);
    expect((await admin.from("demand_follows").select("id").eq("id", f.id)).data).toEqual([]);
  });

  it("11th waiting follow → limit; re-follow of an expired keyword (upsert) resets it to waiting", async () => {
    const u = await user();
    for (let i = 0; i < 10; i++) await follow(u);
    const over = await admin.from("demand_follows").insert({ user_id: u.id, keyword: kw(), expires_at: new Date().toISOString() });
    expect(over.error?.code).toBe("23514");
    const u2 = await user();
    const f = await follow(u2, "may hut bui", { status: "expired" });
    const { data, error } = await admin
      .from("demand_follows")
      .upsert(
        { user_id: u2.id, keyword: "may hut bui", status: "waiting", expires_at: new Date(Date.now() + 30 * DAY).toISOString(), known_product_ids: [], last_checked_at: null, found_at: null },
        { onConflict: "user_id,keyword" },
      )
      .select("id, status")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ id: f.id, status: "waiting" });
  });
});

describe("record_demand_follow_check", () => {
  it("found → event + follow found; a 2nd follow found the same hour stays waiting (per-user cooldown)", async () => {
    const u = await user();
    const a = await follow(u);
    const b = await follow(u);
    const now = new Date();
    const r1 = await admin.rpc("record_demand_follow_check", { p_id: a.id, p_now: now.toISOString(), p_status: "found", p_event: found(now) });
    expect(r1.error).toBeNull();
    expect(r1.data).toBeTruthy();
    await admin.from("alert_deliveries").update({ status: "skipped", skip_reason: "test" }).eq("alert_event_id", r1.data!);
    const r2 = await admin.rpc("record_demand_follow_check", { p_id: b.id, p_now: now.toISOString(), p_status: "found", p_event: found(now) });
    expect(r2.data).toBeNull();
    const { data: rows } = await admin.from("demand_follows").select("id, status, found_at").in("id", [a.id, b.id]).order("id");
    const byId = Object.fromEntries((rows ?? []).map((r) => [r.id, r.status]));
    expect(byId).toEqual({ [a.id]: "found", [b.id]: "waiting" });
    // Next day: b alerts.
    const tomorrow = new Date(now.getTime() + 25 * 3_600_000);
    const r3 = await admin.rpc("record_demand_follow_check", { p_id: b.id, p_now: tomorrow.toISOString(), p_status: "found", p_event: found(tomorrow) });
    expect(r3.data).toBeTruthy();
    await admin.from("alert_deliveries").update({ status: "skipped", skip_reason: "test" }).eq("alert_event_id", r3.data!);
    // A finished follow is not touched again.
    expect((await admin.rpc("record_demand_follow_check", { p_id: a.id, p_now: tomorrow.toISOString(), p_status: "expired", p_event: null })).data).toBeNull();
    expect((await admin.from("demand_follows").select("status").eq("id", a.id).single()).data!.status).toBe("found");
  });

  it("refuses an event with a non-found status", async () => {
    const u = await user();
    const a = await follow(u);
    const r = await admin.rpc("record_demand_follow_check", { p_id: a.id, p_now: new Date().toISOString(), p_status: "waiting", p_event: found(new Date()) });
    expect(r.error?.message).toContain("record_demand_follow_check");
  });
});

describe("admin_demand_follow_counts", () => {
  it("counts waiting, unexpired follows per keyword — no user ids", async () => {
    const k = kw();
    const u1 = await user();
    const u2 = await user();
    const u3 = await user();
    await follow(u1, k);
    await follow(u2, k);
    await follow(u3, k, { status: "expired" });
    const { data, error } = await admin.rpc("admin_demand_follow_counts", { p_keywords: [k, "không ai chờ"] });
    expect(error).toBeNull();
    expect(data).toEqual([{ keyword: k, waiting: 2 }]);
    const bad = await admin.rpc("admin_demand_follow_counts", { p_keywords: [] });
    expect(bad.error?.message).toContain("admin_demand_follow_counts");
  });
});

describe("prune and erasure", () => {
  it("prune deletes found / expired follows older than 30 days only", async () => {
    const u = await user();
    const old = await follow(u, kw(), { status: "found", found_at: new Date(Date.now() - 31 * DAY).toISOString() });
    const recent = await follow(u, kw(), { status: "found", found_at: new Date(Date.now() - 5 * DAY).toISOString() });
    const waiting = await follow(u, kw(), { expires_at: new Date(Date.now() - 40 * DAY).toISOString() });
    const { data, error } = await admin.rpc("prune_operational_data");
    expect(error).toBeNull();
    expect(data).toHaveProperty("demand_follows");
    expect(data).toHaveProperty("saved_search_hits");
    const { data: left } = await admin.from("demand_follows").select("id").in("id", [old.id, recent.id, waiting.id]);
    expect(left!.map((r) => r.id).sort()).toEqual([recent.id, waiting.id].sort());
  });

  it("purging the account removes its follows, saved searches, hits, shares and non-watch alert events", async () => {
    const u = await user();
    const f = await follow(u);
    const { data: ss } = await u.client.from("saved_searches").insert({ name: "x", params: { q: "y", maxPrice: 1 } }).select("id").single();
    const p = { id: (await cat.product({ price: 1_000 })).productId };
    const now = new Date();
    const { data: ev } = await admin.rpc("record_saved_search_evaluation", {
      p_id: ss!.id, p_params_version: 1, p_now: now.toISOString(),
      p_hits: [{ product_id: p.id, in_set: true, alerted: true, price: 1 }],
      p_event: { items: [], items_total: 1, deliver_after: now.toISOString(), channels: [] },
    });
    const { data: folder } = await u.client.from("watch_folders").insert({ user_id: u.id, name: "Quà" }).select("id").single();
    await admin.from("watch_folder_shares").insert({ folder_id: folder!.id, user_id: u.id, token: randomBytes(32).toString("base64url") });
    await admin.from("users").update({ deleted_at: new Date(Date.now() - 31 * DAY).toISOString() }).eq("id", u.id);
    const r = await purgeDeletedAccounts({ now: new Date(), userIds: [u.id] }, admin);
    expect(r.purged).toContain(u.id);
    expect((await admin.from("demand_follows").select("id").eq("id", f.id)).data).toEqual([]);
    expect((await admin.from("saved_searches").select("id").eq("id", ss!.id)).data).toEqual([]);
    expect((await admin.from("saved_search_hits").select("product_id").eq("saved_search_id", ss!.id)).data).toEqual([]);
    expect((await admin.from("watch_folder_shares").select("id").eq("user_id", u.id)).data).toEqual([]);
    expect((await admin.from("alert_events").select("id").eq("id", ev!)).data).toEqual([]);
  });
});
