/**
 * Chrome extension request validation (Phase 2). Pure. Everything the extension sends is
 * untrusted input from a web page: strict types, bounded sizes, no free text beyond a short model
 * name, and a server-chosen timestamp when the client's clock looks off.
 */
import { normalizeVoucher } from "@/lib/vouchers/normalize";
import { sanitizeImageUrls, MAX_LISTING_IMAGES } from "@/lib/product/images";
import type { VoucherDiscountType, VoucherKind } from "@/lib/vouchers/types";

export interface ObservationModel {
  modelId: string | null;
  name: string;
  price: number;
  originalPrice: number | null;
  stock: number | null;
}

/**
 * A voucher label the extension read. Scope (seller / listing) is bound server-side from our own
 * listing row, and codes are never taken from the extension: a code typed into a page by anyone
 * must not reach other users as if it were real.
 */
export interface ExtensionVoucher {
  kind: VoucherKind;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscount: number | null;
  minSpend: number;
  expiresAt: string | null;
}

export interface ObservationPayload {
  marketplace: "shopee";
  /** listings.external_item_id, e.g. "shopId_itemId". */
  item: string;
  observedAt: string;
  models: ObservationModel[];
  freeShipping: boolean | null;
  hasVoucher: boolean | null;
  vouchers?: ExtensionVoucher[];
  /** https URLs on the marketplace image CDN only. */
  images?: string[];
}

export const MAX_EXTENSION_VOUCHERS = 20;
export const MAX_EXTENSION_IMAGES = MAX_LISTING_IMAGES;

// Placeholder scope: lets normalizeVoucher() check the terms; the real scope is bound on save.
const CHECK_SCOPE = { marketplace: "shopee", listingId: "00000000-0000-0000-0000-000000000000", sellerId: "00000000-0000-0000-0000-000000000000" };

/** Valid voucher labels only (invalid ones are dropped, not fatal), code stripped. */
function extensionVouchers(raw: unknown[]): ExtensionVoucher[] {
  const out: ExtensionVoucher[] = [];
  for (const r of raw) {
    const v = normalizeVoucher(isObj(r) ? { ...r, code: null, listingOnly: false } : r, CHECK_SCOPE);
    if (!v) continue;
    out.push({
      kind: v.kind,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscount: v.maxDiscount,
      minSpend: v.minSpend,
      expiresAt: v.expiresAt,
    });
  }
  return out;
}

const MAX_MODELS = 50;
const MAX_PRICE = 10_000_000_000;
/** A claimed time this far in the past is replaced by the server time (the client clock looks off). */
const CLOCK_SKEW_MS = 10 * 60_000;
/** A claimed time further ahead than this is rejected; a smaller lead is clamped to the server time. */
export const FUTURE_SKEW_MS = 2 * 60_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const posInt = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : null;

/** "shopId_itemId" with numeric parts — the only item format Shopee listings use. */
export function isShopeeItemId(item: unknown): item is string {
  return typeof item === "string" && /^\d{1,20}_\d{1,20}$/.test(item);
}

export function validateObservationPayload(
  body: unknown,
  now: Date,
): { ok: true; value: ObservationPayload } | { ok: false; error: string } {
  if (!isObj(body)) return { ok: false, error: "body" };
  if (body.marketplace !== "shopee") return { ok: false, error: "marketplace" };
  if (!isShopeeItemId(body.item)) return { ok: false, error: "item" };
  if (!Array.isArray(body.models) || body.models.length === 0 || body.models.length > MAX_MODELS) {
    return { ok: false, error: "models" };
  }

  const models: ObservationModel[] = [];
  for (const m of body.models) {
    if (!isObj(m)) return { ok: false, error: "model" };
    const price = posInt(m.price, MAX_PRICE);
    if (price == null) return { ok: false, error: "price" };
    const original = posInt(m.originalPrice, MAX_PRICE);
    const stock = typeof m.stock === "number" && Number.isInteger(m.stock) && m.stock >= 0 && m.stock < 1e7 ? m.stock : null;
    models.push({
      modelId: typeof m.modelId === "string" && /^[\w-]{1,40}$/.test(m.modelId) ? m.modelId : null,
      name: typeof m.name === "string" ? m.name.trim().slice(0, 100) : "",
      price,
      originalPrice: original != null && original > price ? original : null,
      stock,
    });
  }

  // Optional extras. Oversized lists are rejected outright (a real page never has that many).
  if (body.vouchers !== undefined && (!Array.isArray(body.vouchers) || body.vouchers.length > MAX_EXTENSION_VOUCHERS)) {
    return { ok: false, error: "vouchers" };
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.length > MAX_EXTENSION_IMAGES)) {
    return { ok: false, error: "images" };
  }

  // Never store a time in the future: such a row would outlive the next collector observation and
  // stay the "current" price. Slightly ahead → server time; clearly ahead → rejected.
  const claimed = typeof body.observedAt === "string" ? Date.parse(body.observedAt) : NaN;
  if (Number.isFinite(claimed) && claimed - now.getTime() > FUTURE_SKEW_MS) return { ok: false, error: "observedAt" };
  const observedAt =
    Number.isFinite(claimed) && claimed <= now.getTime() && now.getTime() - claimed <= CLOCK_SKEW_MS
      ? new Date(claimed)
      : now;

  return {
    ok: true,
    value: {
      marketplace: "shopee",
      item: body.item,
      observedAt: observedAt.toISOString(),
      models,
      freeShipping: optBool(body.freeShipping),
      hasVoucher: optBool(body.hasVoucher),
      vouchers: Array.isArray(body.vouchers) ? extensionVouchers(body.vouchers) : [],
      images: sanitizeImageUrls(body.images, "shopee", MAX_EXTENSION_IMAGES),
    },
  };
}

/**
 * Only our own extension may call the write endpoints. Web pages cannot send a chrome-extension://
 * Origin, so this also stops cross-site request forgery with the user's DealScore cookie.
 * This is NOT authentication: any non-browser client can send this Origin, and the extension id is
 * public once it ships. Everything behind it treats the caller as untrusted (corroborate.ts).
 * EXTENSION_IDS = comma-separated ids; unset outside production = any unpacked dev extension.
 */
export function isAllowedExtensionOrigin(origin: string | null, env: { ids?: string; production: boolean }): boolean {
  if (!origin) return false;
  const m = origin.match(/^chrome-extension:\/\/([a-p]{32})$/);
  if (!m) return false;
  const ids = (env.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return !env.production;
  return ids.includes(m[1]);
}
