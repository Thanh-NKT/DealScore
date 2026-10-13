import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { DiscoveryShell } from "@/components/discovery/discovery-shell";
import { PillStripSkeleton } from "@/components/discovery/discovery-skeleton";
import { TRENDING_HEADING } from "@/components/discovery/headings";
import { ProductCardSkeleton } from "@/components/search/product-card-skeleton";

/** /trending while the ranking loads: the real heading at once; the lead depends on the mode, so it is a line shape. */
export default function TrendingLoading() {
  return (
    <LoadingRegion label="Đang tải bảng xếp hạng…" className="flex w-full flex-1 flex-col">
      <DiscoveryShell
        {...TRENDING_HEADING}
        lead={<Skeleton className="mt-1 h-5 w-full max-w-[560px]" />}
        controls={
          <>
            <Skeleton className="h-12 w-full max-w-[420px] rounded-full" />
            <PillStripSkeleton />
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </DiscoveryShell>
    </LoadingRegion>
  );
}
