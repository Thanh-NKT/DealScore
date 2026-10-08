import type { UnitPrice } from "@/lib/pricing/unit-price";

/** "≈ 3.120 đ/miếng" (P4 G). Never rendered for an unparsed variant — no placeholder. */
export function unitPriceLabel(u: UnitPrice): string {
  return `≈ ${u.label}`;
}

export function UnitPriceNote({ unitPrice, variantKey, className = "" }: { unitPrice: UnitPrice | null | undefined; variantKey: string; className?: string }) {
  if (!unitPrice) return null;
  return (
    <p title={`Tính từ “${variantKey}”`} className={`num text-micro text-ink-3 ${className}`}>
      {unitPriceLabel(unitPrice)}
    </p>
  );
}
