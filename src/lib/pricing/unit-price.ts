import { formatVnd } from "@/lib/format";

/**
 * Unit price (roadmap P4 item G): price per ml / g / piece for consumables, computed on read from the
 * variant's own text. Display only — NEVER an input of Deal Score, search ranking or alerts
 * (tests/lib/insights/no-feed.test.ts). Pure.
 */
export type UnitKind = "volume" | "mass" | "count";
/** total in ml | g | pieces. */
export interface UnitQuantity {
  kind: UnitKind;
  total: number;
  perPack: number;
  packs: number;
}
export interface UnitPrice {
  value: number;
  per: 1 | 100;
  unit: "ml" | "g" | "miếng";
  label: string;
}

export const UNIT_MAX_PACKS = 48; // tune with real data
export const UNIT_LIMITS: Record<UnitKind, { min: number; max: number }> = {
  volume: { min: 1, max: 100_000 }, // ml — tune with real data
  mass: { min: 1, max: 100_000 }, // g — tune with real data
  count: { min: 2, max: 5_000 }, // pieces — tune with real data
};
/** Volume / mass shown per 100 from this total up, per 1 below. */
export const UNIT_PER_100_FROM = 100; // tune with real data

/**
 * Consumable categories (P4 review I3): the only ones whose cards / pages show a unit price. A capacity on a
 * durable good ("Nồi chiên 4.1L", "Máy hút bụi 2.5kg") or a phone's "5G" is not a quantity to divide by.
 * Category slugs from the `categories` table — add one here when a consumable category is created.
 */
export const UNIT_PRICE_CATEGORY_SLUGS: readonly string[] = ["ta-bim", "sua"];

