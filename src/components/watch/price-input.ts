/**
 * Reads a price the way Vietnamese shoppers type it: "2.399.000", "2399000", "2tr4", "2,4 triệu",
 * "450k", "1 tỷ 2". The watch form sends the resulting integer to the server, whose parser only
 * accepts digits — so shorthand never reaches it.
 */
export type ParsedPrice =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "zero" | "negative" | "unreadable" | "ambiguous" };

const UNITS: Array<{ re: RegExp; factor: number }> = [
  { re: /^(tỷ|tỉ|ty|ti|b)$/, factor: 1_000_000_000 },
  { re: /^(triệu|trieu|tr|m)$/, factor: 1_000_000 },
  { re: /^(nghìn|nghin|ngàn|ngan|k)$/, factor: 1_000 },
];

export function parseVndInput(raw: string): ParsedPrice {
  const text = raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s*(₫|đồng|dong|vnđ|vnd|đ)\s*$/u, "")
    .trim();
  if (!text) return { ok: false, reason: "empty" };
  if (/^[-−]/.test(text)) return { ok: false, reason: "negative" };

  const compact = text.replace(/\s+/g, "");

  // Plain amount: digits with optional thousands separators ("2.399.000", "2,399,000", "2 399 000").
  if (/^\d+$/.test(compact) || /^\d{1,3}([.,]\d{3})+$/.test(compact)) {
    const value = Number(compact.replace(/[.,]/g, ""));
    return value === 0 ? { ok: false, reason: "zero" } : { ok: true, value };
  }
  // "2,4" / "2.45" with no unit: a decimal of what? Ask rather than guess.
  if (/^\d+[.,]\d{1,2}$/.test(compact)) return { ok: false, reason: "ambiguous" };

  // Number + unit + optional tail digits: "2tr4", "2,4triệu", "1tỷ2", "450k".
  const m = compact.match(/^(\d+)(?:[.,](\d+))?([a-zà-ỹđ]+)(\d+)?$/u);
  if (m) {
    const [, whole, decimals, unitText, tail] = m;
    const unit = UNITS.find((u) => u.re.test(unitText));
    if (!unit || (decimals && tail)) return { ok: false, reason: "unreadable" };
    const fraction = decimals ?? tail ?? "";
    const value = Math.round(Number(`${whole}.${fraction || "0"}`) * unit.factor);
    return value === 0 ? { ok: false, reason: "zero" } : { ok: true, value };
  }

  return { ok: false, reason: "unreadable" };
}

/** Live formatting while typing: plain digits get dot grouping; shorthand is left untouched. */
export function formatTyping(raw: string): string {
  if (!/^[\d.\s]*$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("vi-VN") : "";
}
