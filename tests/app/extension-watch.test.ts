import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CONSENT_VERSION } from "@/lib/account/consent";

let sessionUser: { id: string } | null = { id: "u1" };
let profile: { consent_version: string | null; deleted_at: string | null } = { consent_version: CURRENT_CONSENT_VERSION, deleted_at: null };
const client = {
  auth: { getUser: async () => ({ data: { user: sessionUser }, error: null }) },
  from: (table: string) => {
    if (table !== "users") throw new Error(`unexpected table ${table}`);
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) };
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
const saveWatchForUser = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ status: "saved", created: false, variantId: "v1", conditionCount: 1 }));
vi.mock("@/lib/watch/queries", () => ({ saveWatchForUser: (...a: unknown[]) => saveWatchForUser(...a) }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: vi.fn() }));

const { POST } = await import("@/app/api/extension/watch/route");

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
function req() {
  return new Request("https://dealscore.vn/api/extension/watch", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ variantId: "v1", targetPrice: 100000 }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EXTENSION_IDS", "abcdefghijklmnopabcdefghijklmnop");
  sessionUser = { id: "u1" };
  profile = { consent_version: CURRENT_CONSENT_VERSION, deleted_at: null };
});

describe("POST /api/extension/watch (AuthGate)", () => {
  it("signed out → 401", async () => {
    sessionUser = null;
    expect((await POST(req() as never)).status).toBe(401);
    expect(saveWatchForUser).not.toHaveBeenCalled();
  });

  it("missing the current consent → 403 consent_required, nothing written", async () => {
    profile = { consent_version: null, deleted_at: null };
    const res = await POST(req() as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "consent_required" });
    expect(saveWatchForUser).not.toHaveBeenCalled();
  });

  it("pending deletion → 403 pending_deletion, nothing written", async () => {
    profile = { consent_version: CURRENT_CONSENT_VERSION, deleted_at: "2026-10-01T00:00:00Z" };
    const res = await POST(req() as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "pending_deletion" });
    expect(saveWatchForUser).not.toHaveBeenCalled();
  });

  it("gate passed → saves for the session user, CORS headers kept", async () => {
    const res = await POST(req() as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(saveWatchForUser).toHaveBeenCalledWith(client, "u1", expect.any(FormData));
  });
});
