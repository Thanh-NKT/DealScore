import { describe, expect, it } from "vitest";
import { authErrorFromCode, isValidEmail, mapAuthError, normalizeEmail } from "@/lib/auth/errors";

describe("normalizeEmail / isValidEmail", () => {
  it("trim và lowercase", () => {
    expect(normalizeEmail("  An@Kairo.VN ")).toBe("an@kairo.vn");
  });
  it.each([["an@kairo.vn", true], ["an", false], ["an@", false], ["an@kairo", false], ["a n@kairo.vn", false]])(
    "%s → %s",
    (email, ok) => expect(isValidEmail(email)).toBe(ok),
  );
});

describe("mapAuthError", () => {
  it("email không hợp lệ", () => {
    expect(mapAuthError({ code: "email_address_invalid" }).code).toBe("invalid_email");
    expect(mapAuthError({ code: "validation_failed" }).code).toBe("invalid_email");
  });
  it("gửi quá nhanh — đọc số giây từ message", () => {
    const e = mapAuthError({
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    expect(e).toMatchObject({ code: "rate_limited", retryAfterSeconds: 42 });
    expect(e.message).toContain("42");
  });
  it("không đọc được số giây → 60", () => {
    expect(mapAuthError({ code: "over_request_rate_limit", message: "slow down" }).retryAfterSeconds).toBe(60);
  });
  it("mã / link hết hạn", () => {
    expect(mapAuthError({ code: "otp_expired" }, "verify").code).toBe("otp_expired");
  });
  it("mã sai khi xác thực", () => {
    expect(mapAuthError({ code: "invalid_credentials" }, "verify").code).toBe("otp_invalid");
    expect(mapAuthError({ status: 400, message: "Token invalid" }, "verify").code).toBe("otp_invalid");
  });
  it("lỗi gửi email", () => {
    expect(mapAuthError({ code: "unexpected_failure", status: 500 }, "send").code).toBe("send_failed");
  });
  it("còn lại → internal", () => {
    expect(mapAuthError({ status: 418 }).code).toBe("internal");
  });
});

describe("authErrorFromCode", () => {
  it("mã hợp lệ → thông điệp; mã lạ → null", () => {
    expect(authErrorFromCode("otp_expired")?.code).toBe("otp_expired");
    expect(authErrorFromCode("<script>")).toBeNull();
    expect(authErrorFromCode(null)).toBeNull();
  });
});