export function isUnitPriceCategory(slug: string | null | undefined): boolean {
  return slug != null && UNIT_PRICE_CATEGORY_SLUGS.includes(slug);
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const VOLUME_RE = new RegExp(String.raw`${NUM}\s*(ml|l|lit)(?![\p{L}\d])`, "gu");
const MASS_RE = new RegExp(String.raw`${NUM}\s*(g|gr|gram|kg)(?![\p{L}\d])`, "gu");
const COUNT_RE = /(\d+)\s*(mieng|vien|goi|tui|to|cuon|chiec|cai)(?![\p{L}\d])/gu;
const QTY = String.raw`\d+(?:[.,]\d+)?\s*(?:ml|l|lit|g|gr|gram|kg|mieng|vien|goi|tui|to|cuon|chiec|cai)(?![\p{L}\d])`;
const PACK_BEFORE_RE = new RegExp(String.raw`(\d+)\s*[x×*]\s*${QTY}`, "gu");
const PACK_AFTER_RE = new RegExp(String.raw`${QTY}\s*[x×*]\s*(\d+)(?![\p{L}\d])`, "gu");
const PACK_WORD_RE = /(?:^|[^\p{L}])(loc|thung|hop|combo|set|bo)\s*(\d+)(?![\p{L}\d])/gu;

/** "1,5" / "1.5" are decimals; a dot before exactly three digits is a thousands separator ("3.000ml"). */
const toNumber = (s: string) => (/^\d{1,3}(?:\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number(s.replace(",", ".")));

/**
 * Text that names a durable good or a network: its volume / mass is a capacity or a generation, never a pack
 * quantity (folded, P4 review I3). Second line of defence behind UNIT_PRICE_CATEGORY_SLUGS.
 */
const NOT_A_QUANTITY_RE =
  /(?:^|[^\p{L}\d])(?:noi|may|am sieu toc|am dun|binh giu nhiet|binh dun|lo vi song|lo nuong|tu lanh|quat|chao|lte|wifi|wi-fi|router|dien thoai|iphone|galaxy)(?![\p{L}\d])/u;
/** "5g" / "4G" written without a space and without any pack count: a network generation, not 5 grams. */
const NETWORK_G_RE = /(?:^|[^\p{L}\d])[2-6]g(?![\p{L}\d])/u;

function amounts(text: string, re: RegExp, factor: (unit: string) => number): number[] {
  return [...text.matchAll(re)].map((m) => Math.round(toNumber(m[1]) * factor(m[2]) * 1000) / 1000);
}

export function parseUnitQuantity(text: string): UnitQuantity | null {
  if (!text) return null;
  const t = fold(text);
  if (NOT_A_QUANTITY_RE.test(t)) return null;
  const volumes = amounts(t, VOLUME_RE, (u) => (u === "ml" ? 1 : 1000));
  const counts = [...t.matchAll(COUNT_RE)].map((m) => Number(m[1]));
  if (counts.length === 0 && NETWORK_G_RE.test(t)) return null;
  const masses = amounts(t, MASS_RE, (u) => (u === "kg" ? 1000 : 1));

  const packNums = [
    ...[...t.matchAll(PACK_BEFORE_RE)].map((m) => Number(m[1])),
    ...[...t.matchAll(PACK_AFTER_RE)].map((m) => Number(m[1])),
    ...[...t.matchAll(PACK_WORD_RE)].map((m) => Number(m[2])),
  ];
  const uniq = (xs: number[]) => [...new Set(xs)];

  let kind: UnitKind;
  let per: number[];
  let countAsPacks: number | null = null;
  const measured = (volumes.length > 0 ? 1 : 0) + (masses.length > 0 ? 1 : 0);
  if (measured > 1) return null; // two different kinds
  if (measured === 1) {
    kind = volumes.length > 0 ? "volume" : "mass";
    per = uniq(kind === "volume" ? volumes : masses);
    // "10 gói 20g": a single count next to a volume / mass is the number of packs.
    const cs = uniq(counts);
    if (cs.length > 1) return null;
    if (cs.length === 1) countAsPacks = cs[0];
  } else if (counts.length > 0) {
    kind = "count";
    per = uniq(counts);
  } else {
    return null;
  }
  if (per.length !== 1) return null; // two different quantities of one kind ("180ml / 110ml")
  const packCandidates = uniq([...packNums.filter((n) => n !== per[0] || kind !== "count"), ...(countAsPacks != null ? [countAsPacks] : [])]);
  if (packCandidates.length > 1) return null;
  const packs = packCandidates[0] ?? 1;
  if (!Number.isInteger(packs) || packs < 1 || packs > UNIT_MAX_PACKS) return null;
  const perPack = per[0];
  const total = Math.round(perPack * packs * 1000) / 1000;
  const lim = UNIT_LIMITS[kind];
  if (!(total >= lim.min && total <= lim.max)) return null;
  if (kind === "count" && total === 1) return null;
  return { kind, total, perPack, packs };
}

/**
 * Source text: the variant key + string values of its specs; only when that yields nothing AND the product has
 * exactly one variant, the product name. Never the listing title (an offer of another pack size would be a
 * matching problem upstream, not a number to show). Only for a consumable category (isUnitPriceCategory):
 * the category is required so no caller can forget the gate.
 */
export function variantUnitQuantity(
  v: { variantKey: string; specs?: Record<string, unknown> | null },
  product: { categorySlug: string | null | undefined; canonicalName?: string; variantCount?: number },
): UnitQuantity | null {
  if (!isUnitPriceCategory(product.categorySlug)) return null;
  const specText = Object.values(v.specs ?? {})
    .filter((x): x is string => typeof x === "string")
    .join(" ; ");
  const own = parseUnitQuantity([v.variantKey, specText].filter(Boolean).join(" ; "));
  if (own) return own;
  const hasOwnText = /\d/.test(v.variantKey + specText) && parseUnitQuantity(v.variantKey + " " + specText) === null;
  if (product.canonicalName && product.variantCount === 1 && !hasOwnText) return parseUnitQuantity(product.canonicalName);
  return null;
}

const UNIT_LABEL: Record<UnitKind, UnitPrice["unit"]> = { volume: "ml", mass: "g", count: "miếng" };

export function unitPrice(price: number | null, q: UnitQuantity | null): UnitPrice | null {
  if (price == null || !Number.isFinite(price) || price <= 0 || !q) return null;
  const per: 1 | 100 = q.kind !== "count" && q.total >= UNIT_PER_100_FROM ? 100 : 1;
  const value = Math.round((price / q.total) * per);
  const unit = UNIT_LABEL[q.kind];
  const money = formatVnd(value).replace(/đ$/, " đ");
  return { value, per, unit, label: `${money}/${per === 100 ? "100 " : ""}${unit}` };
}

/** Unit prices are comparable across ≥ 2 rows only when every shown one has the same unit and base. */
export function comparableUnitPrices<T>(rows: T[], get: (r: T) => UnitPrice | null): boolean {
  const ups = rows.map(get).filter((u): u is UnitPrice => u != null);
  if (ups.length < 2) return false;
  return ups.every((u) => u.unit === ups[0].unit && u.per === ups[0].per);
}
