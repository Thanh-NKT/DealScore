import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ProductCardSkeleton } from "@/components/search/product-card-skeleton";

/**
 * Fallback for every route without its own loading.tsx (home, discovery, account…): a page
 * heading, a lead line and a row of card frames, inside the standard 1440px frame.
 */
export default function Loading() {
  return (
    <LoadingRegion
      label="Đang tải…"
      className="mx-auto w-full max-w-[1440px] flex-1 space-y-8 px-4 py-10 sm:px-6 lg:px-14 lg:py-16"
    >
      <div className="space-y-3">
        <Skeleton className="h-10 w-2/3 max-w-[560px]" />
        <Skeleton className="h-5 w-1/2 max-w-[420px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </LoadingRegion>
  );
}
