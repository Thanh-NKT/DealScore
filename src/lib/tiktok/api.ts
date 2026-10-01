import "server-only";
import { signTikTokRequest } from "@/lib/tiktok/sign";
import type { TikTokConfig } from "@/lib/tiktok/config";
import { MarketplaceUnavailableError } from "@/lib/marketplaces/types";

const TIMEOUT_MS = 15_000;
/** T2 — API codes meaning the access token is invalid/expired (re-authorize or refresh). */
const TOKEN_ERROR_CODES = new Set([105001, 105002, 105003]);

export type TikTokCaller = <T>(path: string, opts: { query?: Record<string, string>; body?: unknown }) => Promise<T>;

const unavailable = (message: string, cause?: unknown) => new MarketplaceUnavailableError(message, { marketplace: "tiktok", cause });

/** One signed TikTok Shop API call. Never logs the token. */
export async function callTikTok<T>(
  cfg: TikTokConfig,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown },
  deps: { accessToken: string; fetchImpl?: typeof fetch; now?: () => Date },
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const query: Record<string, string> = {
    app_key: cfg.appKey,
    timestamp: String(Math.floor(now().getTime() / 1000)),
    ...opts.query,
  };
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const url = new URL(`${cfg.apiUrl}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("sign", signTikTokRequest({ path, query, body, secret: cfg.appSecret }));

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-tts-access-token": deps.accessToken },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable(`Could not reach TikTok Shop API: ${(err as Error).name}`, err);
  }
  if (res.status === 429 || res.status >= 500) throw unavailable(`TikTok Shop API returned ${res.status}`);
  if (!res.ok) throw new Error(`TikTok Shop API returned ${res.status}`);

  const json = (await res.json()) as { code?: number; message?: string; data?: T };
  if (json.code !== 0) {
    const msg = `TikTok Shop API error ${json.code}: ${json.message ?? ""}`;
    if (TOKEN_ERROR_CODES.has(Number(json.code))) throw unavailable(msg);
    throw new Error(msg);
  }
  return json.data as T;
}
