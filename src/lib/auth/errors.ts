export type AuthErrorCode =
  | "invalid_email"
  | "invalid_credentials" // wrong email or password — never say which one
  | "email_not_confirmed"
  | "weak_password" // rejected by Supabase (server rules drifted from ours)
  | "same_password"
  | "password_mismatch" // the two password fields differ; produced locally only
  | "rate_limited"
  | "link_expired" // email link expired or already used — Supabase does not distinguish
  | "send_failed"
  | "oauth_failed" // Google sign-in did not complete (provider error, expired code)
  | "oauth_cancelled" // the user closed or refused the Google consent screen
  | "internal";

export interface AuthErrorInfo {
  code: AuthErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

type FixedCode = Exclude<AuthErrorCode, "rate_limited">;

export const AUTH_MESSAGES: Record<FixedCode, string> = {
  invalid_email: "Email không hợp lệ.",
  invalid_credentials: "Email hoặc mật khẩu không đúng.",
  email_not_confirmed: "Email này chưa được xác nhận. Mở thư Kairo đã gửi, hoặc gửi lại thư xác nhận.",
  weak_password: "Mật khẩu quá yếu. Hãy dùng ít nhất 8 ký tự, có cả chữ và số.",
  same_password: "Mật khẩu mới phải khác mật khẩu đang dùng.",
  password_mismatch: "Hai mật khẩu chưa khớp nhau.",
  link_expired: "Link đã hết hạn hoặc đã được dùng. Hãy yêu cầu link mới.",
  send_failed: "Chưa gửi được email. Thử lại sau ít phút.",
  oauth_failed: "Chưa đăng nhập được bằng Google. Hãy thử lại, hoặc dùng email và mật khẩu.",
  oauth_cancelled: "Bạn đã hủy đăng nhập bằng Google. Có thể thử lại hoặc dùng email và mật khẩu.",
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

export function authError(code: FixedCode): AuthErrorInfo {
  return { code, message: AUTH_MESSAGES[code] };
}

function rateLimited(message?: string): AuthErrorInfo {
  const m = message?.match(/(\d+)\s*seconds?/i);
  const seconds = m ? Number(m[1]) : DEFAULT_RETRY_SECONDS;
  return {
    code: "rate_limited",
    message: `Vui lòng đợi ${seconds} giây rồi thử lại.`,
    retryAfterSeconds: seconds,
  };
}

export function mapAuthError(err: { code?: string; status?: number; message?: string }): AuthErrorInfo {
  switch (err.code) {
    case "email_address_invalid":
    case "validation_failed":
      return authError("invalid_email");
    case "invalid_credentials":
    case "email_not_confirmed":
    case "weak_password":
    case "same_password":
      return authError(err.code);
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return rateLimited(err.message);
    case "otp_expired":
    case "flow_state_expired":
    case "bad_jwt":
      return authError("link_expired");
  }

  const status = err.status ?? 0;
  if (status === 429) return rateLimited(err.message);
  if (err.code === "unexpected_failure" || status >= 500) return authError("send_failed");
  return authError("internal");
}

/** For `?error=` in the URL — accepts only known codes, never renders the raw URL string. */
export function authErrorFromCode(code: string | null | undefined): AuthErrorInfo | null {
  if (!code) return null;
  if (code === "rate_limited") return rateLimited();
  if (code === "otp_expired") return authError("link_expired"); // links in already-sent emails
  if (Object.hasOwn(AUTH_MESSAGES, code)) return authError(code as FixedCode);
  return null;
}
