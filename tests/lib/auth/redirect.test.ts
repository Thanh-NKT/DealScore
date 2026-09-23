import { describe, expect, it } from "vitest";
import { CURRENT_CONSENT_VERSION, needsConsent } from "@/lib/consent";
import { decideAuthGate, safeNextPath } from "@/lib/auth/redirect";

describe("needsConsent", () => {
  it("null và phiên bản cũ cần đồng ý lại", () => {
    expect(needsConsent(null)).toBe(true);
    expect(needsConsent("2020-01-01")).toBe(true);
  });
  it("đúng phiên bản hiện hành thì không", () => {
    expect(needsConsent(CURRENT_CONSENT_VERSION)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("giữ nguyên đường dẫn nội bộ kèm query và hash", () => {
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
  ])("từ chối %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });
  it("null / undefined → fallback", () => {
    expect(safeNextPath(null, "/tai-khoan")).toBe("/tai-khoan");
    expect(safeNextPath(undefined)).toBe("/");
  });
  it("không quay về chính luồng đăng nhập", () => {
    expect(safeNextPath("/dang-nhap?next=/x")).toBe("/");
    expect(safeNextPath("/auth/xac-nhan?token_hash=1")).toBe("/");
  });
});

describe("decideAuthGate", () => {
  const ok = { consentVersion: CURRENT_CONSENT_VERSION, deletedAt: null };

  it("chưa đăng nhập → login kèm next", () => {
    expect(decideAuthGate({ userId: null, profile: null, path: "/tai-khoan/thong-bao" })).toEqual({
      kind: "login",
      to: "/dang-nhap?next=%2Ftai-khoan%2Fthong-bao",
    });
  });
  it("đăng nhập mà thiếu hồ sơ → ném", () => {
    expect(() => decideAuthGate({ userId: "u", profile: null, path: "/" })).toThrow();
  });
  it("chờ xóa đi trước chưa đồng ý", () => {
    const g = decideAuthGate({ userId: "u", profile: { consentVersion: null, deletedAt: "2026-09-01" }, path: "/" });
    expect(g).toEqual({ kind: "restore", to: "/tai-khoan/khoi-phuc" });
  });
  it("allowPendingDeletion bỏ qua trạng thái chờ xóa", () => {
    const g = decideAuthGate({
      userId: "u",
      profile: { ...ok, deletedAt: "2026-09-01" },
      path: "/",
      allowPendingDeletion: true,
    });
    expect(g).toEqual({ kind: "ok" });
  });
  it("chưa đồng ý → consent kèm next", () => {
    const g = decideAuthGate({ userId: "u", profile: { consentVersion: null, deletedAt: null }, path: "/x" });
    expect(g).toEqual({ kind: "consent", to: "/tai-khoan/dong-y?next=%2Fx" });
  });
  it("allowMissingConsent bỏ qua cổng đồng ý", () => {
    const g = decideAuthGate({
      userId: "u",
      profile: { consentVersion: null, deletedAt: null },
      path: "/x",
      allowMissingConsent: true,
    });
    expect(g).toEqual({ kind: "ok" });
  });
  it("đủ điều kiện → ok", () => {
    expect(decideAuthGate({ userId: "u", profile: ok, path: "/" })).toEqual({ kind: "ok" });
  });
});
