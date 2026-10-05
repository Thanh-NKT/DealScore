import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const NO_STORE = { "Cache-Control": "no-store" };

/** true when Authorization is exactly "Bearer ${secret}". Constant-time comparison. */
export function isAuthorizedAdminRequest(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const got = Buffer.from(headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** null when authorized, otherwise the response to return (500 missing secret, 401 wrong). */
export function adminAuthError(headers: Headers): NextResponse | null {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing ADMIN_API_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedAdminRequest(headers, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  return null;
}
