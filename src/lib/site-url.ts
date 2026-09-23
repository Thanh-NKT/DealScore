/** Site base URL without a trailing "/". Used for links in emails. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("Missing NEXT_PUBLIC_SITE_URL");
    return "http://127.0.0.1:3000";
  }
  return raw.replace(/\/+$/, "");
}
