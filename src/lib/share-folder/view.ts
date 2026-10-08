import type { Recommendation } from "@/lib/pricing/deal-score";
import { SHARED_PRICE_STALE_HOURS } from "@/lib/share-folder/constants";

export interface SharedFolderItem {
  productName: string;
  href: string;
  image: string | null;
  variantKey: string;
  status: "active" | "paused" | "done";
  price: number | null;
  inStock: boolean | null;
  observedAt: string | null;
  isStale: boolean;
  verdict: { score: number; recommendation: Recommendation } | { insufficient: true } | null;
  targetPrice: number | null;
  /** Only when both the price and the target are shown. */
  reached: boolean | null;
  note: string | null;
}

export interface SharedFolderView {
  title: string;
  displayName: string | null;
  updatedAt: string | null;
  showPrices: boolean;
  showTarget: boolean;
  showNotes: boolean;
  items: SharedFolderItem[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const RECS = ["buy", "wait", "avoid"];

/**
 * shared_folder_view() jsonb → view. Pure and defensive: a field the owner disabled is null in the RPC and
 * stays hidden here even if the flags disagreed (flags off → value dropped).
 */
export function parseSharedFolder(raw: unknown, now: Date = new Date()): SharedFolderView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title);
  if (!title) return null;
  const showPrices = r.show_prices === true;
  const showTarget = r.show_target === true;
  const showNotes = r.show_notes === true;
  const items: SharedFolderItem[] = [];
  for (const x of Array.isArray(r.items) ? r.items : []) {
    if (!x || typeof x !== "object") continue;
    const i = x as Record<string, unknown>;
    const name = str(i.product_name);
    const slug = str(i.product_slug);
    if (!name || !slug) continue;
    const category = str(i.category_slug) ?? "san-pham";
    const variantId = str(i.variant_id);
    const price = showPrices ? num(i.price) : null;
    const observedAt = showPrices ? str(i.observed_at) : null;
    const score = showPrices ? num(i.score) : null;
    const rec = showPrices ? str(i.recommendation) : null;
    const target = showTarget ? num(i.target_price) : null;
    const status = i.status === "paused" || i.status === "done" ? i.status : "active";
    items.push({
      productName: name,
      href: `/${category}/${slug}${variantId ? `?variant=${encodeURIComponent(variantId)}` : ""}`,
      image: str(i.image),
      variantKey: str(i.variant_key) ?? "",
      status,
      price,
      inStock: showPrices && typeof i.in_stock === "boolean" ? i.in_stock : null,
      observedAt,
      isStale: observedAt != null && now.getTime() - Date.parse(observedAt) > SHARED_PRICE_STALE_HOURS * 3_600_000,
      verdict: !showPrices
        ? null
        : score != null && rec && RECS.includes(rec)
          ? { score, recommendation: rec as Recommendation }
          : { insufficient: true },
      targetPrice: target,
      reached: price != null && target != null ? price <= target : null,
      note: showNotes ? str(i.note) : null,
    });
  }
  return {
    title,
    displayName: str(r.display_name),
    updatedAt: str(r.updated_at),
    showPrices,
    showTarget,
    showNotes,
    items,
  };
}

export interface SharedItemCopy {
  priceLine: string | null;
  targetLine: string | null;
  reachedLine: string | null;
  statusChip: string | null;
  staleLine: string | null;
}

/** Display strings of one card (UI spec §2.2). Hidden data → null (no "—" placeholders). Pure. */
export function sharedItemView(item: SharedFolderItem, now: Date, formatVnd: (n: number) => string): SharedItemCopy {
  const ageHours = item.observedAt ? Math.floor((now.getTime() - Date.parse(item.observedAt)) / 3_600_000) : null;
  const rel = ageHours == null ? null : ageHours < 48 ? `${Math.max(ageHours, 1)} giờ trước` : `${Math.floor(ageHours / 24)} ngày trước`;
  return {
    priceLine: item.price != null ? formatVnd(item.price) : null,
    targetLine: item.targetPrice != null ? `Giá mong muốn ${formatVnd(item.targetPrice)}` : null,
    reachedLine: item.reached ? "Đã đạt" : null,
    statusChip: item.status === "done" ? "Đã mua" : item.status === "paused" ? "Tạm dừng" : null,
    staleLine: item.isStale && rel ? `Giá ghi nhận ${rel}` : null,
  };
}
