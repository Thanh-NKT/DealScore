import "server-only";
import { createHash } from "node:crypto";
import type { Env } from "@/lib/marketplaces/types";

/**
 * Shopee Affiliate Open API transport (G3/G4, S1): one signed GraphQL POST. Shared by the
 * conversions client and the product source.
 */
export class ShopeeAffiliateError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /**
     * Credentials / signature / account problem (HTTP 401/403, auth GraphQL codes): every further call
     * fails the same way, so callers treat it as "marketplace unavailable", never as one bad item.
     */
    readonly auth = false,
  ) {
    super(message);
    this.name = "ShopeeAffiliateError";
  }
}

export const DEFAULT_API_URL = "https://open-api.affiliate.shopee.vn/graphql"; // G3
const TIMEOUT_MS = 15_000;
/** S3 — GraphQL error code for "rate limit exceeded". */
const RATE_LIMIT_CODE = 10030;
/**
 * S3 (assumption, check with `pnpm marketplace:probe`) — GraphQL codes for identity / access problems:
 * 10020 invalid signature, credential or timestamp; 10031–10035 access denied, invalid or frozen
 * affiliate account, no API permission.
 */
const AUTH_CODES = new Set([10020, 10031, 10032, 10033, 10034, 10035]);
const AUTH_MESSAGE = /signature|credential|unauthori[sz]ed|access den|permission|request expired/i;

/** G4 — Authorization header value. */
export function signRequest(input: { appId: string; secret: string; timestamp: number; payload: string }): string {
  const signature = createHash("sha256")
    .update(`${input.appId}${input.timestamp}${input.payload}${input.secret}`)
    .digest("hex");
  return `SHA256 Credential=${input.appId}, Timestamp=${input.timestamp}, Signature=${signature}`;
}

export interface ShopeeAffiliateCredentials {
  appId: string;
  secret: string;
  url: string;
}

export function shopeeAffiliateCredentials(env: Env): ShopeeAffiliateCredentials | null {
  const appId = env.SHOPEE_AFFILIATE_APP_ID;
  const secret = env.SHOPEE_AFFILIATE_SECRET;
  if (!appId || !secret) return null;
  return { appId, secret, url: env.SHOPEE_AFFILIATE_API_URL || DEFAULT_API_URL };
}

type GraphQLError = { message?: string; extensions?: { code?: number | string } };

function isAuthError(errors: GraphQLError[]): boolean {
  return errors.some((e) => AUTH_CODES.has(Number(e.extensions?.code)) || AUTH_MESSAGE.test(String(e.message ?? "")));
}

function isRateLimited(errors: GraphQLError[]): boolean {
  return errors.some(
    (e) => Number(e.extensions?.code) === RATE_LIMIT_CODE || String(e.message ?? "").includes(String(RATE_LIMIT_CODE)),
  );
}

export async function callShopeeAffiliate<T>(
  creds: ShopeeAffiliateCredentials,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const payload = JSON.stringify({ query, variables });
  let res: Response;
  try {
    res = await fetch(creds.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Never log this header.
        Authorization: signRequest({ appId: creds.appId, secret: creds.secret, timestamp: Math.floor(Date.now() / 1000), payload }),
      },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ShopeeAffiliateError(`Could not reach Shopee Affiliate API: ${(err as Error).name}`, true);
  }
  if (res.status === 429 || res.status >= 500) {
    throw new ShopeeAffiliateError(`Shopee Affiliate API returned ${res.status}`, true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ShopeeAffiliateError(`Shopee Affiliate API returned ${res.status}`, false, true);
  }
  if (!res.ok) throw new ShopeeAffiliateError(`Shopee Affiliate API returned ${res.status}`, false);

  let body: { data?: T; errors?: GraphQLError[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // A proxy / maintenance page instead of JSON: the API is not answering properly right now.
    throw new ShopeeAffiliateError("Shopee Affiliate API returned a non-JSON body", true);
  }
  if (body.errors?.length) {
    throw new ShopeeAffiliateError(
      `GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`,
      isRateLimited(body.errors),
      isAuthError(body.errors),
    );
  }
  if (!body.data) throw new ShopeeAffiliateError("Response has no data", false);
  return body.data;
}
