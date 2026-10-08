import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";

const updates: Array<[string, Record<string, unknown>, Record<string, string>]> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      delete: () => {
        const filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => {
            filters[col] = val;
            return chain;
          },
          then: (res: (v: { error: null }) => void) => {
            updates.push([table, { deleted: true }, filters]);
            res({ error: null });
          },
        };
        return chain;
      },
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
  new Request(`https://dealscore.vn/api/unsubscribe?t=${encodeURIComponent(t)}`, {
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

  it("saved search → only that search paused (id + user_id)", async () => {
    const res = await POST(
      req(signUnsubscribeToken({ kind: "saved_search", userId: "u1", savedSearchId: "s1" }, "s"), "text/html") as never,
    );
    expect(res.headers.get("location")).toContain("/unsubscribe?done=saved_search");
    expect(updates).toEqual([["saved_searches", { status: "paused" }, { id: "s1", user_id: "u1" }]]);
  });

  it("demand follow → only that follow deleted (id + user_id)", async () => {
    await POST(req(signUnsubscribeToken({ kind: "demand_follow", userId: "u1", followId: "f1" }, "s")) as never);
    expect(updates).toEqual([["demand_follows", { deleted: true }, { id: "f1", user_id: "u1" }]]);
  });
});
