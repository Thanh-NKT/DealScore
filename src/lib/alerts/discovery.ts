import type { Channel, NotificationSettings } from "@/lib/account/notification-settings";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { toSearchParams } from "@/lib/search";
import { savedToSearchParams, type SavedSearchParams } from "@/lib/saved-search/params";

/**
 * Alerts that do not come from a watch (roadmap P4 E/F, spec §1.2): a saved search found new products, or a
 * followed demand keyword now has results. Pure helpers shared by dispatch, email and push.
 */
export type DiscoveryTrigger = "saved_search" | "demand_found";

export interface DiscoveryItem {
  productId: string;
  variantId: string | null;
  price: number | null;
  recommendation: Recommendation | null;
  score: number | null;
}

export interface DiscoveryEventDetail {
  id: string;
  createdAt: string;
  trigger: DiscoveryTrigger;
  userId: string;
  source:
    | { kind: "saved_search"; id: string; name: string; status: string; channels: Channel[] | null; params: SavedSearchParams }
    | { kind: "demand_found"; id: string; keyword: string; status: string };
  items: Array<DiscoveryItem & { name: string; slug: string; categorySlug: string; image: string | null }>;
  /** alert_events.items_total (items lists at most 5 of them). */
  totalNew: number;
  user: { email: string | null; deletedAt: string | null; settings: NotificationSettings };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECS: readonly string[] = ["buy", "wait", "avoid", "insufficient_data"];

/** alert_events.items jsonb → items. Tolerant: malformed entries are dropped, never thrown on. */
export function parseEventItems(raw: unknown): DiscoveryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveryItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.product_id !== "string" || !UUID_RE.test(o.product_id)) continue;
    const price = typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0 ? o.price : null;
    const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null;
    out.push({
      productId: o.product_id,
      variantId: typeof o.variant_id === "string" && UUID_RE.test(o.variant_id) ? o.variant_id : null,
      price,
      recommendation: typeof o.recommendation === "string" && RECS.includes(o.recommendation) ? (o.recommendation as Recommendation) : null,
      score,
    });
  }
  return out;
}

/** Shape stored in alert_events.items (snake_case, ≤ 5). */
export function toEventItems(items: DiscoveryItem[]): Array<Record<string, unknown>> {
  return items.slice(0, 5).map((i) => ({
    product_id: i.productId,
    variant_id: i.variantId,
    price: i.price,
    recommendation: i.recommendation,
    score: i.score,
  }));
}

/** Email subject of a one-block email, and push title (UI spec §1.4). */
export function discoveryTitle(e: Pick<DiscoveryEventDetail, "source" | "items" | "totalNew">): string {
  if (e.source.kind === "saved_search") {
    const n = Math.max(e.totalNew, e.items.length);
    return `Có ${n} sản phẩm mới khớp “${e.source.name}”`;
  }
  return `DealScore đã có “${e.source.keyword}”`;
}

/** Saved search → its search page (re-run params, default sort); demand → /search?q=keyword. */
export function discoveryLink(site: string, e: Pick<DiscoveryEventDetail, "source">): string {
  if (e.source.kind === "saved_search") {
    const sp = toSearchParams({ ...savedToSearchParams(e.source.params), sort: undefined, page: 1 });
    return `${site}/search?${sp.toString()}`;
  }
  return `${site}/search?${new URLSearchParams({ q: e.source.keyword }).toString()}`;
}

/** Product page of a discovery item (never /go: no click is attributed to a saved search). */
export function discoveryProductUrl(
  site: string,
  i: { categorySlug: string; slug: string; variantId: string | null },
): string {
  const base = `${site}/${i.categorySlug}/${i.slug}`;
  return i.variantId ? `${base}?variant=${encodeURIComponent(i.variantId)}` : base;
}
