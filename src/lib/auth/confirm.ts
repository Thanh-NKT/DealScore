import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Email links (sign-up confirmation, password reset) land on /auth/confirm. The one-time token is
 * only used by a POST (the "Xác nhận" button): mailbox link scanners (Outlook SafeLinks, …) open
 * links with GET and would otherwise burn the token before the person clicks.
 */
export const CONFIRM_TYPES: EmailOtpType[] = ["email", "signup", "recovery"];

export interface ConfirmParams {
  tokenHash: string;
  type: EmailOtpType;
  next: string;
}

export function parseConfirmParams(raw: {
  token_hash?: string | null;
  type?: string | null;
  next?: string | null;
}): { ok: true; params: ConfirmParams } | { ok: false; type: EmailOtpType | null; next: string } {
  const next = safeNextPath(raw.next ?? null, "/");
  const type = CONFIRM_TYPES.includes(raw.type as EmailOtpType) ? (raw.type as EmailOtpType) : null;
  const tokenHash = typeof raw.token_hash === "string" ? raw.token_hash.trim() : "";
  // Supabase token hashes are short hex strings; anything else is a broken link.
  if (!type || !tokenHash || tokenHash.length > 200) return { ok: false, type, next };
  return { ok: true, params: { tokenHash, type, next } };
}

/** Where to send the user when the link fails: a fresh reset request, or the login page. */
export function confirmFailureUrl(type: EmailOtpType | null, code: string, next: string): string {
  if (type === "recovery") return `/forgot-password?error=${encodeURIComponent(code)}`;
  return `/login?error=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`;
}
