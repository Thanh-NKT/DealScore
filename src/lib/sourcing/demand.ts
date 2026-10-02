import { detectMarketplace } from "@/lib/marketplaces";
import type { Env } from "@/lib/marketplaces/types";

/**
 * Demand-driven sourcing rules (spec 2026-10-01-tu-tim-theo-nhu-cau-gom-ban-nhap §5). Pure.
 * Only the cleaned keyword is ever stored — never who searched.
 */
export const DEMAND_MIN_RESULTS = 3;
const DEFAULT_DEMAND_DAILY_CAP = 100;
const MIN_LENGTH = 3;
const MAX_LENGTH = 60;
const MAX_WORDS = 8;

/** New demand keywords per marketplace per Vietnam day. 0 disables demand capture. */
export function demandDailyCap(env: Env = process.env): number {
  const n = Number.parseInt(env.SOURCING_DEMAND_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEMAND_DAILY_CAP;
}

export function shouldRecordDemand(input: { q: string | undefined; total: number; page: number }): boolean {
  return Boolean(input.q?.trim()) && input.total < DEMAND_MIN_RESULTS && input.page === 1;
}

export function demandKeyword(
  q: string,
  intent?: { text: string; brands?: string[]; categoryName?: string },
): string | null {
  const raw = intent ? [...(intent.brands ?? []), intent.categoryName ?? "", intent.text].join(" ") : q;
  const keyword = raw.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");

  if (keyword.length < MIN_LENGTH || keyword.length > MAX_LENGTH) return null;
  if (keyword.split(" ").length > MAX_WORDS) return null;
  if (/@|https?:|www\.|\//.test(keyword)) return null;
  // Any dotted hostname ("abc.xyz"); "2.5 inch" stays allowed (digit-dot-digit).
  if (/[\p{L}\d-]\.\p{L}{2,}\b/u.test(keyword)) return null;

  // Phone numbers: strip separators and check for 6+ consecutive digits
  const noSeparators = keyword.replace(/[\s.\-()+]/g, "");
  if (/\d{6,}/.test(noSeparators)) return null;

  // Bare domains (includes common TLDs and marketplace short URLs)
  if (/\b[\p{L}\d-]+\.(com|vn|net|org|info|io|me|shop|store|ee|co)\b/u.test(keyword)) return null;

  // Obfuscated emails: "at" marker + "dot" word, or [at]/(at)
  if (/\[at\]|\(at\)/.test(keyword)) return null;
  if (/\bat\b/.test(keyword) && /\bdot\b|\bchấm\b|\bdiem\b/.test(keyword)) return null;

  if (!/\p{L}/u.test(keyword)) return null;
  if (detectMarketplace(q) != null) return null;
  // Also check cleaned keyword for marketplace patterns
  if (detectMarketplace(keyword) != null) return null;
  return keyword;
}
