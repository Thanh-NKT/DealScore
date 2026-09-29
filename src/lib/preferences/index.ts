/**
 * Shopping preferences (spec 2026-09-28-giai-doan-3-nhom-a §5). Pure, DB-free.
 *
 * - `normalizePreferences` turns anything (a DB row, the camelCase shape, junk) into a clean
 *   `Preferences` that always satisfies the `user_preferences` check constraints.
 * - `applyPreferences` fills only the search fields the URL left unset — the URL always wins.
 *   `excludedBrands` is stored but not applied in group A (it is for group C).
 */
import { parseVndInput, type ParsedPrice } from "@/components/watch/price-input";
import { MARKETPLACES, type MarketplaceId } from "@/lib/marketplaces";
import type { SearchParams } from "@/lib/search";

export interface Preferences {
  brands: string[];
  excludedBrands: string[];
  categoryIds: string[];
  minPrice: number | null;
  maxPrice: number | null;
  marketplaces: MarketplaceId[];
}

/** Mirrors the `cardinality(...) <= 20` checks on user_preferences. */
export const MAX_PREFERENCE_ITEMS = 20;
/** numeric(14,2) holds values below 10^12. */
const MAX_PRICE = 999_999_999_999;
const MAX_BRAND_LENGTH = 80;

export const EMPTY_PREFERENCES: Preferences = Object.freeze({
  brands: [],
  excludedBrands: [],
  categoryIds: [],
  minPrice: null,
  maxPrice: null,
  marketplaces: [],
}) as Preferences;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pick(obj: Record<string, unknown>, camel: string, snake: string): unknown {
  return obj[camel] !== undefined ? obj[camel] : obj[snake];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Trim, collapse whitespace, drop blanks, dedupe case-insensitively (first spelling wins), cap. */
function cleanNames(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of asArray(value)) {
    if (typeof item !== "string") continue;
    const name = item.replace(/\s+/g, " ").trim().slice(0, MAX_BRAND_LENGTH);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_PREFERENCE_ITEMS) break;
  }
  return out;
}

function cleanUuids(value: unknown): string[] {
  const out: string[] = [];
  for (const item of asArray(value)) {
    if (typeof item !== "string" || !UUID_RE.test(item.trim())) continue;
    const id = item.trim().toLowerCase();
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length === MAX_PREFERENCE_ITEMS) break;
  }
  return out;
}

function cleanPrice(value: unknown): number | null {
  // PostgREST may return numeric as a string ("3000000.00").
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? n : null;
}

function cleanMarketplaces(value: unknown): MarketplaceId[] {
  const wanted = new Set(
    asArray(value)
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toLowerCase()),
  );
  return MARKETPLACES.map((m) => m.id).filter((id) => wanted.has(id));
}

export function normalizePreferences(raw: unknown): Preferences {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_PREFERENCES, brands: [], excludedBrands: [], categoryIds: [], marketplaces: [] };
  }
  const obj = raw as Record<string, unknown>;
  let minPrice = cleanPrice(pick(obj, "minPrice", "min_price"));
  let maxPrice = cleanPrice(pick(obj, "maxPrice", "max_price"));
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  return {
    brands: cleanNames(obj.brands),
    excludedBrands: cleanNames(pick(obj, "excludedBrands", "excluded_brands")),
    categoryIds: cleanUuids(pick(obj, "categoryIds", "category_ids")),
    minPrice,
    maxPrice,
    marketplaces: cleanMarketplaces(obj.marketplaces),
  };
}

export function isEmptyPreferences(p: Preferences): boolean {
  return (
    p.brands.length === 0 &&
    p.excludedBrands.length === 0 &&
    p.categoryIds.length === 0 &&
    p.minPrice == null &&
    p.maxPrice == null &&
    p.marketplaces.length === 0
  );
}

/**
 * Fills the search fields the URL left unset. Runs after applyIntent, so both the URL and the words
 * the user typed win over saved preferences. Price counts as set when either bound is set (same
 * rule as intent). The category applies only when exactly one preferred category still exists.
 */
