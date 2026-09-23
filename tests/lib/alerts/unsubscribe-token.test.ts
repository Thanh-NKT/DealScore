import { describe, expect, it } from "vitest";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  type UnsubscribeScope,
} from "@/lib/alerts/unsubscribe-token";

describe("signUnsubscribeToken & verifyUnsubscribeToken", () => {
  const secret = "test-super-secret-key-12345";

  it("signs and verifies a watch token", () => {
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

  it("signs and verifies an email token", () => {
    const scope: UnsubscribeScope = {
      kind: "email",
      userId: "u123",
    };

    const token = signUnsubscribeToken(scope, secret);
    const verified = verifyUnsubscribeToken(token, secret);
    expect(verified).toEqual(scope);
  });

  it("returns null for a tampered token or wrong secret", () => {
    const scope: UnsubscribeScope = { kind: "email", userId: "u123" };
    const token = signUnsubscribeToken(scope, secret);

    // Sai secret
    expect(verifyUnsubscribeToken(token, "wrong-secret")).toBe(null);

    // Tampered character
    const tampered = token.slice(0, -3) + "xyz";
    expect(verifyUnsubscribeToken(tampered, secret)).toBe(null);

    // Junk token
    expect(verifyUnsubscribeToken("garbage-token", secret)).toBe(null);
    expect(verifyUnsubscribeToken("", secret)).toBe(null);
  });
});
