import type { ApiItem, ApiOrder } from "@/lib/affiliate/normalize";
import {
  callShopeeAffiliate,
  shopeeAffiliateCredentials,
  ShopeeAffiliateError,
  signRequest,
} from "@/lib/shopee/affiliate-http";

export { ShopeeAffiliateError, signRequest };

export type ApiOrderWithItems = ApiOrder & { items: ApiItem[] };

export interface ShopeeAffiliateClient {
  conversionReport(input: { start: Date; end: Date; scrollId: string | null; limit: number }): Promise<{
    orders: ApiOrderWithItems[];
    nextScrollId: string | null;
  }>;
  /** Only for short_link mode (if G1 turns out wrong). */
  generateShortLink(input: { originUrl: string; subIds: string[] }): Promise<string>;
}

// G3 — GraphQL query. Revise after the spike.
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
  const creds = shopeeAffiliateCredentials(env);
  if (!creds) return null;
  const call = <T>(query: string, variables: Record<string, unknown>) => callShopeeAffiliate<T>(creds, query, variables);

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
      // Flatten node → orders, carrying the node's purchaseTime and utmContent.
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

/** For tests: each element of `pages` is one page. `failWith` → the first page throws it. */
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
