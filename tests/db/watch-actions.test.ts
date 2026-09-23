import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { listMyWatches, saveWatchForUser } from "@/lib/watch/queries";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

let variantIds: string[] = [];
beforeAll(async () => {
  const { data } = await admin.from("variant_current_price").select("variant_id").eq("in_stock", true).limit(3);
  variantIds = (data ?? []).map((r) => r.variant_id);
});

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("saveWatchForUser", () => {
  it("creates, then a second save updates instead of inserting", async () => {
    const u = await createTestUser();
    created.push(u);
    const r1 = await saveWatchForUser(u.client, u.id, form({ variantId: variantIds[0], targetPrice: "1000" }));
    const r2 = await saveWatchForUser(u.client, u.id, form({ variantId: variantIds[0], targetPrice: "2000" }));
    expect(r1.status).toBe("saved");
    expect(r2.status === "saved" && r1.status === "saved" && r2.watchId === r1.watchId).toBe(true);
    const { data } = await admin.from("watches").select("target_price").eq("user_id", u.id);
    expect(data?.map((w) => Number(w.target_price))).toEqual([2000]);
  });

  it("non-existent variant → variantId error", async () => {
    const u = await createTestUser();
    created.push(u);
    const r = await saveWatchForUser(
      u.client,
      u.id,
      form({ variantId: "00000000-0000-0000-0000-000000000001", targetPrice: "1000" }),
    );
    expect(r).toEqual({ status: "error", errors: { variantId: expect.any(String) } });
  });
});

describe("listMyWatches", () => {
  it("returns a view per Watch, active before paused", async () => {
    const u = await createTestUser();
    created.push(u);
    await saveWatchForUser(u.client, u.id, form({ variantId: variantIds[0], targetPrice: "1000" }));
    await saveWatchForUser(u.client, u.id, form({ variantId: variantIds[1], targetPrice: "1000" }));
    await u.client.from("watches").update({ status: "paused" }).eq("variant_id", variantIds[0]);

    const list = await listMyWatches(u.id, new Date(), u.client);
    expect(list.map((w) => w.status)).toEqual(["active", "paused"]);
    expect(list[0].view.target?.amount).toBe(1000);
    expect(list[0].product.slug).toBeTruthy();
  });
});
