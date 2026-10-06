import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, ipSaltConfigured, networkPrefix, rateKeyHash } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import type { AuthErrorInfo } from "@/lib/auth/errors";

/**
 * App-level throttle in front of every Supabase Auth call.
 *
 * Every auth call is made by the Next server, so Supabase Auth's own per-IP limits count the
 * server's egress IP, not the user: one script could drain that shared bucket for everyone.
 * This limiter counts per hashed client IP AND per normalized email + client network (fixed windows
 * in `rate_counters`, via `rate_hit`). Supabase's limits stay in place behind it.
 *
 * Why email + network, not the email alone: an email-only bucket is a lockout tool — anyone could
 * spend a victim's 10 sign-in (or 3 reset) attempts from anywhere and block the real user. Keyed on
 * (email, IPv4 /24 or IPv6 /64), attempts from other networks never touch the bucket of the user's
 * own network; a correct password from a new network works unless that network's IP bucket is spent.
 * Trade-off: a brute force spread over many networks is no longer capped per account here — each
 * network still gets only perEmail tries per account and perIp tries overall, the password rules
 * (src/lib/auth/password.ts) and Supabase's own limits still apply.
 *
 * Keys are hashed with rateKeyHash(), which never throws: a missing LOOKUP_IP_SALT in production is
 * reported on every attempt (configuration error) but the throttle keeps counting.
 */
export type AuthAction = "sign_in" | "sign_up" | "resend" | "reset" | "update_password";

interface Limit {
  windowSeconds: number;
  /** Per hashed client IP. */
  perIp: number;
  /** Per normalized email (or the signed-in user's email for update_password) AND client network. */
  perEmail: number;
}

export const AUTH_LIMITS: Record<AuthAction, Limit> = {
  // Brute force on one account is bounded by perEmail; a shared office NAT still has room.
  sign_in: { windowSeconds: 15 * 60, perIp: 30, perEmail: 10 },
  // Each of these sends an email.
  sign_up: { windowSeconds: 60 * 60, perIp: 10, perEmail: 3 },
  resend: { windowSeconds: 60 * 60, perIp: 10, perEmail: 3 },
  reset: { windowSeconds: 60 * 60, perIp: 10, perEmail: 3 },
  update_password: { windowSeconds: 60 * 60, perIp: 10, perEmail: 5 },
};

/** The same answer whether or not the email has an account (no enumeration). */
export function authThrottled(windowSeconds: number): AuthErrorInfo {
  const minutes = Math.max(1, Math.ceil(windowSeconds / 60));
  return {
    code: "rate_limited",
    message: `Bạn đã thử quá nhiều lần. Đợi khoảng ${minutes} phút rồi thử lại.`,
    retryAfterSeconds: windowSeconds,
  };
}

/**
 * Count one attempt of `action`. Returns an error to show, or null when the attempt may go on.
 *
 * A throttle failure (DB error) lets the attempt through and is reported: Supabase's own limits
 * still apply behind it, and locking every user out of login on a counter glitch is worse. A missing
 * salt is not such a failure: it is reported and the attempt is still counted.
 */
export async function throttleAuth(
  action: AuthAction,
  input: { email: string; headers: Headers },
): Promise<AuthErrorInfo | null> {
  const limit = AUTH_LIMITS[action];
  if (!ipSaltConfigured()) {
    reportError(new Error("Missing LOOKUP_IP_SALT: auth throttle keys use the public dev salt"), { where: "auth_throttle_config", action });
  }
  try {
    const supabase = createAdminClient();
    const ip = clientIp(input.headers);
    const keys: [string, number][] = [[`auth:${action}:ip:${rateKeyHash(ip)}`, limit.perIp]];
    if (input.email) {
      keys.push([`auth:${action}:email:${rateKeyHash(`email:${input.email}|net:${networkPrefix(ip)}`)}`, limit.perEmail]);
    }

    const results = await Promise.all(
      keys.map(([key, max]) =>
        supabase.rpc("rate_hit", { p_key: key, p_window_seconds: limit.windowSeconds, p_limit: max }),
      ),
    );
    for (const { error } of results) {
      if (error) throw new Error(`rate_hit: ${error.message}`);
    }
    if (results.some(({ data }) => data === false)) return authThrottled(limit.windowSeconds);
    return null;
  } catch (err) {
    reportError(err, { where: "auth_throttle", action });
    return null;
  }
}
