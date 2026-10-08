import { randomBytes } from "node:crypto";

/** 32 random bytes = 256 bits, base64url without padding = 43 characters. Server only (server action). */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Same format check as shared_folder_view (0062): a guessed / short token 404s without a DB call. */
export function isShareToken(s: string): boolean {
  return typeof s === "string" && TOKEN_RE.test(s);
}

export function shareFolderUrl(site: string, token: string): string {
  return `${site}/shared/${token}`;
}
