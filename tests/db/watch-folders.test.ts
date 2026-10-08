import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFolderForUser,
  deleteFolderForUser,
  listMyFolders,
  listMyWatches,
  moveWatchForUser,
  renameFolderForUser,
} from "@/lib/watch/queries";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const created: TestUser[] = [];
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

async function user(): Promise<TestUser> {
  const u = await createTestUser();
  created.push(u);
  return u;
}

let variantId = "";
beforeAll(async () => {
  const { data } = await admin.from("variant_current_price").select("variant_id").order("variant_id").limit(1);
  variantId = data![0].variant_id;
});

async function newFolder(u: TestUser, name: string): Promise<string> {
  const r = await createFolderForUser(u.client, u.id, name);
  if (r.status !== "ok" || !r.folder) throw new Error(`createFolder failed: ${JSON.stringify(r)}`);
  return r.folder.id;
}

async function newWatch(u: TestUser): Promise<string> {
  const { data, error } = await u.client
    .from("watches")
    .insert({ user_id: u.id, variant_id: variantId, target_price: 1000 })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

describe("watch_folders RLS", () => {
  it("another user can neither read, rename, delete nor insert for the owner", async () => {
    const owner = await user();
    const other = await user();
    const folderId = await newFolder(owner, "Nhà bếp");

    const { data: seen } = await other.client.from("watch_folders").select("id").eq("id", folderId);
    expect(seen).toEqual([]);

    const { data: renamed } = await other.client.from("watch_folders").update({ name: "Hack" }).eq("id", folderId).select("id");
    expect(renamed).toEqual([]);
    const { data: deleted } = await other.client.from("watch_folders").delete().eq("id", folderId).select("id");
    expect(deleted).toEqual([]);

    const { error: insertError } = await other.client.from("watch_folders").insert({ user_id: owner.id, name: "X" });
    expect(insertError).not.toBeNull();

    // The helpers filter by the caller's id as well.
    expect(await renameFolderForUser(other.client, other.id, folderId, "Hack")).toMatchObject({ status: "error" });
    expect(await deleteFolderForUser(other.client, other.id, folderId)).toMatchObject({ status: "error" });

    const { data: still } = await admin.from("watch_folders").select("name").eq("id", folderId).single();
    expect(still?.name).toBe("Nhà bếp");
  });

  it("the 21st folder is rejected (helper message and raw DB trigger)", async () => {
    const u = await user();
    await admin.from("watch_folders").insert(Array.from({ length: 20 }, (_, i) => ({ user_id: u.id, name: `F${i}`, sort_order: i })));

    const r = await createFolderForUser(u.client, u.id, "Thứ 21");
    expect(r).toEqual({ status: "error", error: expect.stringMatching(/tối đa 20/) });

    const { error } = await u.client.from("watch_folders").insert({ user_id: u.id, name: "Raw 21" });
    expect(error?.code).toBe("23514");
    expect((await listMyFolders(u.id, u.client)).length).toBe(20);
  });

  it("duplicate names are rejected case-insensitively", async () => {
    const u = await user();
    await newFolder(u, "Skincare");
    expect(await createFolderForUser(u.client, u.id, "  SKINCARE ")).toMatchObject({ status: "error" });
    // The unique index catches it even without the pre-check.
    const { error } = await u.client.from("watch_folders").insert({ user_id: u.id, name: "skincare" });
    expect(error?.code).toBe("23505");
  });
});

describe("filing Watches into folders", () => {
  it("filing a Watch into another user's folder is rejected", async () => {
    const owner = await user();
    const other = await user();
    const foreignFolder = await newFolder(other, "Của người khác");
    const watchId = await newWatch(owner);

    const r = await moveWatchForUser(owner.client, owner.id, watchId, foreignFolder);
    expect(r).toEqual({ status: "error", error: expect.any(String) });

    const { error } = await owner.client.from("watches").update({ folder_id: foreignFolder }).eq("id", watchId);
    expect(error).not.toBeNull();

    const { data } = await admin.from("watches").select("folder_id").eq("id", watchId).single();
    expect(data?.folder_id).toBeNull();
  });

  it("another user cannot move the owner's Watch", async () => {
    const owner = await user();
    const other = await user();
    const otherFolder = await newFolder(other, "A");
    const watchId = await newWatch(owner);
    expect(await moveWatchForUser(other.client, other.id, watchId, otherFolder)).toMatchObject({ status: "error" });
  });

  it("move, list with folderId, then deleting the folder unfiles the Watch", async () => {
    const u = await user();
    const folderId = await newFolder(u, "Quà tặng");
    const watchId = await newWatch(u);

    expect(await moveWatchForUser(u.client, u.id, watchId, folderId)).toEqual({ status: "ok" });
    let list = await listMyWatches(u.id, new Date(), u.client);
    expect(list.find((w) => w.id === watchId)?.folderId).toBe(folderId);

    expect(await deleteFolderForUser(u.client, u.id, folderId)).toEqual({ status: "ok" });
    list = await listMyWatches(u.id, new Date(), u.client);
    expect(list.find((w) => w.id === watchId)?.folderId).toBeNull();

    // Moving back to "unfiled" explicitly is allowed.
    expect(await moveWatchForUser(u.client, u.id, watchId, null)).toEqual({ status: "ok" });
  });

  it("rename keeps the id and sort order; new folders go last", async () => {
    const u = await user();
    const a = await newFolder(u, "A");
    await newFolder(u, "B");
    const r = await renameFolderForUser(u.client, u.id, a, "A mới");
    expect(r).toMatchObject({ status: "ok", folder: { id: a, name: "A mới", sortOrder: 0 } });
    expect((await listMyFolders(u.id, u.client)).map((f) => f.name)).toEqual(["A mới", "B"]);
  });
});

describe("notification_settings: weekly digest", () => {
  it("the user can pick weekly_digest and a weekday; out-of-range weekday is rejected", async () => {
    const u = await user();
    const { error } = await u.client
      .from("notification_settings")
      .update({ frequency: "weekly_digest", digest_weekday: 7 })
      .eq("user_id", u.id);
    expect(error).toBeNull();
    const { data } = await admin.from("notification_settings").select("frequency, digest_weekday").eq("user_id", u.id).single();
    expect(data).toEqual({ frequency: "weekly_digest", digest_weekday: 7 });

    const { error: bad } = await u.client.from("notification_settings").update({ digest_weekday: 8 }).eq("user_id", u.id);
    expect(bad?.code).toBe("23514");
  });
});
