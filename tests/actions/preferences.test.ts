import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CONSENT_VERSION } from "@/lib/account/consent";

// Fake RLS client: records what the action writes.
const upsert = vi.fn<(row: unknown, opts?: unknown) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }));
let sessionUser: { id: string } | null = { id: "session-user" };
let profile: { consent_version: string | null; deleted_at: string | null } = { consent_version: CURRENT_CONSENT_VERSION, deleted_at: null };
const client = {
  auth: { getUser: vi.fn(async () => ({ data: { user: sessionUser }, error: null })) },
  from: vi.fn((table: string) => {
    if (table === "users") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) };
    if (table !== "user_preferences") throw new Error(`unexpected table ${table}`);
    return { upsert };
  }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
const trackAfter = vi.fn();
vi.mock("@/lib/analytics/track", () => ({ trackAfter: (...args: unknown[]) => trackAfter(...args) }));

const { savePreferences } = await import("@/actions/preferences");

const CAT = "11111111-1111-4111-8111-111111111111";
const IDLE = { status: "idle" } as const;

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = { id: "session-user" };
  profile = { consent_version: CURRENT_CONSENT_VERSION, deleted_at: null };
  upsert.mockImplementation(async () => ({ error: null }));
});

describe("savePreferences", () => {
  it("signed out → error, nothing written", async () => {
    sessionUser = null;
    const r = await savePreferences(IDLE, form([["brands", "WD"]]));
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.errors.form).toMatch(/đăng nhập/);
    expect(upsert).not.toHaveBeenCalled();
    expect(trackAfter).not.toHaveBeenCalled();
  });

  it("missing the current consent, or pending deletion → error, nothing written (AuthGate)", async () => {
    profile = { consent_version: null, deleted_at: null };
    const r1 = await savePreferences(IDLE, form([["brands", "WD"]]));
    expect(r1.status === "error" && r1.errors.form).toMatch(/điều khoản/);
    profile = { consent_version: CURRENT_CONSENT_VERSION, deleted_at: "2026-10-01T00:00:00Z" };
    const r2 = await savePreferences(IDLE, form([["brands", "WD"]]));
    expect(r2.status === "error" && r2.errors.form).toMatch(/chờ xóa/);
    expect(upsert).not.toHaveBeenCalled();
    expect(trackAfter).not.toHaveBeenCalled();
  });

  it("upserts the normalized preferences under the session user id, never a form-supplied one", async () => {
    const r = await savePreferences(
      IDLE,
      form([
        ["userId", "attacker"],
        ["user_id", "attacker"],
        ["brands", " Samsung "],
        ["brands", "samsung"],
        ["categoryIds", CAT],
        ["minPrice", "3tr"],
        ["maxPrice", "1tr"],
        ["marketplaces", "tiktok"],
        ["marketplaces", "lazada"],
        ["marketplaces", "amazon"],
      ]),
    );
    expect(r).toEqual({ status: "saved" });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toEqual({
      user_id: "session-user",
      brands: ["Samsung"],
      category_ids: [CAT],
      min_price: 1_000_000,
      max_price: 3_000_000,
      marketplaces: ["tiktok"],
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    // excluded_brands is not on the form: the stored value must be left alone.
    expect(row).not.toHaveProperty("excluded_brands");
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(revalidatePath).toHaveBeenCalledWith("/account/preferences");
  });

  it("tracks preferences_saved with counts only", async () => {
    await savePreferences(IDLE, form([["brands", "WD"], ["brands", "Samsung"], ["maxPrice", "2tr"]]));
    expect(trackAfter).toHaveBeenCalledWith("preferences_saved", {
      userId: "session-user",
      props: { brands: 2, categories: 0, has_price: true, marketplaces: 0 },
    });
  });

  it("an unreadable price → field error, nothing written", async () => {
    const r = await savePreferences(IDLE, form([["minPrice", "abc"]]));
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.errors.minPrice).toBeTruthy();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("a DB error → Vietnamese form error, not tracked", async () => {
    upsert.mockImplementation(async () => ({ error: { message: "boom" } }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await savePreferences(IDLE, form([["brands", "WD"]]));
    spy.mockRestore();
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.errors.form).toMatch(/Chưa lưu được/);
    expect(trackAfter).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
