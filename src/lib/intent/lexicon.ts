/**
 * Lexicon for the rule-based query intent parser (spec §1). Every phrase is in folded form:
 * diacritics stripped, đ→d, lowercase, words separated by single spaces.
 */
import type { IntentSort } from "@/lib/intent/types";

/** Category synonyms keyed by slug. Only slugs present in `IntentVocab.categories` are used. */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  ssd: ["o cung", "o cung ssd", "o ssd", "ssd"],
  "ban-phim": ["ban phim", "ban phim co", "phim", "keyboard"],
  chuot: ["chuot", "mouse"],
  "man-hinh": ["man hinh", "monitor"],
  "tai-nghe": ["tai nghe", "headphone", "headphones", "earbuds"],
  ram: ["ram"],
  "sac-du-phong": ["sac du phong", "pin du phong", "powerbank", "power bank"],
  webcam: ["webcam"],
};

/** Usage-need phrases → boost term. `co` → `mechanical` is contextual and lives in parse.ts. */
export const NEED_PHRASES: Array<[string, string]> = [
  ["choi game", "gaming"],
  ["gaming", "gaming"],
  ["khong day", "wireless"],
  ["wireless", "wireless"],
  ["bluetooth", "bluetooth"],
  ["van phong", "office"],
  ["chong on", "anc"],
  ["di dong", "portable"],
  ["nho gon", "portable"],
];

/** Filler words dropped from `text` (only when another intent was found or the query has ≥ 4 words). */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  "minh", "toi", "em", "can", "muon", "mua", "tim", "cho", "mot", "con", "cai", "loai",
  "nao", "gi", "voi", "de", "nhe", "a", "giup", "goi y", "gia", "re", "tot", "hang",
]);

/** Sort phrases. Longer phrases are tried first, so "re nhat sau voucher" beats "re nhat". */
export const SORT_PHRASES: Array<[string, IntentSort]> = [
  ["re nhat sau voucher", "effective_asc"],
  ["re nhat sau ma giam", "effective_asc"],
  ["sau voucher", "effective_asc"],
  ["sau ma giam", "effective_asc"],
  ["gia thap nhat", "price_asc"],
  ["re nhat", "price_asc"],
  ["dang mua nhat", "deal_score"],
  ["dang mua", "deal_score"],
  ["deal tot", "deal_score"],
  ["gia tot", "deal_score"],
  ["hoi", "deal_score"],
];

export type IntentFlag = "freeShipping" | "hasVoucher";

export const FLAG_PHRASES: Array<[string, IntentFlag]> = [
  ["freeship", "freeShipping"],
  ["free ship", "freeShipping"],
  ["mien phi van chuyen", "freeShipping"],
  ["co voucher", "hasVoucher"],
  ["co ma giam", "hasVoucher"],
  ["kem voucher", "hasVoucher"],
];

/**
 * Stop phrases removed whole with the filler words (same condition, no chip). Needed where a
 * filler word would otherwise leave half a phrase behind — "chinh hang" minus filler "hang"
 * would leave "chinh", and leftover words are AND-ed in full-text search.
 */
export const STOP_PHRASES: readonly string[] = ["chinh hang"];

/** Canonical color → Vietnamese chip word ("Màu đen"). */
export const COLOR_LABELS: Readonly<Record<string, string>> = {
  black: "đen", white: "trắng", gray: "xám", silver: "bạc", blue: "xanh dương", green: "xanh lá",
  red: "đỏ", pink: "hồng", purple: "tím", gold: "vàng", yellow: "vàng", orange: "cam",
};

export const SORT_LABELS: Readonly<Record<IntentSort, string>> = {
  price_asc: "Rẻ nhất",
  deal_score: "Đáng mua nhất",
  effective_asc: "Rẻ nhất sau voucher",
};
