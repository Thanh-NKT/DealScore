import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const { listMyFolders } = await import("@/lib/watch/queries");

/** A client whose watch_folders read succeeds and whose watch_folder_shares read fails. */
function client() {
  const ok = { data: [{ id: "f1", name: "Quà Tết", sort_order: 0 }], error: null };
  const fail = { data: null, error: { message: "boom" } };
  return {
    from: (table: string) => {
      const res = table === "watch_folder_shares" ? fail : ok;
      const chain = { select: () => chain, eq: () => (table === "watch_folder_shares" ? Promise.resolve(res) : chain), order: async () => res };
      return chain;
    },
  };
}

describe("listMyFolders", () => {
  it("m8: a failed shares read degrades to share: null instead of taking the watch page down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const folders = await listMyFolders("u1", client() as never);
    expect(folders.map((f) => [f.id, f.share])).toEqual([["f1", null]]);
  });
});
