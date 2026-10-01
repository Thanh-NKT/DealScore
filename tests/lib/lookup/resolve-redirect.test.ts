import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProductRedirect } from "@/lib/lookup/resolve-redirect";

/** Simulated redirect chain: each requested URL returns the next Location (or 200). */
function mockRedirects(chain: Record<string, string | null>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (!(url in chain)) throw new Error(`unexpected request: ${url}`);
    const next = chain[url];
    return next
      ? new Response(null, { status: 302, headers: { location: next } })
      : new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PRODUCT = "https://shopee.vn/product/123456/789012";

describe("resolveProductRedirect", () => {
  it("follows the short link to the product page and stops as soon as it's readable", async () => {
    const f = mockRedirects({ "https://shope.ee/abc": PRODUCT });
    await expect(resolveProductRedirect("https://shope.ee/abc")).resolves.toEqual({
      ok: true,
      finalUrl: PRODUCT,
    });
    // No extra request to the product page itself.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("blocks unknown hosts from the start, sends no request", async () => {
    const f = mockRedirects({});
    await expect(resolveProductRedirect("https://evil.com/x")).resolves.toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("blocks shopee.vn.evil.com — exact host matching", async () => {
    mockRedirects({});
    await expect(resolveProductRedirect("https://shopee.vn.evil.com/x")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
  });

  it("blocks subdomains not in the allowlist", async () => {
    mockRedirects({});
    await expect(resolveProductRedirect("https://internal.shopee.vn/x")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
  });

  it("blocks at hop 2 when the redirect points outside the allowlist", async () => {
    const f = mockRedirects({ "https://shope.ee/abc": "https://169.254.169.254/latest" });
    await expect(resolveProductRedirect("https://shope.ee/abc")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("blocks http://", async () => {
    mockRedirects({ "https://shope.ee/abc": "http://shopee.vn/product/1/2" });
    await expect(resolveProductRedirect("https://shope.ee/abc")).resolves.toMatchObject({
      reason: "insecure",
    });
  });

  it("blocks non-default ports", async () => {
    mockRedirects({});
    await expect(resolveProductRedirect("https://shope.ee:8443/abc")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
  });

  it("stops after more than 3 hops", async () => {
    mockRedirects({
      "https://shope.ee/1": "https://shope.ee/2",
      "https://shope.ee/2": "https://shope.ee/3",
      "https://shope.ee/3": "https://shope.ee/4",
      "https://shope.ee/4": PRODUCT,
    });
    await expect(resolveProductRedirect("https://shope.ee/1")).resolves.toMatchObject({
      reason: "too_many_hops",
    });
  });

  it("exactly 3 hops still reaches the target", async () => {
    mockRedirects({
      "https://shope.ee/1": "https://shope.ee/2",
      "https://shope.ee/2": "https://s.shopee.vn/3",
      "https://s.shopee.vn/3": PRODUCT,
    });
    await expect(resolveProductRedirect("https://shope.ee/1")).resolves.toEqual({
      ok: true,
      finalUrl: PRODUCT,
    });
  });

  it("timeout → reason 'timeout'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    await expect(resolveProductRedirect("https://shope.ee/abc")).resolves.toMatchObject({
      reason: "timeout",
    });
  });

  it("follows a TikTok short link to the product page", async () => {
    const product = "https://www.tiktok.com/view/product/1729384756";
    const f = mockRedirects({ "https://vt.tiktok.com/ZSabc/": product });
    await expect(resolveProductRedirect("https://vt.tiktok.com/ZSabc/")).resolves.toEqual({ ok: true, finalUrl: product });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a TikTok short link may not redirect to an unknown host", async () => {
    mockRedirects({ "https://vt.tiktok.com/x/": "https://evil.com/steal" });
    await expect(resolveProductRedirect("https://vt.tiktok.com/x/")).resolves.toEqual({ ok: false, reason: "host_not_allowed" });
  });
});
