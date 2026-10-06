import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  SECURITY_HEADERS,
  THEME_INIT_SCRIPT,
  THEME_INIT_SCRIPT_HASH,
  buildCsp,
  generateNonce,
} from "@/lib/security/headers";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

const base = {
  nonce: "abc123==",
  dev: false,
  supabaseUrl: "https://xyz.supabase.co",
  sentryDsn: "https://key@o1.ingest.sentry.io/42",
  upgradeInsecure: true,
};

describe("security headers", () => {
  it("THEME_INIT_SCRIPT_HASH is the sha256 of the inline theme script", () => {
    const hash = crypto.createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64");
    expect(THEME_INIT_SCRIPT_HASH).toBe(`sha256-${hash}`);
  });

  it("static headers: HSTS, no framing, referrer, nosniff, permissions", () => {
    const h = Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]));
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
    // No CSP here: it comes from the proxy, and a second CSP header would be enforced on top.
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });

  it("CSP: scripts only by nonce / hash, no inline or eval in production, no framing", () => {
    const d = directives(buildCsp(base));
    expect(d.get("script-src")).toEqual(["'self'", "'nonce-abc123=='", `'${THEME_INIT_SCRIPT_HASH}'`, "'strict-dynamic'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("connect-src")).toEqual([
      "'self'",
      "https://xyz.supabase.co",
      "wss://xyz.supabase.co",
      "https://o1.ingest.sentry.io",
    ]);
    expect(d.get("form-action")).toContain("https://xyz.supabase.co");
    expect(d.has("upgrade-insecure-requests")).toBe(true);
    // A nonce in style-src would silently disable 'unsafe-inline' and break style attributes.
    expect(d.get("style-src")?.some((v) => v.startsWith("'nonce-"))).toBe(false);
  });

  it("dev adds unsafe-eval; http and missing env are handled", () => {
    const csp = buildCsp({ nonce: "n", dev: true, upgradeInsecure: false, supabaseUrl: "not a url" });
    const d = directives(csp);
    expect(d.get("script-src")).toContain("'unsafe-eval'");
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.has("upgrade-insecure-requests")).toBe(false);
  });

  it("nonces are random base64", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});
