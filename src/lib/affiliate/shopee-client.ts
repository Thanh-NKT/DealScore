import { createHash } from "node:crypto";
import type { ApiItem, ApiOrder } from "@/lib/affiliate/normalize";

export type ApiOrderWithItems = ApiOrder & { items: ApiItem[] };

export interface ShopeeAffiliateClient {
  conversionReport(input: { start: Date; end: Date; scrollId: string | null; limit: number }): Promise<{
    orders: ApiOrderWithItems[];
    nextScrollId: string | null;
  }>;
  /** Chỉ cho mode short_link (G1 sai). */
  generateShortLink(input: { originUrl: string; subIds: string[] }): Promise<string>;
}

export class ShopeeAffiliateError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ShopeeAffiliateError";
  }
}

const DEFAULT_API_URL = "https://open-api.affiliate.shopee.vn/graphql"; // G3
const TIMEOUT_MS = 15_000;

/** G4 — giá trị header Authorization. */
export function signRequest(input: { appId: string; secret: string; timestamp: number; payload: string }): string {
  const signature = createHash("sha256")
    .update(`${input.appId}${input.timestamp}${input.payload}${input.secret}`)
    .digest("hex");
  return `SHA256 Credential=${input.appId}, Timestamp=${input.timestamp}, Signature=${signature}`;
}

// G3 — truy vấn GraphQL. Sửa sau spike.
const CONVERSION_REPORT_QUERY = `query ($start: Int64!, $end: Int64!, $scrollId: String, $limit: Int) {
  conversionReport(purchaseTimeStart: $start, purchaseTimeEnd: $end, scrollId: $scrollId, limit: $limit) {
    nodes {
      purchaseTime
      utmContent
      orders { orderId orderStatus items { itemId modelId itemPrice qty actualAmount itemTotalCommission displayItemStatus completeTime } }
    }
    pageInfo { scrollId hasNextPage }
  }
}`;
const SHORT_LINK_MUTATION = `mutation ($originUrl: String!, $subIds: [String]) {
  generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) { shortLink }
}`;

export function createShopeeAffiliateClient(
  env: Record<string, string | undefined> = process.env,
): ShopeeAffiliateClient | null {
  const appId = env.SHOPEE_AFFILIATE_APP_ID;
  const secret = env.SHOPEE_AFFILIATE_SECRET;
  if (!appId || !secret) return null;
  const url = env.SHOPEE_AFFILIATE_API_URL || DEFAULT_API_URL;

  async function call<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({ query, variables });
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Không bao giờ log header này.
          Authorization: signRequest({ appId: appId!, secret: secret!, timestamp: Math.floor(Date.now() / 1000), payload }),
        },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ShopeeAffiliateError(`Không gọi được Shopee Affiliate API: ${(err as Error).name}`, true);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new ShopeeAffiliateError(`Shopee Affiliate API trả ${res.status}`, true);
    }
    if (!res.ok) throw new ShopeeAffiliateError(`Shopee Affiliate API trả ${res.status}`, false);

    const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (body.errors?.length) {
      throw new ShopeeAffiliateError(`Lỗi GraphQL: ${body.errors.map((e) => e.message).join("; ")}`, false);
    }
    if (!body.data) throw new ShopeeAffiliateError("Phản hồi không có data", false);
    return body.data;
  }

  return {
    async conversionReport({ start, end, scrollId, limit }) {
      const data = await call<{
        conversionReport: {
          nodes: Array<{ purchaseTime?: number; utmContent?: string; orders?: Array<ApiOrder & { items?: ApiItem[] }> }>;
          pageInfo?: { scrollId?: string; hasNextPage?: boolean };
        };
      }>(CONVERSION_REPORT_QUERY, {
        start: Math.floor(start.getTime() / 1000),
        end: Math.floor(end.getTime() / 1000),
        scrollId,
        limit,
      });
      const report = data.conversionReport;
      // Trải node → đơn, mang theo purchaseTime và utmContent của node.
      const orders: ApiOrderWithItems[] = (report.nodes ?? []).flatMap((node) =>
        (node.orders ?? []).map((o) => ({
          ...o,
          purchaseTime: o.purchaseTime ?? node.purchaseTime,
          utmContent: o.utmContent ?? node.utmContent,
          items: o.items ?? [],
        })),
      );
      const next = report.pageInfo?.hasNextPage ? report.pageInfo.scrollId ?? null : null;
      return { orders, nextScrollId: next };
    },

    async generateShortLink({ originUrl, subIds }) {
      const data = await call<{ generateShortLink: { shortLink: string } }>(SHORT_LINK_MUTATION, { originUrl, subIds });
      return data.generateShortLink.shortLink;
    },
  };
}

/** Dùng cho test: mỗi phần tử của `pages` là một trang. `failWith` → trang đầu ném lỗi này. */
export class FakeShopeeAffiliateClient implements ShopeeAffiliateClient {
  constructor(
    private readonly pages: ApiOrderWithItems[][],
    private readonly failWith?: Error,
  ) {}
  async conversionReport({ scrollId }: { scrollId: string | null }) {
    if (this.failWith) throw this.failWith;
    const i = scrollId ? Number(scrollId) : 0;
    return { orders: this.pages[i] ?? [], nextScrollId: i + 1 < this.pages.length ? String(i + 1) : null };
  }
  async generateShortLink({ originUrl }: { originUrl: string }) {
    return `https://s.shopee.vn/fake?u=${encodeURIComponent(originUrl)}`;
  }
}
