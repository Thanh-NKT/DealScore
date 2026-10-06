import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "session-user", email: "an@dealscore.vn", consentVersion: "x", marketingOptIn: false, deletedAt: null };
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(async () => user) }));

const client = { tag: "server-client" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));

const core = {
  createFolderForUser: vi.fn(async () => ({ status: "ok" as const, folder: { id: "f", name: "A", sortOrder: 0 } })),
  renameFolderForUser: vi.fn(async () => ({ status: "ok" as const })),
  deleteFolderForUser: vi.fn(async () => ({ status: "ok" as const })),
  moveWatchForUser: vi.fn(async () => ({ status: "error" as const, error: "Không tìm thấy thư mục này." })),
};
vi.mock("@/lib/watch/queries", () => ({ ...core, saveWatchForUser: vi.fn() }));

const actions = await import("@/actions/watch");

const FOLDER = "11111111-1111-4111-8111-111111111111";
const WATCH = "22222222-2222-4222-8222-222222222222";

beforeEach(() => vi.clearAllMocks());

describe("folder actions", () => {
  it("createFolder: identity comes from the session, then revalidates the Watch page", async () => {
    const r = await actions.createFolder("Nhà bếp");
    expect(r.status).toBe("ok");
    expect(core.createFolderForUser).toHaveBeenCalledWith(client, "session-user", "Nhà bếp");
    expect(revalidatePath).toHaveBeenCalledWith("/account/watch");
  });

  it("renameFolder / deleteFolder pass the session user id, never a caller-supplied one", async () => {
    await actions.renameFolder(FOLDER, "Mới");
    await actions.deleteFolder(FOLDER);
    expect(core.renameFolderForUser).toHaveBeenCalledWith(client, "session-user", FOLDER, "Mới");
    expect(core.deleteFolderForUser).toHaveBeenCalledWith(client, "session-user", FOLDER);
  });

  it("moveWatchToFolder: an error is returned as is and nothing is revalidated", async () => {
    const r = await actions.moveWatchToFolder(WATCH, FOLDER);
    expect(r).toEqual({ status: "error", error: expect.stringMatching(/thư mục/) });
    expect(core.moveWatchForUser).toHaveBeenCalledWith(client, "session-user", WATCH, FOLDER);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("non-string ids are rejected before touching the DB", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await actions.moveWatchToFolder({ id: WATCH } as any, null);
    expect(r.status).toBe("error");
    expect(core.moveWatchForUser).not.toHaveBeenCalled();
  });
});
