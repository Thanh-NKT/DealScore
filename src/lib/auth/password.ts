import { normalizeEmail } from "@/lib/auth/errors";

export const PASSWORD_MIN = 8;
/** bcrypt ignores everything after 72 bytes. */
export const PASSWORD_MAX = 72;

export type PasswordRule = "length" | "letter" | "digit";

export interface PasswordCheck {
  rule: PasswordRule;
  ok: boolean;
  label: string;
}

export type PasswordProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "missing_letter"
  | "missing_digit"
  | "same_as_email";

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  empty: "Nhập mật khẩu.",
  too_short: `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`,
  too_long: `Mật khẩu quá dài (tối đa ${PASSWORD_MAX} ký tự).`,
  missing_letter: "Mật khẩu cần có ít nhất một chữ cái.",
  missing_digit: "Mật khẩu cần có ít nhất một chữ số.",
  same_as_email: "Đừng dùng email làm mật khẩu.",
};

const hasLetter = (p: string) => /\p{L}/u.test(p);
const hasDigit = (p: string) => /\d/.test(p);
const byteLength = (p: string) => new TextEncoder().encode(p).length;

/** Per-rule status, for the live checklist under the password field. */
export function checkPassword(password: string): PasswordCheck[] {
  return [
    { rule: "length", ok: [...password].length >= PASSWORD_MIN, label: `Ít nhất ${PASSWORD_MIN} ký tự` },
    { rule: "letter", ok: hasLetter(password), label: "Có chữ cái" },
    { rule: "digit", ok: hasDigit(password), label: "Có chữ số" },
  ];
}

/** First problem in declaration order, or null when the password is acceptable. Never trims. */
export function passwordProblem(password: string, email?: string): PasswordProblem | null {
  if (!password) return "empty";
  if ([...password].length < PASSWORD_MIN) return "too_short";
  if (byteLength(password) > PASSWORD_MAX) return "too_long";
  if (!hasLetter(password)) return "missing_letter";
  if (!hasDigit(password)) return "missing_digit";
  if (email) {
    const e = normalizeEmail(email);
    const p = password.toLowerCase();
    const local = e.slice(0, e.indexOf("@"));
    if (p === e || (local && p === local)) return "same_as_email";
  }
  return null;
}
