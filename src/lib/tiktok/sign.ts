import { createHmac } from "node:crypto";

/** T2 — params excluded from the signature. */
const UNSIGNED = new Set(["sign", "access_token"]);

/** T2 — secret + path + sorted(key + value) + body + secret. Body must be the exact bytes sent. */
export function tiktokCanonicalString(input: {
  path: string;
  query: Record<string, string>;
  body?: string;
  secret: string;
}): string {
  const params = Object.keys(input.query)
    .filter((k) => !UNSIGNED.has(k))
    .sort()
    .map((k) => `${k}${input.query[k]}`)
    .join("");
  return `${input.secret}${input.path}${params}${input.body ?? ""}${input.secret}`;
}

export function signTikTokRequest(input: { path: string; query: Record<string, string>; body?: string; secret: string }): string {
  return createHmac("sha256", input.secret).update(tiktokCanonicalString(input)).digest("hex");
}
