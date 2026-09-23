import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveShopeeRedirect } from "@/lib/shopee/resolve-redirect";

/** Giả lập chuỗi redirect: mỗi URL gọi tới trả về Location kế tiếp (hoặc 200). */
function mockRedirects(chain: Record<string, string | null>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (!(url in chain)) throw new Error(`request ngoài dự kiến: ${url}`);
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

describe("resolveShopeeRedirect", () => {
  it("theo link rút gọn tới trang sản phẩm và dừng ngay khi đọc được", async () => {
    const f = mockRedirects({ "https://shope.ee/abc": PRODUCT });
    await expect(resolveShopeeRedirect("https://shope.ee/abc")).resolves.toEqual({
      ok: true,
      finalUrl: PRODUCT,
    });
    // Không gọi thêm request tới chính trang sản phẩm.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("chặn host lạ ngay từ đầu, không gửi request nào", async () => {
    const f = mockRedirects({});
    await expect(resolveShopeeRedirect("https://evil.com/x")).resolves.toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("chặn shopee.vn.evil.com — so khớp host chính xác", async () => {
    mockRedirects({});
    await expect(resolveShopeeRedirect("https://shopee.vn.evil.com/x")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
  });

  it("chặn subdomain không có trong allowlist", async () => {
    mockRedirects({});
    await expect(resolveShopeeRedirect("https://internal.shopee.vn/x")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
  });

  it("chặn ở hop thứ 2 khi redirect trỏ ra ngoài allowlist", async () => {
    const f = mockRedirects({ "https://shope.ee/abc": "https://169.254.169.254/latest" });
    await expect(resolveShopeeRedirect("https://shope.ee/abc")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("chặn http://", async () => {
    mockRedirects({ "https://shope.ee/abc": "http://shopee.vn/product/1/2" });
    await expect(resolveShopeeRedirect("https://shope.ee/abc")).resolves.toMatchObject({
      reason: "insecure",
    });
  });

  it("chặn cổng khác mặc định", async () => {
    mockRedirects({});
    await expect(resolveShopeeRedirect("https://shope.ee:8443/abc")).resolves.toMatchObject({
      reason: "host_not_allowed",
    });
  });

  it("quá 3 hop thì dừng", async () => {
    mockRedirects({
      "https://shope.ee/1": "https://shope.ee/2",
      "https://shope.ee/2": "https://shope.ee/3",
      "https://shope.ee/3": "https://shope.ee/4",
      "https://shope.ee/4": PRODUCT,
    });
    await expect(resolveShopeeRedirect("https://shope.ee/1")).resolves.toMatchObject({
      reason: "too_many_hops",
    });
  });

  it("đúng 3 hop vẫn tới đích", async () => {
    mockRedirects({
      "https://shope.ee/1": "https://shope.ee/2",
      "https://shope.ee/2": "https://s.shopee.vn/3",
      "https://s.shopee.vn/3": PRODUCT,
    });
    await expect(resolveShopeeRedirect("https://shope.ee/1")).resolves.toEqual({
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
    await expect(resolveShopeeRedirect("https://shope.ee/abc")).resolves.toMatchObject({
      reason: "timeout",
    });
  });
});
