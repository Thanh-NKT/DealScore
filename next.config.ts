import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { SECURITY_HEADERS } from "./src/lib/security/headers";

// Legacy Vietnamese URLs → English routes. Kept permanently: emails already sent
// (magic links, unsubscribe links, account-deletion notices) still point at the old paths.
// Query strings are forwarded automatically.
const LEGACY_ROUTES: Array<[string, string]> = [
  ["/tai-khoan/dong-y", "/account/consent"],
  ["/tai-khoan/khoi-phuc", "/account/restore"],
  ["/tai-khoan/thong-bao", "/account/notifications"],
  ["/tai-khoan/xoa", "/account/delete"],
  ["/tai-khoan/xuat-du-lieu", "/account/export"],
  ["/tai-khoan/watch", "/account/watch"],
  ["/tai-khoan", "/account"],
  ["/dang-nhap", "/login"],
  ["/tim-kiem", "/search"],
  ["/huy-dang-ky", "/unsubscribe"],
  ["/auth/xac-nhan", "/auth/confirm"],
];

const nextConfig: NextConfig = {
  // HSTS, X-Frame-Options, … on every response. The CSP (per-request nonce) is set in src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return LEGACY_ROUTES.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

// Source-map upload to Sentry only when its build token is configured (error tracking itself
// only needs SENTRY_DSN at runtime — see src/instrumentation.ts).
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
    })
  : nextConfig;
