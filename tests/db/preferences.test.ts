import { afterEach, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// user_preferences (migration 0015, spec 2026-09-28-giai-doan-3-nhom-a §5): owner-only RLS + checks.
const created: TestUser[] = [];
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

async function user(): Promise<TestUser> {
  const u = await createTestUser();
  created.push(u);
  return u;
}

describe("user_preferences", () => {
  it("the owner can upsert and read back their row", async () => {
    const u = await user();
    const { error } = await u.client
      .from("user_preferences")
      .upsert({ user_id: u.id, brands: ["Samsung"], min_price: 100_000, max_price: 3_000_000, marketplaces: ["shopee"] });
    expect(error).toBeNull();
    const { error: again } = await u.client
      .from("user_preferences")
      .upsert({ user_id: u.id, brands: ["Samsung", "WD"], marketplaces: ["shopee", "lazada"] });
    expect(again).toBeNull();

    const { data } = await u.client.from("user_preferences").select("*").eq("user_id", u.id);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      brands: ["Samsung", "WD"],
      excluded_brands: [],
      category_ids: [],
      marketplaces: ["shopee", "lazada"],
    });
  });

  it("another user can neither read, update, delete nor insert for the owner", async () => {
    const owner = await user();
    const other = await user();
    await owner.client.from("user_preferences").insert({ user_id: owner.id, brands: ["Samsung"] });

    const { data: seen } = await other.client.from("user_preferences").select("user_id").eq("user_id", owner.id);
    expect(seen).toEqual([]);
    const { data: updated } = await other.client
      .from("user_preferences")
      .update({ brands: ["Hack"] })
      .eq("user_id", owner.id)
      .select("user_id");
    expect(updated).toEqual([]);
    const { data: deleted } = await other.client
      .from("user_preferences")
      .delete()
      .eq("user_id", owner.id)
      .select("user_id");
    expect(deleted).toEqual([]);

    const stranger = await user();
    const { error: insertError } = await other.client
      .from("user_preferences")
      .insert({ user_id: stranger.id, brands: ["X"] });
    expect(insertError).not.toBeNull();

    const { data: still } = await admin.from("user_preferences").select("brands").eq("user_id", owner.id).single();
    expect(still?.brands).toEqual(["Samsung"]);
  });

  it("rejects more than 20 brands, min > max, negative prices and unknown marketplaces", async () => {
    const u = await user();
    const bad = [
      { brands: Array.from({ length: 21 }, (_, i) => `B${i}`) },
      { excluded_brands: Array.from({ length: 21 }, (_, i) => `B${i}`) },
      { min_price: 500, max_price: 100 },
      { min_price: -1 },
      { marketplaces: ["amazon"] },
    ];
    for (const row of bad) {
      const { error } = await u.client.from("user_preferences").insert({ user_id: u.id, ...row });
      expect(error?.code, JSON.stringify(row)).toBe("23514");
    }
    const { error } = await u.client
      .from("user_preferences")
      .insert({ user_id: u.id, brands: Array.from({ length: 20 }, (_, i) => `B${i}`) });
    expect(error).toBeNull();
  });

  it("is removed with the user", async () => {
    const u = await user();
    await u.client.from("user_preferences").insert({ user_id: u.id, brands: ["Samsung"] });
    await deleteTestUser(u.id);
    const { data } = await admin.from("user_preferences").select("user_id").eq("user_id", u.id);
    expect(data).toEqual([]);
  });
});
