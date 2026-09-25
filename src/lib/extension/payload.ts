/**
 * Chrome extension request validation (Phase 2). Pure. Everything the extension sends is
 * untrusted input from a web page: strict types, bounded sizes, no free text beyond a short model
 * name, and a server-chosen timestamp when the client's clock looks off.
 */

export interface ObservationModel {
  modelId: string | null;
  name: string;
  price: number;
  originalPrice: number | null;
  stock: number | null;
}

export interface ObservationPayload {
  marketplace: "shopee";
  /** listings.external_item_id, e.g. "shopId_itemId". */
  item: string;
  observedAt: string;
  models: ObservationModel[];
  freeShipping: boolean | null;
  hasVoucher: boolean | null;
}

const MAX_MODELS = 50;
const MAX_PRICE = 10_000_000_000;
const CLOCK_SKEW_MS = 10 * 60_000;

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

  const claimed = typeof body.observedAt === "string" ? Date.parse(body.observedAt) : NaN;
  const observedAt =
    Number.isFinite(claimed) && Math.abs(claimed - now.getTime()) <= CLOCK_SKEW_MS ? new Date(claimed) : now;

  return {
    ok: true,
    value: {
      marketplace: "shopee",
      item: body.item,
      observedAt: observedAt.toISOString(),
      models,
      freeShipping: optBool(body.freeShipping),
      hasVoucher: optBool(body.hasVoucher),
    },
  };
}

/**
 * Only our own extension may call the write endpoints. Web pages cannot send a chrome-extension://
 * Origin, so this also stops cross-site request forgery with the user's Kairo cookie.
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
