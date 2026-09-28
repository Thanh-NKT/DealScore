import type { Recommendation } from "@/lib/pricing/deal-score";

// User-facing copy derived from Deal Score results (Vietnamese by design). Pure, no React.

/** One calm sentence per verdict, worded from the data, never a promise about future prices. */
const VERDICT_NOTE: Record<Exclude<Recommendation, "insufficient_data">, string> = {
  buy: "Giá đang ở vùng thấp so với giá hệ thống ghi nhận.",
  wait: "Giá ở mức trung bình, chưa gần mức thấp nhất đã ghi nhận.",
  avoid: "Giá cao hơn đáng kể so với giá hệ thống ghi nhận gần đây.",
};

/**
 * The verdict's one sentence. When the seller's advertised discount is not real, the sentence says
 * both things at once, so the verdict and "Giảm giá chưa thực chất" never read as a contradiction:
 * the price can be good against history while the seller's "−25%" is measured from an inflated list price.
 */
export function verdictNote(recommendation: Recommendation, fakeSale = false): string | undefined {
  if (recommendation === "insufficient_data") return undefined;
  if (!fakeSale) return VERDICT_NOTE[recommendation];
  return recommendation === "buy"
    ? "Mức giảm người bán ghi chưa thực chất, nhưng giá thật vẫn đang ở vùng thấp so với giá hệ thống ghi nhận."
    : `${VERDICT_NOTE[recommendation]} Mức giảm người bán ghi chưa thực chất.`;
}

/** The engine prefixes reasons with a glyph; the list draws its own icons instead. */
const PRO = /^\s*[✓✔☑]\s*/u;
const CON = /^\s*(?:⚠️?|[✗✘×!])\s*/u;
const MAX_REASONS = 6;

export type Reason = { kind: "pro" | "con"; text: string };

export function parseReasons(reasons: string[] | null | undefined): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const raw of reasons ?? []) {
    if (typeof raw !== "string") continue;
    const kind = PRO.test(raw) ? "pro" : "con";
    const text = raw.replace(PRO, "").replace(CON, "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ kind, text });
  }
  return out.slice(0, MAX_REASONS);
}
