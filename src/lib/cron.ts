import { timingSafeEqual } from "node:crypto";

/** true when Authorization is exactly "Bearer ${secret}". Constant-time comparison. */
export function isAuthorizedCronRequest(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
