/**
 * Marketplace adapters (Phase 2, group C). One place that knows each marketplace's URLs, whether
 * Kairo has a data source for it, and where /go may redirect. Adding a marketplace = one adapter.
 *
 * TikTok Shop and Lazada: URL formats are assumptions (like G1–G6 for Shopee) until a spike confirms
 * them, and neither has a data source yet — isConfigured() is false, so the collector skips them.
 */
import { externalItemId, parseShopeeUrl, SHOPEE_HOSTS, SHORT_HOSTS, normalizeLookupInput } from "@/lib/shopee/parse-url";
import { getItemDetail, isShopeeConfigured, ShopeeItemGoneError, ShopeeUnavailableError } from "@/lib/shopee/client";
import type { VoucherSource } from "@/lib/vouchers/types";

/** Images + vouchers of one listing as the marketplace reports them (unsanitized: saveListingExtras() filters). */
export interface ListingDetail {
  images: unknown;
  vouchers: unknown;
  source: VoucherSource;
}

/** The marketplace could not give the listing's data right now (down, rate limited, item gone). */
export class MarketplaceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MarketplaceUnavailableError";
  }
}

export type MarketplaceId = "shopee" | "tiktok" | "lazada";

export interface ParsedItem {
  marketplace: MarketplaceId;
  externalItemId: string;
  canonicalUrl: string;
}

export type ParseResult =
  | { ok: true; item: ParsedItem }
  | { ok: false; reason: "needs_redirect" | "unrecognized_format" | "not_supported" };

export interface MarketplaceAdapter {
  id: MarketplaceId;
  /** Name shown to users (neutral chip, DESIGN.md "Nhãn sàn trung lập"). */
  name: string;
  hosts: ReadonlySet<string>;
  shortHosts: ReadonlySet<string>;
  /** Only called with a URL whose host is in hosts / shortHosts. */
  parseUrl(url: URL): Exclude<ParseResult, { ok: false; reason: "not_supported" }>;
  /** Kairo has a real data source (API, or the dev fake) for this marketplace. */
  isConfigured(): boolean;
  /** Hosts /go may redirect a buyer to. */
  targetHosts: ReadonlySet<string>;
  /**
   * CDN hosts product images may come from, as domain suffixes: "susercontent.com" allows
   * "down-vn.img.susercontent.com". Anything else is dropped (listings.images, spec §5).
   */
  imageHosts: readonly string[];
  /**
   * Reads one listing's images + vouchers ("Làm mới" on the product page, /api/vouchers/refresh).
   * Absent = no source for it yet. Only called when isConfigured(). Throws
   * MarketplaceUnavailableError when the marketplace cannot answer.
   */
  fetchListingDetail?(externalItemId: string): Promise<ListingDetail>;
}

const shopee: MarketplaceAdapter = {
  id: "shopee",
  name: "Shopee",
  hosts: SHOPEE_HOSTS,
  shortHosts: SHORT_HOSTS,
  parseUrl(url) {
    const r = parseShopeeUrl(url.toString());
    if (r.ok) {
      return {
        ok: true,
        item: {
          marketplace: "shopee",
          externalItemId: externalItemId(r.shopId, r.itemId),
          canonicalUrl: `https://shopee.vn/product/${r.shopId}/${r.itemId}`,
        },
      };
    }
    return { ok: false, reason: r.reason === "needs_redirect" ? "needs_redirect" : "unrecognized_format" };
  },
  isConfigured: isShopeeConfigured,
  targetHosts: new Set([...SHOPEE_HOSTS, ...SHORT_HOSTS, "shp.ee"]),
  // down-vn.img.susercontent.com (current CDN), cf.shopee.vn / cvf.shopee.vn (older image hosts).
  imageHosts: ["susercontent.com", "cf.shopee.vn", "cvf.shopee.vn"],
  async fetchListingDetail(externalItemId) {
    // Shopee's external id is "{shopId}_{itemId}" (externalItemId() in parse-url).
    const sep = externalItemId.indexOf("_");
    const shopId = sep < 0 ? "" : externalItemId.slice(0, sep);
    const itemId = sep < 0 ? externalItemId : externalItemId.slice(sep + 1);
    try {
      const detail = await getItemDetail(shopId, itemId);
      return { images: detail.images ?? [], vouchers: detail.vouchers ?? [], source: detail.source };
    } catch (err) {
      if (err instanceof ShopeeUnavailableError || err instanceof ShopeeItemGoneError) {
        throw new MarketplaceUnavailableError(err.message, { cause: err });
      }
      throw err;
    }
  },
};

