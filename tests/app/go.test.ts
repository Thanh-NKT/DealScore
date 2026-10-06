import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseSubId } from "@/lib/affiliate/link";

const OFFER = "0d953a06-9122-4009-b4f5-6babdd060364";
const CLICK = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
let offerRow: Record<string, unknown>;
let clickResult: { data: { id: string } | null; error: { code?: string; message: string } | null };
let rateResult: { data: boolean | null; error: { message: string } | null };
let alertRow: { watch_id: string; offer_id: string } | null;
let watchRow: { user_id: string } | null;
let user: { id: string } | null;
const inserted: Record<string, unknown>[] = [];
const rpc = vi.fn(async () => rateResult);

const row = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    from: (table: string) => {
      if (table === "offers") return row(offerRow);
      if (table === "alert_events") return row(alertRow);
      if (table === "watches") return row(watchRow);
      return {
        insert: (r: Record<string, unknown>) => {
          inserted.push(r);
          return { select: () => ({ single: async () => clickResult }) };
        },
      };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));

const WATCH = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const ALERT = "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b";
const USER = "7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c";

const { GET } = await import("@/app/go/[marketplace]/[offerId]/route");
const call = (qs = "?src=email", cookie?: string) =>
  // NextRequest (not Request): the route reads request.cookies.
  GET(new NextRequest(`https://dealscore.vn/go/shopee/${OFFER}${qs}`, cookie ? { headers: { cookie } } : undefined), {
    params: Promise.resolve({ marketplace: "shopee", offerId: OFFER }),
  });

beforeEach(() => {
  vi.stubEnv("SHOPEE_AFFILIATE_ID", "17300000000");
  vi.stubEnv("AFFILIATE_LINK_MODE", "");
  offerRow = {
    id: OFFER,
    match_status: "auto",
    listings: { url: "https://shopee.vn/product/123/456", marketplace: "shopee", status: "active" },
    affiliate_offers: null,
  };
  clickResult = { data: { id: CLICK }, error: null };
  rateResult = { data: true, error: null };
  alertRow = null;
  watchRow = null;
  user = null;
  inserted.length = 0;
});

describe("GET /go", () => {
  it("normal offer → 302 an_redir, sub_id decodes to the right click + source", async () => {
    const res = await call();
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("s.shopee.vn");
    expect(parseSubId(loc.searchParams.get("sub_id"))).toEqual({ clickId: CLICK, source: "email" });
  });

  it("eligible = false → plain link", async () => {
    offerRow.affiliate_offers = { eligible: false, short_link: null };
    const res = await call();
    expect(res.headers.get("location")).toBe("https://shopee.vn/product/123/456");
  });

  it("missing SHOPEE_AFFILIATE_ID → plain link", async () => {
    vi.stubEnv("SHOPEE_AFFILIATE_ID", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await call();
    expect(res.headers.get("location")).toBe("https://shopee.vn/product/123/456");
  });

  it("click write fails → still 302 an_redir, sub_id carries only the source", async () => {
    clickResult = { data: null, error: { message: "db down" } };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call("?src=push");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("sub_id")).toBe("push");
  });

  it("over the per-IP click limit → still 302, no click row written", async () => {
    rateResult = { data: false, error: null };
    const res = await call("?src=web");
    expect(res.status).toBe(302);
    expect(inserted).toHaveLength(0);
    expect(new URL(res.headers.get("location")!).searchParams.get("sub_id")).toBe("web");
    expect(rpc).toHaveBeenCalledWith("rate_hit", expect.objectContaining({ p_window_seconds: 3600, p_limit: 120 }));
  });

  it("throttle failure never blocks the purchase or the click row", async () => {
    rateResult = { data: null, error: { message: "db down" } };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call()).status).toBe(302);
    expect(inserted).toHaveLength(1);
  });

  it("a session cookie that is not our UUID is replaced", async () => {
    const res = await call("?src=web", `dealscore_sid=${"x".repeat(5000)}`);
    expect(inserted[0].session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("set-cookie")).toContain("dealscore_sid=");
    const ok = "8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d";
    const res2 = await call("?src=web", `dealscore_sid=${ok}`);
    expect(inserted[1].session_id).toBe(ok);
    expect(res2.headers.get("set-cookie")).toBeNull();
  });

  it("an email link keeps watch + alert when the alert is for this offer and that watch", async () => {
    alertRow = { watch_id: WATCH, offer_id: OFFER };
    await call(`?src=email&watch=${WATCH}&alert=${ALERT}`);
    expect(inserted[0]).toMatchObject({ watch_id: WATCH, alert_event_id: ALERT });
  });

  it("drops watch / alert that do not check out", async () => {
    alertRow = { watch_id: WATCH, offer_id: "another-offer" };
    await call(`?src=email&watch=${WATCH}&alert=${ALERT}`);
    expect(inserted[0]).toMatchObject({ watch_id: null, alert_event_id: null });
    // Someone else's watch, signed in.
    user = { id: USER };
    watchRow = { user_id: "someone-else" };
    await call(`?src=web&watch=${WATCH}`);
    expect(inserted[1]).toMatchObject({ watch_id: null });
    // Anonymous with only a watch id.
    user = null;
    await call(`?src=web&watch=${WATCH}`);
    expect(inserted[2]).toMatchObject({ watch_id: null });
  });

  it("keeps the signed-in user's own watch", async () => {
    user = { id: USER };
    watchRow = { user_id: USER };
    await call(`?src=web&watch=${WATCH}`);
    expect(inserted[0]).toMatchObject({ watch_id: WATCH, user_id: USER });
  });

  it("marketplace mismatch → 404", async () => {
    (offerRow.listings as Record<string, string>).marketplace = "lazada";
    expect((await call()).status).toBe(404);
  });
});
