import { afterEach, describe, expect, it } from "vitest";
import { purgeDeletedAccounts } from "@/lib/account/purge";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

const DAY = 86_400_000;

async function userDeletedDaysAgo(days: number) {
  const u = await createTestUser();
  created.push(u);
  await admin
    .from("users")
    .update({ deleted_at: new Date(Date.now() - days * DAY).toISOString() })
    .eq("id", u.id);
  return u;
}

describe("purgeDeletedAccounts", () => {
  it("hard-deletes users older than 30 days; keeps clicks with null user_id; leaves the 29-day user alone", async () => {
    const old = await userDeletedDaysAgo(31);
    const recent = await userDeletedDaysAgo(29);

    const { data: variant } = await admin.from("product_variants").select("id, product_id").limit(1).single();
    const { data: offer } = await admin.from("offers").select("id").limit(1).single();
    await admin.from("watches").insert({
      user_id: old.id,
      product_id: variant!.product_id,
      variant_id: variant!.id,
      target_price: 1000,
    });
    const { data: click } = await admin
      .from("click_events")
      .insert({ user_id: old.id, offer_id: offer!.id, source: "web" })
      .select("id")
      .single();

    const r1 = await purgeDeletedAccounts({ now: new Date() }, admin);
    expect(r1.failed).toEqual([]);
    expect(r1.purged).toContain(old.id);
    expect(r1.purged).not.toContain(recent.id);

    const { data: users } = await admin.from("users").select("id").in("id", [old.id, recent.id]);
    expect(users?.map((u) => u.id)).toEqual([recent.id]);
    const { count: watchCount } = await admin
      .from("watches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", old.id);
    expect(watchCount).toBe(0);
    const { data: keptClick } = await admin.from("click_events").select("user_id").eq("id", click!.id).single();
    expect(keptClick?.user_id).toBeNull();

    // Second run: nothing of the old user left to delete.
    const r2 = await purgeDeletedAccounts({ now: new Date() }, admin);
    expect(r2.purged).not.toContain(old.id);
  });
});
