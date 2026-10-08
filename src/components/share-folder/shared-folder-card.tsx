import Link from "next/link";
import { ProductImage } from "@/components/ui/product-image";
import { VerdictTag } from "@/components/product/verdict-tag";
import { formatVnd } from "@/lib/format";
import { sharedItemView, type SharedFolderItem } from "@/lib/share-folder/view";

/** Read-only card of a shared folder (UI spec §2.2). Links to the plain product page (no /go, no watch=). */
export function SharedFolderCard({ item, now }: { item: SharedFolderItem; now: Date }) {
  const copy = sharedItemView(item, now, formatVnd);
  return (
    <Link
      href={item.href}
      className="group flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-3.5 text-ink transition-colors duration-150 ease-out hover:border-primary/45"
    >
      <div className="relative h-[168px] w-full overflow-hidden rounded-tile border border-line/60 bg-surface-2">
        <ProductImage src={item.image} className="size-full p-4" iconClassName="size-12 text-ink-3/60" />
        {copy.statusChip ? (
          <span className="absolute left-2.5 top-2.5 rounded-full border border-line bg-surface px-2.5 py-1 text-label font-semibold text-ink-2">
            {copy.statusChip}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="line-clamp-2 text-body font-semibold text-ink">{item.productName}</p>
        {item.variantKey ? <p className="truncate text-body-sm text-ink-3">{item.variantKey}</p> : null}
      </div>
      {copy.priceLine ? <p className="num text-h4 font-bold text-ink">{copy.priceLine}</p> : null}
      {item.verdict ? (
        "insufficient" in item.verdict ? (
          <p className="text-body-sm text-ink-3">Chưa đủ dữ liệu</p>
        ) : (
          <VerdictTag recommendation={item.verdict.recommendation} size="sm" />
        )
      ) : null}
      {copy.targetLine ? (
        <p className="text-body-sm text-ink-2">
          <span className="num">{copy.targetLine}</span>
          {copy.reachedLine ? <span className="ml-2 font-semibold text-buy">{copy.reachedLine}</span> : null}
        </p>
      ) : null}
      {item.note ? (
        <blockquote className="border-l-2 border-line-strong pl-3 text-body-sm text-ink-2">{item.note}</blockquote>
      ) : null}
      {copy.staleLine ? <p className="text-body-sm text-ink-3">{copy.staleLine}</p> : null}
    </Link>
  );
}
