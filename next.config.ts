import type { NextConfig } from "next";

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
  async redirects() {
    return LEGACY_ROUTES.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default nextConfig;
