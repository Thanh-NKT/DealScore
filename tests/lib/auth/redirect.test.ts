import { describe, expect, it } from "vitest";
import { CURRENT_CONSENT_VERSION, needsConsent } from "@/lib/account/consent";
import { decideAuthGate, safeNextPath } from "@/lib/auth/redirect";

describe("needsConsent", () => {
  it("null and old versions need consent again", () => {
    expect(needsConsent(null)).toBe(true);
    expect(needsConsent("2020-01-01")).toBe(true);
  });
  it("the current version does not", () => {
    expect(needsConsent(CURRENT_CONSENT_VERSION)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps internal paths with query and hash", () => {
    expect(safeNextPath("/ssd/samsung-990?variant=1#gia")).toBe("/ssd/samsung-990?variant=1#gia");
  });
  it.each([
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["javascript:alert(1)"],
    [""],
    ["ssd"],
    ["/abc\u0000def"],
    ["/register"],
    ["/forgot-password"],
    ["/reset-password?x=1"],
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });
  it("null / undefined → fallback", () => {
    expect(safeNextPath(null, "/account")).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/");
  });
  it("never returns into the login flow itself", () => {
    expect(safeNextPath("/login?next=/x")).toBe("/");
    expect(safeNextPath("/auth/confirm?token_hash=1")).toBe("/");
  });
  it.each([
    ["/.//evil.com"],
    ["/..//evil.com"],
    ["/a/..//evil.com"],
    ["/%2e//evil.com"],
    ["/%2e%2e//evil.com"],
    ["/%2E/%2E%2E//evil.com"],
    ["/.\\\\evil.com"],
    ["/..\\\\evil.com"],
    ["/a/..\\\\evil.com"],
    ["/%2e\\\\evil.com"],
    ["/./\\evil.com"],
    ["/.\\/evil.com"],
    ["/%2e/\\evil.com"],
  ])("rejects %j, whose dot segments normalize to a protocol-relative URL", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });
  it("keeps harmless dot segments, normalized", () => {
    expect(safeNextPath("/a/../ssd")).toBe("/ssd");
    expect(safeNextPath("/./account")).toBe("/account");
  });

  // Seeded pseudo-random fuzz (no extra dependency): the output is always a
  // same-origin path, never protocol-relative, and the function is idempotent.
  it("output never starts with // or /\\ and safeNextPath is idempotent (fuzz)", () => {
    const parts = ["/", "\\", ".", "..", "%2e", "%2E", "%2f", "%5c", "a", "evil.com", "?", "#", "@", ":", " ", "%", "login", "auth/"];
    let seed = 0x2545f491;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    for (let i = 0; i < 5000; i++) {
      const len = 1 + Math.floor(rand() * 8);
      let raw = rand() < 0.9 ? "/" : "";
      for (let j = 0; j < len; j++) raw += parts[Math.floor(rand() * parts.length)];
      const once = safeNextPath(raw);
      expect(once.startsWith("/"), raw).toBe(true);
      expect(once.startsWith("//"), raw).toBe(false);
      expect(once.startsWith("/\\"), raw).toBe(false);
      expect(safeNextPath(once), raw).toBe(once);
    }
  });
});

describe("decideAuthGate", () => {
  const ok = { consentVersion: CURRENT_CONSENT_VERSION, deletedAt: null };

  it("signed out → login with next", () => {
    expect(decideAuthGate({ userId: null, profile: null, path: "/account/notifications" })).toEqual({
      kind: "login",
      to: "/login?next=%2Faccount%2Fnotifications",
    });
  });
  it("signed in but missing profile → throws", () => {
    expect(() => decideAuthGate({ userId: "u", profile: null, path: "/" })).toThrow();
  });
  it("pending deletion takes precedence over missing consent", () => {
    const g = decideAuthGate({ userId: "u", profile: { consentVersion: null, deletedAt: "2026-09-01" }, path: "/" });
    expect(g).toEqual({ kind: "restore", to: "/account/restore" });
  });
  it("allowPendingDeletion skips the pending-deletion gate", () => {
    const g = decideAuthGate({
      userId: "u",
      profile: { ...ok, deletedAt: "2026-09-01" },
      path: "/",
      allowPendingDeletion: true,
    });
    expect(g).toEqual({ kind: "ok" });
  });
  it("no consent → consent with next", () => {
    const g = decideAuthGate({ userId: "u", profile: { consentVersion: null, deletedAt: null }, path: "/x" });
    expect(g).toEqual({ kind: "consent", to: "/account/consent?next=%2Fx" });
  });
  it("allowMissingConsent skips the consent gate", () => {
    const g = decideAuthGate({
      userId: "u",
      profile: { consentVersion: null, deletedAt: null },
      path: "/x",
      allowMissingConsent: true,
    });
    expect(g).toEqual({ kind: "ok" });
  });
  it("all checks pass → ok", () => {
    expect(decideAuthGate({ userId: "u", profile: ok, path: "/" })).toEqual({ kind: "ok" });
  });
});
