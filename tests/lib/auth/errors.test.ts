import { describe, expect, it } from "vitest";
import { authErrorFromCode, isValidEmail, mapAuthError, normalizeEmail } from "@/lib/auth/errors";

describe("normalizeEmail / isValidEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  An@Kairo.VN ")).toBe("an@kairo.vn");
  });
  it.each([["an@kairo.vn", true], ["an", false], ["an@", false], ["an@kairo", false], ["a n@kairo.vn", false]])(
    "%s → %s",
    (email, ok) => expect(isValidEmail(email)).toBe(ok),
  );
});

describe("mapAuthError", () => {
  it("invalid email", () => {
    expect(mapAuthError({ code: "email_address_invalid" }).code).toBe("invalid_email");
    expect(mapAuthError({ code: "validation_failed" }).code).toBe("invalid_email");
  });
  it("sending too fast — reads the seconds from the message", () => {
    const e = mapAuthError({
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    expect(e).toMatchObject({ code: "rate_limited", retryAfterSeconds: 42 });
    expect(e.message).toContain("42");
  });
  it("seconds unreadable → 60", () => {
    expect(mapAuthError({ code: "over_request_rate_limit", message: "slow down" }).retryAfterSeconds).toBe(60);
  });
  it("code / link expired", () => {
    expect(mapAuthError({ code: "otp_expired" }, "verify").code).toBe("otp_expired");
  });
  it("wrong code on verification", () => {
    expect(mapAuthError({ code: "invalid_credentials" }, "verify").code).toBe("otp_invalid");
    expect(mapAuthError({ status: 400, message: "Token invalid" }, "verify").code).toBe("otp_invalid");
  });
  it("email send failure", () => {
    expect(mapAuthError({ code: "unexpected_failure", status: 500 }, "send").code).toBe("send_failed");
  });
  it("anything else → internal", () => {
    expect(mapAuthError({ status: 418 }).code).toBe("internal");
  });
});

describe("authErrorFromCode", () => {
  it("known code → message; unknown code → null", () => {
    expect(authErrorFromCode("otp_expired")?.code).toBe("otp_expired");
    expect(authErrorFromCode("<script>")).toBeNull();
    expect(authErrorFromCode(null)).toBeNull();
  });
});
