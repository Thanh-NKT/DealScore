/**
 * Marketplace adapters (Phase 2, group C). One place that knows each marketplace's URLs, whether
 * Kairo has a data source for it, and where /go may redirect. Adding a marketplace = one adapter.
 *
 * TikTok Shop and Lazada: URL formats are assumptions (like G1–G6 for Shopee) until a spike confirms
 * them, and neither has a data source yet — isConfigured() is false, so the collector skips them.
 */
import { externalItemId, parseShopeeUrl, SHOPEE_HOSTS, SHORT_HOSTS, normalizeLookupInput } from "@/lib/shopee/parse-url";
import { isShopeeConfigured } from "@/lib/shopee/client";

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
