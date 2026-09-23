/** URL gốc của site, không có "/" cuối. Dùng cho link trong email. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("Thiếu NEXT_PUBLIC_SITE_URL");
    return "http://127.0.0.1:3000";
  }
  return raw.replace(/\/+$/, "");
}
