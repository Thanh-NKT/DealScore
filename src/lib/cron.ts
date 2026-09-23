import { timingSafeEqual } from "node:crypto";

/** true khi Authorization đúng "Bearer ${secret}". So sánh thời gian hằng. */
export function isAuthorizedCronRequest(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
