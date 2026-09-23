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
