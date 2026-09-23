import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  type UnsubscribeScope,
} from "@/lib/alerts/unsubscribe-token";

describe("signUnsubscribeToken & verifyUnsubscribeToken", () => {
  const secret = "test-super-secret-key-12345";

  it("ký và xác thực token watch thành công", () => {
    const scope: UnsubscribeScope = {
      kind: "watch",
      userId: "u123",
      watchId: "w456",
    };

    const token = signUnsubscribeToken(scope, secret);
    expect(typeof token).toBe("string");
    expect(token.startsWith("v1.")).toBe(true);

    const verified = verifyUnsubscribeToken(token, secret);
    expect(verified).toEqual(scope);
  });

  it("ký và xác thực token email thành công", () => {
    const scope: UnsubscribeScope = {
      kind: "email",
      userId: "u123",
    };

    const token = signUnsubscribeToken(scope, secret);
    const verified = verifyUnsubscribeToken(token, secret);
    expect(verified).toEqual(scope);
  });

  it("trả về null khi token bị giả mạo hoặc sai secret", () => {
    const scope: UnsubscribeScope = { kind: "email", userId: "u123" };
    const token = signUnsubscribeToken(scope, secret);

    // Sai secret
    expect(verifyUnsubscribeToken(token, "wrong-secret")).toBe(null);

    // Bị can thiệp ký tự
    const tampered = token.slice(0, -3) + "xyz";
    expect(verifyUnsubscribeToken(tampered, secret)).toBe(null);

    // Token rác
    expect(verifyUnsubscribeToken("garbage-token", secret)).toBe(null);
    expect(verifyUnsubscribeToken("", secret)).toBe(null);
  });
});
