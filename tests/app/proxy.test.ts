import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// The session refresh is not under test: forward the request headers like updateSession does.
const seen: Headers[] = [];
vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: async (request: NextRequest) => {
    seen.push(new Headers(request.headers));
    return NextResponse.next({ request });
  },
}));

const { proxy } = await import("@/proxy");

describe("proxy CSP", () => {
  it("a page gets a fresh nonce CSP on the response and on the request Next renders with", async () => {
    const r1 = await proxy(new NextRequest("http://localhost/ssd/samsung-990"));
    const r2 = await proxy(new NextRequest("http://localhost/login"));
    const csp1 = r1.headers.get("content-security-policy")!;
    const csp2 = r2.headers.get("content-security-policy")!;
    expect(csp1).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp1).toContain("frame-ancestors 'none'");
    expect(seen.at(-2)!.get("content-security-policy")).toBe(csp1);
    const nonce = (csp: string) => csp.match(/'nonce-([^']+)'/)![1];
    expect(nonce(csp1)).not.toBe(nonce(csp2));
  });

  it("API routes (extension, JSON) get no CSP", async () => {
    const r = await proxy(new NextRequest("http://localhost/api/extension/product?url=x"));
    expect(r.headers.get("content-security-policy")).toBeNull();
    expect(seen.at(-1)!.get("content-security-policy")).toBeNull();
  });
});
