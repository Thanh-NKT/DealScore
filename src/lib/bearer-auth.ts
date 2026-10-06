import { timingSafeEqual } from "node:crypto";

/**
 * true when Authorization is exactly "Bearer ${secret}". Constant-time comparison; a missing secret
 * never authorizes. Shared by the cron routes (CRON_SECRET) and the admin API (ADMIN_API_SECRET).
 */
export function isAuthorizedBearer(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
