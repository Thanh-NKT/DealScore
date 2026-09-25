import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { track } from "@/lib/analytics/track";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser();
});
afterAll(async () => {
  await deleteTestUser(user.id);
});

describe("analytics_events", () => {
  it("track() stores only allow-listed props", async () => {
    await track("product_viewed", { userId: user.id, sessionId: "sid-1", props: { is_draft: true, q: "free text" } });
    const { data } = await admin.from("analytics_events").select("name, props, session_id").eq("user_id", user.id);
    expect(data).toEqual([{ name: "product_viewed", props: { is_draft: true }, session_id: "sid-1" }]);
  });

  it("is not readable with the user's own session (service role only)", async () => {
    const { data, error } = await user.client.from("analytics_events").select("id");
    // Either permission denied, or (if grants ever change) RLS returns nothing — never rows.
    expect(error !== null || data?.length === 0).toBe(true);
  });

  it("rejects unknown event names at the DB level", async () => {
    const { error } = await admin.from("analytics_events").insert({ name: "page_view" as never });
    expect(error).not.toBeNull();
  });
});

describe("metrics_retention_d30", () => {
  it("counts a user active on day 30–36 after signup as retained", async () => {
    const signup = new Date(Date.now() - 45 * 86_400_000);
    await admin.from("users").update({ created_at: signup.toISOString() }).eq("id", user.id);
    await admin.from("analytics_events").insert({
      name: "search_performed",
      user_id: user.id,
      created_at: new Date(signup.getTime() + 31 * 86_400_000).toISOString(),
    });

    const { data, error } = await admin.from("metrics_retention_d30").select("*");
    expect(error).toBeNull();
    const totals = (data ?? []).reduce(
      (acc, r) => ({ size: acc.size + (r.cohort_size ?? 0), kept: acc.kept + (r.retained ?? 0) }),
      { size: 0, kept: 0 },
    );
    expect(totals.size).toBeGreaterThanOrEqual(1);
    expect(totals.kept).toBeGreaterThanOrEqual(1);
  });

  it("events disappear with the user (on delete cascade)", async () => {
    const other = await createTestUser();
    await track("login_succeeded", { userId: other.id });
    await deleteTestUser(other.id);
    const { count } = await admin
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", other.id);
    expect(count).toBe(0);
  });
});

describe("metrics views", () => {
  it("active watches view is readable by the service role", async () => {
    const { data, error } = await admin.from("metrics_active_watches").select("*").single();
    expect(error).toBeNull();
    expect(typeof data!.active_watches).toBe("number");
  });
});
