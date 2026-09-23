import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";

const updates: Array<[string, Record<string, unknown>, Record<string, string>]> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => {
            filters[col] = val;
            return chain;
          },
          then: (res: (v: { error: null }) => void) => {
            updates.push([table, values, filters]);
            res({ error: null });
          },
        };
        return chain;
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/unsubscribe/route");

beforeEach(() => {
  updates.length = 0;
  vi.stubEnv("UNSUBSCRIBE_SECRET", "s");
});

const req = (t: string, accept = "*/*") =>
  new Request(`https://kairo.vn/api/unsubscribe?t=${encodeURIComponent(t)}`, {
    method: "POST",
    headers: { accept, "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });

describe("POST /api/unsubscribe", () => {
  it("bad token → 400, nothing written", async () => {
    const res = await POST(req("rac") as never);
    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });

  it("email → disables email_enabled for the right user; One-Click returns 200", async () => {
    const res = await POST(req(signUnsubscribeToken({ kind: "email", userId: "u1" }, "s")) as never);
    expect(res.status).toBe(200);
    expect(updates).toEqual([["notification_settings", { email_enabled: false }, { user_id: "u1" }]]);
  });

  it("watch → paused by both id and user_id; HTML form → redirect", async () => {
    const res = await POST(
      req(signUnsubscribeToken({ kind: "watch", userId: "u1", watchId: "w1" }, "s"), "text/html") as never,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/unsubscribe?done=watch");
    expect(updates).toEqual([["watches", { status: "paused" }, { id: "w1", user_id: "u1" }]]);
  });
});