export function applyPreferences(
  params: SearchParams,
  p: Preferences,
  categorySlugById: Map<string, string>,
): SearchParams {
  const next: SearchParams = { ...params };

  if ((!params.brands || params.brands.length === 0) && p.brands.length > 0) {
    next.brands = [...p.brands];
  }

  if (params.categorySlug == null && params.categoryId == null) {
    const slugs = p.categoryIds.map((id) => categorySlugById.get(id)).filter((s): s is string => Boolean(s));
    if (slugs.length === 1) next.categorySlug = slugs[0];
  }

  if (params.minPrice == null && params.maxPrice == null) {
    if (p.minPrice != null) next.minPrice = p.minPrice;
    if (p.maxPrice != null) next.maxPrice = p.maxPrice;
  }

  if ((!params.marketplaces || params.marketplaces.length === 0) && p.marketplaces.length > 0) {
    next.marketplaces = [...p.marketplaces];
  }

  return next;
}

/** Params for the "Theo sở thích của tôi" link: flips `prefs`, back to page 1, keeps the rest. */
export function togglePrefsParams(base: SearchParams, on: boolean): SearchParams {
  const next: SearchParams = { ...base, page: undefined, prefs: on ? undefined : true };
  if (next.page === undefined) delete next.page;
  if (next.prefs === undefined) delete next.prefs;
  return next;
}

export type PreferencesField = "brands" | "categoryIds" | "minPrice" | "maxPrice" | "marketplaces";

export type ParsedPreferencesForm =
  | { ok: true; value: Preferences }
  | { ok: false; errors: Partial<Record<PreferencesField, string>> };

const PRICE_ERRORS: Record<Exclude<ParsedPrice, { ok: true }>["reason"], string> = {
  empty: "",
  zero: "",
  negative: "Giá không thể là số âm.",
  unreadable: "Chưa đọc được giá. Thử dạng 2.399.000 hoặc 2tr4.",
  ambiguous: "Thêm đơn vị để rõ giá, ví dụ 2,4 triệu hoặc 2.400.000.",
};

/** One price box: blank or 0 means "no bound". */
function readPrice(raw: FormDataEntryValue | null): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw : "";
  const parsed = parseVndInput(text);
  if (parsed.ok) {
    return parsed.value > MAX_PRICE ? { ok: false, error: "Giá quá lớn." } : { ok: true, value: parsed.value };
  }
  if (parsed.reason === "empty" || parsed.reason === "zero") return { ok: true, value: null };
  return { ok: false, error: PRICE_ERRORS[parsed.reason] };
}

/**
 * Reads the /account/preferences form. Only the known fields are read — never a user id.
 * `excludedBrands` is not on the form; the action leaves the stored value untouched.
 */
export function parsePreferencesForm(form: FormData): ParsedPreferencesForm {
  const strings = (key: string) => form.getAll(key).filter((v): v is string => typeof v === "string");
  const min = readPrice(form.get("minPrice"));
  const max = readPrice(form.get("maxPrice"));

  // Distinct non-blank picks, so a checkbox list over the cap is an error, not a silent truncation.
  const distinct = (key: string) => new Set(strings(key).map((v) => v.trim().toLowerCase()).filter(Boolean)).size;

  const errors: Partial<Record<PreferencesField, string>> = {};
  if (!min.ok) errors.minPrice = min.error;
  if (!max.ok) errors.maxPrice = max.error;
  if (distinct("brands") > MAX_PREFERENCE_ITEMS) errors.brands = `Chọn tối đa ${MAX_PREFERENCE_ITEMS} hãng.`;
  if (distinct("categoryIds") > MAX_PREFERENCE_ITEMS) errors.categoryIds = `Chọn tối đa ${MAX_PREFERENCE_ITEMS} danh mục.`;
  if (!min.ok || !max.ok || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: normalizePreferences({
      brands: strings("brands"),
      categoryIds: strings("categoryIds"),
      minPrice: min.value,
      maxPrice: max.value,
      marketplaces: strings("marketplaces"),
    }),
  };
}
