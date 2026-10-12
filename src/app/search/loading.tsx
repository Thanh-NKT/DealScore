import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ProductCardSkeleton } from "@/components/search/product-card-skeleton";

/** /search while results load: the search band, the filter column and six card frames. */
export default function SearchLoading() {
  return (
    <LoadingRegion label="Đang tìm sản phẩm…" className="flex-1">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-[1440px] space-y-3.5 px-4 py-5 sm:px-6 lg:px-14">
          <Skeleton className="h-14 w-full max-w-[820px] rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-20 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-[1440px] items-start gap-7 px-4 py-8 sm:px-6 lg:px-14 md:grid-cols-[248px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)]">
        <Skeleton className="h-[420px] w-full rounded-lg max-md:h-13" />
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-12 w-80 rounded-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
