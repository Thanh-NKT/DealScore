/**
 * Human label for a `product_variants.variant_key`.
 * Keys arrive as "capacity=2TB, color=black", "dung-luong=512GB" (seed) or a marketplace model name
 * ("Đen,XL"). Attribute slugs mean nothing to shoppers, so only the values are shown, joined by " · ".
 * A comma between two digits is a Vietnamese decimal ("5,2L"), never a separator.
 */
const SEPARATOR = /\s*(?:[|;]|(?<!\d),|,(?!\d))\s*/;

export function variantLabel(key: string | null | undefined): string {
  const raw = key?.trim();
  if (!raw) return "Tiêu chuẩn";
  if (!raw.includes("=")) return raw.split(SEPARATOR).filter(Boolean).join(" · ");

  const values = raw
    .split(SEPARATOR)
    .map((part) => {
      const [, ...rest] = part.split("=");
      return (rest.length > 0 ? rest.join("=") : part).trim();
    })
    .filter(Boolean);
  return values.length > 0 ? values.join(" · ") : raw;
}
