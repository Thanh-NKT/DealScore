import { toVndPrice } from "@/lib/shopee/normalize-offer";
import type { MarketplaceItem } from "@/lib/marketplaces/types";

/**
 * TikTok Shop product (assumption T4) → MarketplaceItem. Pure. Prices may be a plain string/number or
 * an object { minimum_amount | min | amount, maximum_amount | max, currency }. One model "default" at the
 * minimum price, flagged `priceIsRange` when the maximum is higher.
 */
type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function text(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** { amount, max, currency } or null; currency "" means unknown (accepted as VND — region VN). */
function readPrice(raw: unknown): { amount: number | null; max: number | null; currency: string } | null {
  if (raw == null) return null;
  const o = asObj(raw);
  if (!o) return { amount: toVndPrice(raw), max: null, currency: "" };
  const amount = toVndPrice(o.minimum_amount ?? o.min ?? o.amount ?? o.sale_price);
  const max = toVndPrice(o.maximum_amount ?? o.max);
  return { amount, max, currency: typeof o.currency === "string" ? o.currency.toUpperCase() : "" };
}

export function normalizeTikTokProduct(raw: unknown): MarketplaceItem | null {
  const p = asObj(raw);
  if (!p) return null;
  const id = text(p.id ?? p.product_id);
  const title = text(p.title ?? p.product_name);
  const shop = asObj(p.shop);
  const shopId = text(shop?.id ?? p.shop_id);
  if (!id || !title || !shopId) return null;

  const sale = readPrice(p.sale_price ?? p.price);
  if (sale && sale.currency && sale.currency !== "VND") return null;
  const original = readPrice(p.original_price);
  const image = text(p.main_image_url ?? asObj(p.main_image)?.url);

  return {
    marketplace: "tiktok",
    externalItemId: id,
    url: `https://www.tiktok.com/view/product/${id}`,
    title,
    seller: { externalId: shopId, name: text(shop?.name ?? p.shop_name), rating: null, ratingCount: null, isOfficial: false },
    models: [
      {
        modelId: "default",
        name: "",
        price: sale?.amount ?? null,
        originalPrice: original && (!original.currency || original.currency === "VND") ? original.amount : null,
        stock: null,
        isFlashSale: false,
        // A min–max range: the minimum may be another variant's price (see MarketplaceModel.priceIsRange).
        priceIsRange: sale?.amount != null && sale.max != null && sale.max > sale.amount,
      },
    ],
    images: image ? [image] : [],
    vouchers: [],
    source: "api",
  };
}
