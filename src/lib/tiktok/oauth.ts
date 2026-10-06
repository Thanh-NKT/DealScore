import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Env } from "@/lib/marketplaces/types";
import type { TikTokConfig } from "@/lib/tiktok/config";

/** A printed authorize link is valid this long. */
export const STATE_TTL_MS = 30 * 60_000;
const TIMEOUT_MS = 15_000;
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Key that signs the OAuth state. Derived from ADMIN_API_SECRET (owner-only, like the authorize link
 * itself) and domain-separated, so CRON_SECRET is no longer reused for a second purpose.
 */
export function oauthStateKey(env: Env = process.env): string | null {
  const secret = env.ADMIN_API_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("kairo:tiktok-oauth-state:v2").digest("base64url");
}

function mac(key: string, ts: string, nonce: string): string {
  return createHmac("sha256", key).update(`tiktok-oauth:${ts}:${nonce}`).digest("base64url");
}

/**
 * state = base64url(unix seconds) + "." + nonce + "." + HMAC — proves the callback answers a link we
 * printed. The nonce is registered in job_locks (registerState) and consumed once (consumeState).
 */
export function signState(key: string, now: Date, nonce: string = randomBytes(16).toString("base64url")): string {
  const ts = String(Math.floor(now.getTime() / 1000));
  return `${Buffer.from(ts).toString("base64url")}.${nonce}.${mac(key, ts, nonce)}`;
}

/** The state's nonce when the signature and age are valid, else null. Single use is checked by consumeState. */
export function verifyState(key: string, state: string, now: Date): string | null {
  const [encTs, nonce, sig, extra] = state.split(".");
  if (!encTs || !nonce || !sig || extra !== undefined || !NONCE_RE.test(nonce)) return null;
  const ts = Buffer.from(encTs, "base64url").toString();
  if (!/^\d+$/.test(ts)) return null;
  const want = Buffer.from(mac(key, ts, nonce));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const age = now.getTime() - Number(ts) * 1000;
  return age >= 0 && age <= STATE_TTL_MS ? nonce : null;
}

function stateNonce(state: string): string | null {
  const nonce = state.split(".")[1];
  return nonce && NONCE_RE.test(nonce) ? nonce : null;
}

const lockName = (nonce: string) => `tiktok-oauth:${nonce}`;
const STATE_OWNER = "oauth-state";

/** Register a freshly signed state so it can be used once, within STATE_TTL_MS. Throws on DB error. */
export async function registerState(client: SupabaseClient<Database>, state: string): Promise<void> {
  const nonce = stateNonce(state);
  if (!nonce) throw new Error("Malformed OAuth state");
  const { data, error } = await client.rpc("try_acquire_job_lock", {
    p_name: lockName(nonce),
    p_owner: STATE_OWNER,
    p_ttl_seconds: Math.ceil(STATE_TTL_MS / 1000),
  });
  if (error || !data) throw new Error(`Failed to register OAuth state: ${error?.message ?? "nonce already used"}`);
}

/**
 * Mark the state's nonce used. true only for the first callback within the TTL: a leaked or replayed
 * link cannot overwrite the stored credentials a second time. One UPDATE, so two racing callbacks
 * cannot both win.
 */
export async function consumeState(client: SupabaseClient<Database>, nonce: string, now = new Date()): Promise<boolean> {
  const { data, error } = await client
    .from("job_locks")
    .update({ locked_until: "-infinity" })
    .eq("name", lockName(nonce))
    .eq("owner", STATE_OWNER)
    .gt("locked_until", now.toISOString())
    .select("name");
  if (error) throw new Error(`Failed to consume OAuth state: ${error.message}`);
  return (data ?? []).length === 1;
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
