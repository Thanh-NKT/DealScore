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
  it.each(["invalid_credentials", "email_not_confirmed", "weak_password", "same_password"])("%s passes through", (code) => {
    expect(mapAuthError({ code, status: 400 }).code).toBe(code);
  });
  it("wrong credentials never say which field is wrong", () => {
    expect(mapAuthError({ code: "invalid_credentials" }).message).toBe("Email hoặc mật khẩu không đúng.");
  });
  it("rate limit — reads the seconds from the message", () => {
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
  it.each(["otp_expired", "flow_state_expired", "bad_jwt"])("%s → link_expired", (code) => {
    expect(mapAuthError({ code }).code).toBe("link_expired");
  });
  it("email send failure", () => {
    expect(mapAuthError({ code: "unexpected_failure", status: 500 }).code).toBe("send_failed");
  });
  it("anything else → internal", () => {
    expect(mapAuthError({ status: 418 }).code).toBe("internal");
  });
});

describe("authErrorFromCode", () => {
  it("known code → message; unknown code → null", () => {
    expect(authErrorFromCode("link_expired")?.code).toBe("link_expired");
    expect(authErrorFromCode("<script>")).toBeNull();
    expect(authErrorFromCode("toString")).toBeNull();
    expect(authErrorFromCode(null)).toBeNull();
  });
  it("legacy otp_expired from already-sent emails → link_expired", () => {
    expect(authErrorFromCode("otp_expired")?.code).toBe("link_expired");
  });
});
