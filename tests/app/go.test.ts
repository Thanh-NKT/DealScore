import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseSubId } from "@/lib/affiliate/link";

const OFFER = "0d953a06-9122-4009-b4f5-6babdd060364";
const CLICK = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
let offerRow: Record<string, unknown>;
let clickResult: { data: { id: string } | null; error: { code?: string; message: string } | null };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "offers"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: offerRow, error: null }) }) }) }
        : { insert: () => ({ select: () => ({ single: async () => clickResult }) }) },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const { GET } = await import("@/app/go/[marketplace]/[offerId]/route");
const call = (qs = "?src=email") =>
  // NextRequest (not Request): the route reads request.cookies.
  GET(new NextRequest(`https://kairo.vn/go/shopee/${OFFER}${qs}`), {
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

  it("marketplace mismatch → 404", async () => {
    (offerRow.listings as Record<string, string>).marketplace = "lazada";
    expect((await call()).status).toBe(404);
  });
});
