import { createHmac, timingSafeEqual } from "node:crypto";
import type { TikTokConfig } from "@/lib/tiktok/config";

/** A printed authorize link is valid this long. */
export const STATE_TTL_MS = 30 * 60_000;
const TIMEOUT_MS = 15_000;

function mac(secret: string, ts: string): string {
  return createHmac("sha256", secret).update(`tiktok-oauth:${ts}`).digest("base64url");
}

/** state = base64url(unix seconds) + "." + HMAC — proves the callback answers a link we printed. */
export function signState(secret: string, now: Date): string {
  const ts = String(Math.floor(now.getTime() / 1000));
  return `${Buffer.from(ts).toString("base64url")}.${mac(secret, ts)}`;
}

export function verifyState(secret: string, state: string, now: Date): boolean {
  const [encTs, sig, extra] = state.split(".");
  if (!encTs || !sig || extra !== undefined) return false;
  const ts = Buffer.from(encTs, "base64url").toString();
  if (!/^\d+$/.test(ts)) return false;
  const want = Buffer.from(mac(secret, ts));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  const age = now.getTime() - Number(ts) * 1000;
  return age >= 0 && age <= STATE_TTL_MS;
}

export function buildAuthorizeUrl(cfg: TikTokConfig, state: string): string {
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("service_id", cfg.serviceId);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TikTokTokens {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** T3 — { code: 0, data: { access_token, access_token_expire_in, refresh_token, refresh_token_expire_in } } (epoch seconds). */
export function parseTokenResponse(body: unknown): TikTokTokens {
  const b = body as { code?: number; message?: string; data?: Record<string, unknown> } | null;
  if (!b || b.code !== 0) throw new Error(`TikTok token endpoint error ${b?.code ?? "?"}: ${b?.message ?? ""}`);
  const d = b.data ?? {};
  const access = d.access_token;
  const refresh = d.refresh_token;
  const accessExp = Number(d.access_token_expire_in);
  const refreshExp = Number(d.refresh_token_expire_in);
  if (typeof access !== "string" || typeof refresh !== "string" || !(accessExp > 0) || !(refreshExp > 0)) {
    throw new Error("Malformed TikTok token response");
  }
  return {
    accessToken: access,
    accessExpiresAt: new Date(accessExp * 1000),
    refreshToken: refresh,
    refreshExpiresAt: new Date(refreshExp * 1000),
  };
}

async function tokenCall(url: URL, fetchImpl: typeof fetch): Promise<TikTokTokens> {
  const res = await fetchImpl(url.toString(), { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`TikTok token endpoint returned ${res.status}`);
  return parseTokenResponse(await res.json());
}

export function exchangeCode(cfg: TikTokConfig, code: string, fetchImpl: typeof fetch = fetch): Promise<TikTokTokens> {
  const url = new URL(`${cfg.authUrl}/api/v2/token/get`);
  url.searchParams.set("app_key", cfg.appKey);
  url.searchParams.set("app_secret", cfg.appSecret);
  url.searchParams.set("auth_code", code);
  url.searchParams.set("grant_type", "authorized_code"); // sic — TikTok's spelling
  return tokenCall(url, fetchImpl);
}

export function refreshTokens(cfg: TikTokConfig, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<TikTokTokens> {
  const url = new URL(`${cfg.authUrl}/api/v2/token/refresh`);
  url.searchParams.set("app_key", cfg.appKey);
  url.searchParams.set("app_secret", cfg.appSecret);
  url.searchParams.set("refresh_token", refreshToken);
  url.searchParams.set("grant_type", "refresh_token");
  return tokenCall(url, fetchImpl);
}
