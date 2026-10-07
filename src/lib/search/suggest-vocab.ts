/**
 * Brand and category suggestions for the search box (spec 2026-10-07-search-quality-logic §1). Pure,
 * DB-free: matches the typed text against the intent vocab (`intent_vocab` RPC, cached) without
 * diacritics — "sam" → Samsung, "tai ng" → Tai nghe, "headphone" → Tai nghe (intent synonyms).
 */
import { CATEGORY_SYNONYMS } from "@/lib/intent/lexicon";
import type { IntentVocab } from "@/lib/intent/types";
import { brandForms } from "@/lib/matching/aliases";
import { normalizeText } from "@/lib/matching/attributes";
import { brandSlug } from "@/lib/seo/sitemap";
import type { AutocompleteBrand, AutocompleteCategory } from "@/lib/search/autocomplete-types";

export const VOCAB_SUGGESTION_LIMIT = 3;
const MIN_PREFIX = 2;

/**
 * How well one normalized form matches the query: 3 = the form is a whole-word phrase of the query
 * ("tai nghe sony" ∋ "sony"), 2 = the form starts with the whole query ("sam" → "samsung"),
 * 1 = the form starts with the word being typed ("tai nghe so" → "sony"), 0 = no match.
 */
function formScore(form: string, query: string, lastWord: string): number {
  if (form === "") return 0;
  if (` ${query} `.includes(` ${form} `)) return 3;
  if (query.length >= MIN_PREFIX && form.startsWith(query)) return 2;
  if (lastWord.length >= MIN_PREFIX && /[a-z]/.test(lastWord) && form.startsWith(lastWord)) return 1;
  return 0;
}

function rank<T extends { name: string }>(scored: Array<{ item: T; score: number; order: number }>): T[] {
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length || a.order - b.order)
    .slice(0, VOCAB_SUGGESTION_LIMIT)
    .map((s) => s.item);
}

export function matchVocab(
  q: string,
  vocab: IntentVocab,
): { brands: AutocompleteBrand[]; categories: AutocompleteCategory[] } {
  const query = normalizeText(typeof q === "string" ? q.slice(0, 200) : "");
  if (query.length < MIN_PREFIX) return { brands: [], categories: [] };
  const words = query.split(" ");
  const lastWord = words[words.length - 1];
  const best = (forms: Iterable<string>) => Math.max(0, ...[...forms].map((f) => formScore(f, query, lastWord)));

  const categories = rank(
    (Array.isArray(vocab?.categories) ? vocab.categories : []).map((c, order) => ({
      item: { name: c.name, slug: c.slug, href: `/${c.slug}` },
      score: best(
        new Set([normalizeText(c.name), normalizeText(c.slug), ...(CATEGORY_SYNONYMS[c.slug] ?? [])]),
      ),
      order,
    })),
  );

  const brands = rank(
    (Array.isArray(vocab?.brands) ? vocab.brands : [])
      .filter((b): b is string => typeof b === "string" && b.trim() !== "")
      .map((name, order) => ({
        item: { name, href: `/brand/${brandSlug(name)}` },
        score: best(brandForms(name)),
        order,
      })),
  );

  return { brands, categories };
}
