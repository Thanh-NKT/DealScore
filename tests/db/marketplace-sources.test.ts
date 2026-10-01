import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const tag = randomUUID().slice(0, 8);
const extIds: string[] = [];
let user: TestUser;

function payload(marketplace: string, ext: string, extra: Record<string, unknown> = {}) {
  extIds.push(ext);
  return {
    marketplace,
    ext_item_id: ext,
    url: `https://example.test/${ext}`,
    title: `Sources test ${tag}`,
    slug_base: `test-sources-${tag}`,
    source: "seed",
    seller: { external_id: `seller-${tag}-${marketplace}`, name: "Test" },
    models: [{ model_id: "default", name: "", price: 450_000 }],
    ...extra,
  };
}

beforeAll(async () => {
  user = await createTestUser();
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-sources-${tag}%`);
  await admin.from("sellers").delete().like("external_seller_id", `seller-${tag}%`);
  await admin.from("marketplace_credentials").delete().eq("marketplace", "tiktok");
  await admin.from("sourcing_queries").delete().like("value", `test-${tag}%`);
  await deleteTestUser(user.id);
});

describe("ingest_listing", () => {
  it("ingests a TikTok item under the tiktok marketplace", async () => {
    const ext = `17${Date.now()}`;
    const { data, error } = await admin.rpc("ingest_listing", { p: payload("tiktok", ext) });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("ingested");
    const { data: l } = await admin
      .from("listings")
      .select("marketplace, refresh_priority, sellers(marketplace)")
      .eq("external_item_id", ext)
      .single();
    expect(l).toMatchObject({ marketplace: "tiktok", refresh_priority: 1, sellers: { marketplace: "tiktok" } });
  });

  it("uses refresh_priority for new listings and never lowers an existing one", async () => {
    const ext = `17${Date.now()}9`;
    await admin.rpc("ingest_listing", { p: payload("tiktok", ext, { refresh_priority: 3 }) });
    let { data: l } = await admin.from("listings").select("refresh_priority").eq("external_item_id", ext).single();
    expect(l!.refresh_priority).toBe(3);
    // A paste of the same item (priority 1) upgrades it; a later sourcing pass (3) does not downgrade it.
    // (The draft offer has a variant, so these calls take the 'resolved' branch, which also applies least().)
    await admin.rpc("ingest_listing", { p: payload("tiktok", ext, { refresh_priority: 1 }) });
    ({ data: l } = await admin.from("listings").select("refresh_priority").eq("external_item_id", ext).single());
    expect(l!.refresh_priority).toBe(1);
    await admin.rpc("ingest_listing", { p: payload("tiktok", ext, { refresh_priority: 3 }) });
    ({ data: l } = await admin.from("listings").select("refresh_priority").eq("external_item_id", ext).single());
    expect(l!.refresh_priority).toBe(1);
  });

  it("rejects an unknown marketplace or priority", async () => {
    const bad = await admin.rpc("ingest_listing", { p: payload("ebay", `x${tag}`) });
    expect(bad.error?.message).toContain("marketplace");
    const badPriority = await admin.rpc("ingest_listing", { p: payload("shopee", `1_${tag}`, { refresh_priority: 7 }) });
    expect(badPriority.error?.message).toContain("refresh_priority");
  });

  it("ingest_shopee_item still works and is forced to shopee", async () => {
    const ext = `1_${tag}${Date.now()}`;
    const { error } = await admin.rpc("ingest_shopee_item", { p: payload("tiktok", ext) });
    expect(error).toBeNull();
    const { data: l } = await admin.from("listings").select("marketplace").eq("external_item_id", ext).single();
    expect(l!.marketplace).toBe("shopee");
  });
});

describe("private tables", () => {
  it("anon/authenticated cannot read credentials or sourcing tables", async () => {
    await admin.from("marketplace_credentials").upsert({
      marketplace: "tiktok",
      access_token: "a",
      access_expires_at: new Date().toISOString(),
      refresh_token: "r",
      refresh_expires_at: new Date().toISOString(),
    });
    await admin.from("sourcing_queries").insert({ marketplace: "tiktok", kind: "keyword", value: `test-${tag}` });
    for (const table of ["marketplace_credentials", "sourcing_queries", "sourcing_runs"] as const) {
      const { data } = await user.client.from(table).select("*");
      expect(data ?? []).toEqual([]);
    }
  });

  it("collector_runs has per_marketplace", async () => {
    const { error } = await admin.from("collector_runs").select("per_marketplace").limit(1);
    expect(error).toBeNull();
  });
});
