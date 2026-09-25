/**
 * Brand aliases for matching v1: listings write the same maker several ways ("WD" / "Western
 * Digital"). Keys and values are normalizeText() forms. Add an alias here, never in the scorer.
 */
import { normalizeText } from "@/lib/matching/attributes";

const ALIASES: Record<string, string[]> = {
  "western digital": ["wd"],
  wd: ["western digital"],
  "hewlett packard": ["hp"],
  hp: ["hewlett packard"],
  "tp link": ["tplink"],
  logitech: ["logi"],
  "kingston technology": ["kingston"],
  xiaomi: ["mi", "redmi"],
  "samsung electronics": ["samsung"],
  asus: ["asustek"],
};

/** The brand plus its aliases, all normalized. */
export function brandForms(brand: string): string[] {
  const n = normalizeText(brand);
  return [n, ...(ALIASES[n] ?? [])];
}
