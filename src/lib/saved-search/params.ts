import { MIN_RATINGS, type MinRating, type SearchParams } from "@/lib/search";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import { SAVED_SEARCH_Q_MAX } from "@/lib/saved-search/constants";
import { formatVnd } from "@/lib/format";

/**
 * The frozen params of a saved search (stored as saved_searches.params jsonb). Pure.
 * Same rules as the DB check saved_search_params_valid() (0060) — tests/db/saved-searches.test.ts runs one
 * fixture list through both.
 */
export interface SavedSearchParams {
  q?: string;
  categorySlug?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  marketplaces?: MarketplaceId[];
  capacityGb?: number;
  onlyBuy?: true;
  freeShipping?: true;
  hasVoucher?: true;
  minRating?: MinRating;
}

const KEYS = new Set([
  "q", "categorySlug", "brands", "minPrice", "maxPrice", "marketplaces", "capacityGb",
  "onlyBuy", "freeShipping", "hasVoucher", "minRating",
]);
const MARKET_IDS = new Set<string>(MARKETPLACES.map((m) => m.id));

/**
 * From the params the page actually searched with (URL + intent, never preferences). Drops sort, page, intent,
 * prefs and the URL-only categoryId; keeps only conditions that narrow the set.
 */
export function toSavedParams(p: SearchParams): SavedSearchParams {
  const out: SavedSearchParams = {};
  const q = p.q?.replace(/\s+/g, " ").trim();
  if (q) out.q = q.slice(0, SAVED_SEARCH_Q_MAX);
  if (p.categorySlug) out.categorySlug = p.categorySlug;
  const brands = [...new Set((p.brands ?? []).map((b) => b.trim()).filter(Boolean))].slice(0, 10);
  if (brands.length > 0) out.brands = brands;
  if (p.minPrice != null && Number.isFinite(p.minPrice) && p.minPrice > 0) out.minPrice = p.minPrice;
  if (p.maxPrice != null && Number.isFinite(p.maxPrice) && p.maxPrice > 0) out.maxPrice = p.maxPrice;
  const markets = MARKETPLACES.map((m) => m.id).filter((id) => p.marketplaces?.includes(id));
  if (markets.length > 0) out.marketplaces = markets;
  if (p.capacityGb != null) out.capacityGb = p.capacityGb;
  if (p.onlyBuy) out.onlyBuy = true;
  if (p.freeShipping) out.freeShipping = true;
  if (p.hasVoucher) out.hasVoucher = true;
  if (p.minRating != null) out.minRating = p.minRating;
  return out;
}

const isStr = (v: unknown, min: number, max: number): v is string =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Same rules as saved_search_params_valid (0060), incl. "must narrow" and "must scope". null = invalid. */
export function parseSavedParams(raw: unknown): SavedSearchParams | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!KEYS.has(k)) return null;
  const out: SavedSearchParams = {};
  if ("q" in r) {
    if (!isStr(r.q, 1, SAVED_SEARCH_Q_MAX)) return null;
    out.q = r.q;
  }
  if ("categorySlug" in r) {
    if (typeof r.categorySlug !== "string" || r.categorySlug.length < 1 || r.categorySlug.length > 80) return null;
    out.categorySlug = r.categorySlug;
  }
  if ("brands" in r) {
    const b = r.brands;
    if (!Array.isArray(b) || b.length < 1 || b.length > 10 || !b.every((x) => isStr(x, 1, 60))) return null;
    out.brands = b as string[];
  }
  if ("marketplaces" in r) {
    const m = r.marketplaces;
    if (!Array.isArray(m) || m.length < 1 || m.length > 3 || !m.every((x) => typeof x === "string" && MARKET_IDS.has(x))) return null;
    out.marketplaces = m as MarketplaceId[];
  }
  if ("minPrice" in r) {
    if (!isNum(r.minPrice) || r.minPrice < 0) return null;
    out.minPrice = r.minPrice;
  }
  if ("maxPrice" in r) {
    if (!isNum(r.maxPrice) || r.maxPrice <= 0) return null;
    out.maxPrice = r.maxPrice;
  }
  if (out.minPrice != null && out.maxPrice != null && out.minPrice > out.maxPrice) return null;
  if ("capacityGb" in r) {
    if (!isNum(r.capacityGb) || !Number.isInteger(r.capacityGb) || r.capacityGb < 1 || r.capacityGb > 65536) return null;
    out.capacityGb = r.capacityGb;
  }
  if ("minRating" in r) {
    const v = MIN_RATINGS.find((x) => x === r.minRating);
    if (v == null) return null;
    out.minRating = v;
  }
  for (const k of ["onlyBuy", "freeShipping", "hasVoucher"] as const) {
    if (k in r) {
      if (r[k] !== true) return null;
      out[k] = true;
    }
  }
  if (canSaveSearch(out).ok === false) return null;
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 2000) return null;
  return out;
}

/** Re-run params: intent OFF (applied once at save time), cheapest first, page 1. */
export function savedToSearchParams(p: SavedSearchParams): SearchParams {
  return {
    q: p.q,
    categorySlug: p.categorySlug,
    brands: p.brands,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    marketplaces: p.marketplaces,
    capacityGb: p.capacityGb,
    onlyBuy: p.onlyBuy,
    freeShipping: p.freeShipping,
    hasVoucher: p.hasVoucher,
    minRating: p.minRating,
    intent: false,
    sort: "price_asc",
    page: 1,
  };
}

export function canSaveSearch(p: SavedSearchParams): { ok: true } | { ok: false; reason: "no_scope" | "no_condition" } {
  if (!p.q && !p.categorySlug && !(p.brands && p.brands.length > 0)) return { ok: false, reason: "no_scope" };
  if (p.maxPrice == null && !p.onlyBuy) return { ok: false, reason: "no_condition" };
  return { ok: true };
}

/** "1,5 triệu" for round amounts ≥ 1 triệu, else "850.000đ". */
export function shortPrice(v: number): string {
  if (v >= 1_000_000 && v % 100_000 === 0) {
    return `${(v / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu`;
  }
  return formatVnd(v);
}

/** Display parts, also the dialog's read-only chips: ["nồi chiên philips", "dưới 1,5 triệu", "Nên mua"]. */
export function savedSearchParts(p: SavedSearchParams, categoryName?: string): string[] {
  const parts: string[] = [];
  const scope = [p.q, !p.q ? (categoryName ?? p.categorySlug) : undefined, ...(!p.q ? (p.brands ?? []) : [])]
    .filter(Boolean)
    .join(" ");
  if (scope) parts.push(scope.toLocaleLowerCase("vi"));
  if (p.capacityGb != null) parts.push(p.capacityGb >= 1024 && p.capacityGb % 1024 === 0 ? `${p.capacityGb / 1024}TB` : `${p.capacityGb}GB`);
  if (p.minPrice != null && p.maxPrice != null) parts.push(`${shortPrice(p.minPrice)} – ${shortPrice(p.maxPrice)}`);
  else if (p.maxPrice != null) parts.push(`dưới ${shortPrice(p.maxPrice)}`);
  else if (p.minPrice != null) parts.push(`từ ${shortPrice(p.minPrice)}`);
  if (p.onlyBuy) parts.push("Nên mua");
  return parts;
}

export function defaultSavedSearchName(p: SavedSearchParams, categoryName?: string): string {
  const name = savedSearchParts(p, categoryName).join(" · ");
  return (name || "Tìm kiếm đã lưu").slice(0, 60).trim();
}
