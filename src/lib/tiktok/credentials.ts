import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { TikTokTokens } from "@/lib/tiktok/oauth";
import { MarketplaceUnavailableError } from "@/lib/marketplaces/types";
import { reportError } from "@/lib/observability";

/** Refresh the access token when less than this is left. */
export const REFRESH_MARGIN_MS = 24 * 3_600_000;
const LOCK_NAME = "tiktok_token_refresh";
const LOCK_TTL_SECONDS = 60;
/** After a failed refresh, keep using the still-valid token this long before trying again. */
export const REFRESH_BACKOFF_MS = 10 * 60_000;

/** Per-process memory of the last failed refresh (one per source; tests pass their own). */
export interface RefreshBackoff {
  failedAt: number | null;
}

export interface TokenStore {
  load(): Promise<TikTokTokens | null>;
  save(t: TikTokTokens): Promise<void>;
  tryLock(owner: string): Promise<boolean>;
  unlock(owner: string): Promise<void>;
}

export function supabaseTokenStore(client: SupabaseClient<Database>): TokenStore {
  return {
    async load() {
      const { data, error } = await client
        .from("marketplace_credentials")
        .select("access_token, access_expires_at, refresh_token, refresh_expires_at")
        .eq("marketplace", "tiktok")
        .maybeSingle();
      if (error) throw new Error(`Failed to read TikTok credentials: ${error.message}`);
      if (!data) return null;
      return {
        accessToken: data.access_token,
        accessExpiresAt: new Date(data.access_expires_at),
        refreshToken: data.refresh_token,
        refreshExpiresAt: new Date(data.refresh_expires_at),
      };
    },
    async save(t) {
      const { error } = await client.from("marketplace_credentials").upsert({
        marketplace: "tiktok",
        access_token: t.accessToken,
        access_expires_at: t.accessExpiresAt.toISOString(),
        refresh_token: t.refreshToken,
        refresh_expires_at: t.refreshExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`Failed to save TikTok credentials: ${error.message}`);
    },
    async tryLock(owner) {
      const { data, error } = await client.rpc("try_acquire_job_lock", { p_name: LOCK_NAME, p_owner: owner, p_ttl_seconds: LOCK_TTL_SECONDS });
      if (error) throw new Error(`Failed to acquire token lock: ${error.message}`);
      return data === true;
    },
    async unlock(owner) {
      await client.rpc("release_job_lock", { p_name: LOCK_NAME, p_owner: owner });
    },
  };
}

const unavailable = (message: string, cause?: unknown) =>
  new MarketplaceUnavailableError(message, { marketplace: "tiktok", cause });

/** A valid access token, refreshed (once, under a lock) when it has less than 24h left. */
export async function getTikTokAccessToken(
  store: TokenStore,
  opts: {
    now?: Date;
    refresh: (refreshToken: string) => Promise<TikTokTokens>;
    sleep?: (ms: number) => Promise<void>;
    backoff?: RefreshBackoff;
  },
): Promise<string> {
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fresh = (t: TikTokTokens) => t.accessExpiresAt.getTime() - now.getTime() >= REFRESH_MARGIN_MS;
  const usable = (t: TikTokTokens) => t.accessExpiresAt.getTime() > now.getTime();

  const current = await store.load();
  if (!current) throw unavailable("TikTok Shop is not authorized — run pnpm tiktok:authorize");
  if (fresh(current)) return current.accessToken;
  if (current.refreshExpiresAt.getTime() <= now.getTime()) {
    throw unavailable("TikTok Shop authorization expired — run pnpm tiktok:authorize");
  }
  // A refresh failed a moment ago: do not retry it (lock + HTTP) on every API call of the run.
  const failedAt = opts.backoff?.failedAt;
  if (usable(current) && failedAt != null && now.getTime() - failedAt < REFRESH_BACKOFF_MS) return current.accessToken;

  const owner = randomUUID();
  if (!(await store.tryLock(owner))) {
    // Someone else is refreshing: wait for them, then use whatever is valid.
    await sleep(1000);
    const after = await store.load();
    if (after && usable(after)) return after.accessToken;
    throw unavailable("TikTok token refresh in progress");
  }
  try {
    const again = await store.load();
    if (again && fresh(again)) return again.accessToken;
    const latest = again ?? current;
    let next: TikTokTokens;
    try {
      next = await opts.refresh(latest.refreshToken);
    } catch (err) {
      if (opts.backoff) opts.backoff.failedAt = now.getTime();
      // The current token still works: use it and retry the refresh after the backoff.
      if (usable(latest)) return latest.accessToken;
      throw unavailable("TikTok token refresh failed", err);
    }
    if (opts.backoff) opts.backoff.failedAt = null;
    try {
      await store.save(next);
    } catch (err) {
      // The new token is valid for this call; the next call retries the refresh. If TikTok rotated the
      // refresh token, the stored one may now be dead: this needs attention. Never log token values.
      reportError(new Error(`Failed to save refreshed TikTok token: ${err instanceof Error ? err.message : "unknown error"}`), {
        where: "getTikTokAccessToken.save",
      });
    }
    return next.accessToken;
  } finally {
    await store.unlock(owner);
  }
}
