import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { purgeDeletedAccounts } from "@/lib/account/purge";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// DB review I4 / user review I3, M2, M8 and review-db M5.
const created: TestUser[] = [];
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

let variants: string[] = [];
let offerId: string;
beforeAll(async () => {
  const { data } = await admin.from("variant_current_price").select("variant_id").limit(60);
  variants = (data ?? []).map((v) => v.variant_id);
  if (variants.length < 52) throw new Error("Need ≥ 52 priced variants — run pnpm seed:dev");
  const { data: o } = await admin.from("offers").select("id").limit(1).single();
  offerId = o!.id;
});

describe("extension contributions and account erasure", () => {
  it("rows keyed 'u:<id>' are linked to the user and removed by the purge; IP contributors are not", async () => {
    const u = await user();
    await admin.from("users").update({ deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }).eq("id", u.id);
    const contributor = `u:${u.id}`;
    const ipContributor = `ip:test-${u.id}`;
    const { data: obs, error } = await admin.from("extension_observations")
      .insert([
        { offer_id: offerId, contributor, observed_at: new Date().toISOString(), price: 123_000 },
        { offer_id: offerId, contributor: ipContributor, observed_at: new Date().toISOString(), price: 123_000 },
      ])
      .select("id, user_id");
    expect(error).toBeNull();
    expect(obs!.map((r) => r.user_id)).toEqual([u.id, null]);
    const { data: q } = await admin.rpc("extension_contribution_begin", { p_contributor: contributor });
    expect(q![0].allowed).toBe(true);

    const r = await purgeDeletedAccounts({ now: new Date() }, admin);
    expect(r.purged).toContain(u.id);
    const { count: obsLeft } = await admin.from("extension_observations")
      .select("id", { count: "exact", head: true }).eq("contributor", contributor);
    const { count: contribLeft } = await admin.from("extension_contributions")
      .select("id", { count: "exact", head: true }).eq("contributor", contributor);
    expect(obsLeft).toBe(0);
    expect(contribLeft).toBe(0);
    const { count: ipLeft } = await admin.from("extension_observations")
      .select("id", { count: "exact", head: true }).eq("contributor", ipContributor);
    expect(ipLeft).toBe(1);
    await admin.from("extension_observations").delete().eq("contributor", ipContributor);
  });
});

describe("users.email", () => {
  it("follows an email change in auth.users", async () => {
    const u = await user();
    const next = `changed-${u.email}`;
    const { error } = await admin.auth.admin.updateUserById(u.id, { email: next, email_confirm: true });
    expect(error).toBeNull();
    const { data } = await admin.from("users").select("email").eq("id", u.id).single();
    expect(data!.email).toBe(next);
  });
});

describe("latest_alerts_for_watches", () => {
  it("returns only the newest alert of each of the caller's watches", async () => {
    const u = await user();
    const other = await user();
    const { data: w } = await u.client.from("watches").insert({ variant_id: variants[0], target_price: 1000 }).select("id").single();
    const { data: ow } = await other.client.from("watches").insert({ variant_id: variants[1], target_price: 1000 }).select("id").single();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data: e } = await admin.from("alert_events")
        .insert({ watch_id: w!.id, trigger_types: ["target_price"], price: 1, created_at: new Date(Date.now() - (3 - i) * 60_000).toISOString() })
        .select("id").single();
      ids.push(e!.id);
    }
    await admin.from("alert_deliveries").insert({ alert_event_id: ids[2], channel: "email", next_attempt_at: new Date().toISOString() });
    await admin.from("alert_events").insert({ watch_id: ow!.id, trigger_types: ["target_price"], price: 1 });

    const { data, error } = await u.client.rpc("latest_alerts_for_watches", { p_watch_ids: [w!.id, ow!.id] });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ id: ids[2], watch_id: w!.id, deliveries: [{ channel: "email", status: "pending", sent_at: null }] });
  });
});

describe("watch limit under concurrency", () => {
  it("two concurrent inserts at 49 active watches cannot both pass the 50 limit", async () => {
    const u = await user();
    const rows = variants.slice(0, 49).map((variant_id) => ({ user_id: u.id, variant_id, target_price: 1000 }));
    const { error } = await admin.from("watches").insert(rows);
    expect(error).toBeNull();
    const [a, b] = await Promise.all([
      u.client.from("watches").insert({ variant_id: variants[49], target_price: 1000 }),
      u.client.from("watches").insert({ variant_id: variants[50], target_price: 1000 }),
    ]);
    expect([a.error, b.error].filter(Boolean)).toHaveLength(1);
    const { count } = await admin.from("watches").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("status", "active");
    expect(count).toBe(50);
  });
});
