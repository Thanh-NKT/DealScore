import Link from "next/link";
import { formatVnd } from "@/lib/format";

interface VariantPickerProps {
  variants: Array<{
    id: string;
    variantKey: string;
    price: number | null;
    inStock: boolean;
  }>;
  selectedId: string;
  range: 7 | 30 | 90;
}

export function VariantPicker({
  variants,
  selectedId,
  range,
}: VariantPickerProps) {
  // Fewer than 2 variants: no picker needed
  if (!variants || variants.length < 2) {
    return null;
  }

  return (
    <nav aria-label="Chọn phiên bản" className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">
        Phiên bản
      </div>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => {
          const isSelected = v.id === selectedId;

          let badgeText = v.price != null ? formatVnd(v.price) : "chưa có giá";
          if (!v.inStock) {
            badgeText = "Hết hàng";
          }

          return (
            <Link
              key={v.id}
              href={`?variant=${v.id}&range=${range}`}
              aria-current={isSelected ? "true" : undefined}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                isSelected
                  ? "border-foreground bg-foreground text-background font-semibold shadow-sm"
                  : "border-border bg-background text-foreground hover:bg-black/5 dark:hover:bg-white/5"
              } ${!v.inStock ? "opacity-60" : ""}`}
            >
              <span>{v.variantKey}</span>
              <span
                className={`text-[11px] ${
                  isSelected ? "opacity-80" : "text-muted"
                }`}
              >
                ({badgeText})
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
