export type AuthErrorCode =
  | "invalid_email"
  | "rate_limited"
  | "otp_invalid"
  | "otp_expired" // code or link expired or already used — Supabase does not distinguish
  | "send_failed"
  | "internal";

export interface AuthErrorInfo {
  code: AuthErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

const MESSAGES: Record<Exclude<AuthErrorCode, "rate_limited">, string> = {
  invalid_email: "Email không hợp lệ.",
  otp_invalid: "Mã không đúng.",
  otp_expired: "Mã hoặc link đã hết hạn hay đã được dùng. Hãy gửi mã mới.",
  send_failed: "Chưa gửi được email. Thử lại sau ít phút.",
  internal: "Có lỗi xảy ra. Vui lòng thử lại.",
};

/** Equal to Supabase Auth's max_frequency. */
const DEFAULT_RETRY_SECONDS = 60;

export function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Format check only — no network call. */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function info(code: Exclude<AuthErrorCode, "rate_limited">): AuthErrorInfo {
  return { code, message: MESSAGES[code] };
}

function rateLimited(message?: string): AuthErrorInfo {
  const m = message?.match(/(\d+)\s*seconds?/i);
  const seconds = m ? Number(m[1]) : DEFAULT_RETRY_SECONDS;
  return {
    code: "rate_limited",
    message: `Vui lòng đợi ${seconds} giây rồi gửi lại.`,
    retryAfterSeconds: seconds,
  };
}

/**
 * `context` separates errors when SENDING a code from errors when VERIFYING one: a 4xx
 * while sending is not "wrong code" — the user has not received any code yet.
 */
export function mapAuthError(
  err: { code?: string; status?: number; message?: string },
  context: "send" | "verify" = "send",
): AuthErrorInfo {
  switch (err.code) {
    case "email_address_invalid":
    case "validation_failed":
      return info("invalid_email");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return rateLimited(err.message);
    case "otp_expired":
      return info("otp_expired");
    case "invalid_credentials":
    case "otp_disabled":
    case "bad_code":
      return info("otp_invalid");
  }

  const status = err.status ?? 0;
  if (status === 429) return rateLimited(err.message);
  if (context === "send" && (err.code === "unexpected_failure" || status >= 500)) return info("send_failed");
  if (context === "verify" && status >= 400 && status < 500) return info("otp_invalid");
  return info("internal");
}

/** For `?error=` in the URL — accepts only known codes, never renders the raw URL string. */
export function authErrorFromCode(code: string | null | undefined): AuthErrorInfo | null {
  if (!code) return null;
  if (code === "rate_limited") return rateLimited();
  if (code in MESSAGES) return info(code as Exclude<AuthErrorCode, "rate_limited">);
  return null;
}
