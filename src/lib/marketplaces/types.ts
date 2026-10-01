/**
 * Marketplace-agnostic data types. Client-safe: no node:* imports, no admin client.
 * Every source (fake, Shopee Affiliate, TikTok Shop Affiliate) returns these shapes.
 */
export type MarketplaceId = "shopee" | "tiktok" | "lazada";
export type Env = Record<string, string | undefined>;

export interface MarketplaceModel {
  modelId: string;
  name: string;
  price: number | null;
  originalPrice: number | null;
  stock: number | null;
  isFlashSale: boolean;
}

export interface MarketplaceItem {
  marketplace: MarketplaceId;
  /** shopee: "{shopId}_{itemId}"; tiktok: product id. */
  externalItemId: string;
  /** Canonical, no query string. */
  url: string;
  title: string;
  seller: { externalId: string; name: string | null; rating: number | null; ratingCount: number | null; isOfficial: boolean };
  models: MarketplaceModel[];
  /** Unsanitized — saveListingExtras() filters them. */
  images: string[];
  /** Unsanitized — normalizeVoucher() validates them. */
  vouchers: unknown[];
  /** 'seed' = fake data, written to price_observations.source so it never mixes with real prices. */
  source: "api" | "seed";
}

/** cursor: null = first page. Shopee uses a page number as a string ("2"), TikTok a page_token. */
export interface SearchQuery {
  kind: "keyword" | "category";
  value: string;
  cursor: string | null;
  limit: number;
}

export interface SearchPage {
  items: MarketplaceItem[];
  /** null = no more pages. */
  nextCursor: string | null;
}

export interface MarketplaceSource {
  id: MarketplaceId;
  /** A fake (dev) or real source is available. */
  isConfigured(env?: Env): boolean;
  /** The fake source is the one in use (its data is 'seed'). */
  isFake(env?: Env): boolean;
  fetchItem(externalItemId: string): Promise<MarketplaceItem>;
  searchItems(q: SearchQuery): Promise<SearchPage>;
}

/** The marketplace cannot answer right now (down, timeout, rate limited, token broken). Stop calling it this run. */
export class MarketplaceUnavailableError extends Error {
  readonly marketplace?: MarketplaceId;
  constructor(message: string, options?: { cause?: unknown; marketplace?: MarketplaceId }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MarketplaceUnavailableError";
    this.marketplace = options?.marketplace;
  }
}

/** The marketplace answered but has no such item (possibly just not in the affiliate program). Never means 'gone'. */
export class MarketplaceItemNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceItemNotFoundError";
  }
}

/** The marketplace says explicitly the item was deleted/banned → listing becomes inactive. */
export class MarketplaceItemGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceItemGoneError";
  }
}

/** Fake sources are dev-only: fake prices stored as real ones would destroy user trust. */
export function isFakeEnabled(env: Env, flag: "SHOPEE_CLIENT" | "TIKTOK_CLIENT"): boolean {
  return env[flag] === "fake" && env.NODE_ENV !== "production";
}