const tiktok: MarketplaceAdapter = {
  id: "tiktok",
  name: "TikTok Shop",
  hosts: new Set(["www.tiktok.com", "tiktok.com", "shop.tiktok.com"]),
  shortHosts: new Set(["vt.tiktok.com", "vm.tiktok.com"]),
  parseUrl(url) {
    if (this.shortHosts.has(url.hostname.toLowerCase())) return { ok: false, reason: "needs_redirect" };
    const m = url.pathname.match(/\/view\/product\/(\d{6,25})(?:\/|$)/);
    return m
      ? { ok: true, item: { marketplace: "tiktok", externalItemId: m[1], canonicalUrl: `https://www.tiktok.com/view/product/${m[1]}` } }
      : { ok: false, reason: "unrecognized_format" };
  },
  isConfigured: () => false,
  targetHosts: new Set(["www.tiktok.com", "shop.tiktok.com", "vt.tiktok.com"]),
  // Assumption (no data source yet): TikTok Shop images are served from these ByteDance CDNs.
  imageHosts: ["ibyteimg.com", "tiktokcdn.com"],
};

const lazada: MarketplaceAdapter = {
  id: "lazada",
  name: "Lazada",
  hosts: new Set(["www.lazada.vn", "lazada.vn"]),
  shortHosts: new Set(["s.lazada.vn"]),
  parseUrl(url) {
    if (this.shortHosts.has(url.hostname.toLowerCase())) return { ok: false, reason: "needs_redirect" };
    const m = url.pathname.match(/^\/products\/[^/]*-i(\d{3,20})(?:-s\d+)?\.html$/);
    return m
      ? { ok: true, item: { marketplace: "lazada", externalItemId: m[1], canonicalUrl: `https://www.lazada.vn/products/-i${m[1]}.html` } }
      : { ok: false, reason: "unrecognized_format" };
  },
  isConfigured: () => false,
  targetHosts: new Set(["www.lazada.vn", "s.lazada.vn", "c.lazada.vn"]),
  // Assumption (no data source yet): Lazada images are served from these Alibaba CDNs.
  imageHosts: ["slatic.net", "alicdn.com"],
};

export const MARKETPLACES: readonly MarketplaceAdapter[] = [shopee, tiktok, lazada];

export function getAdapter(id: string): MarketplaceAdapter | null {
  return MARKETPLACES.find((m) => m.id === id) ?? null;
}

export function marketplaceName(id: string): string {
  return getAdapter(id)?.name ?? id;
}

/** Which marketplace a pasted link belongs to. Hosts are matched exactly: lookalikes return null. */
export function detectMarketplace(raw: string): { adapter: MarketplaceAdapter; url: URL } | null {
  let url: URL;
  try {
    url = new URL(normalizeLookupInput(raw));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const adapter = MARKETPLACES.find((m) => m.hosts.has(host) || m.shortHosts.has(host));
  return adapter ? { adapter, url } : null;
}

export function parseProductUrl(raw: string): ParseResult {
  const found = detectMarketplace(raw);
  return found ? found.adapter.parseUrl(found.url) : { ok: false, reason: "not_supported" };
}

export function allTargetHosts(): ReadonlySet<string> {
  return new Set(MARKETPLACES.flatMap((m) => [...m.targetHosts]));
}

/** Marketplaces the collector can refresh right now. */
export function configuredMarketplaces(): MarketplaceId[] {
  return MARKETPLACES.filter((m) => m.isConfigured()).map((m) => m.id);
}

/** Whether an image host belongs to this marketplace's CDN allow-list (exact or subdomain match). */
export function isAllowedImageHost(marketplace: string, host: string): boolean {
  const h = host.toLowerCase();
  const suffixes = getAdapter(marketplace)?.imageHosts ?? [];
  return suffixes.some((s) => h === s || h.endsWith("." + s));
}
