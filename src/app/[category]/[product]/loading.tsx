import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/**
 * Product page while the server fetches prices: the hero frame (gallery + decision column with
 * the price box) so the answer's place is visible at once, then the chart / reasons pair.
 */
export default function ProductLoading() {
  return (
    <LoadingRegion
      label="Đang tải giá và Deal Score…"
      className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-5 sm:px-6 lg:px-14"
    >
      <Skeleton className="mb-5 h-4 w-64" />
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-1 gap-8 rounded-hero border border-line bg-surface p-5 sm:p-7 min-[1121px]:grid-cols-[460px_minmax(0,1fr)] min-[1121px]:gap-10">
          <Skeleton className="h-[320px] w-full rounded-frame max-[1120px]:order-2 sm:h-[380px]" />
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-44 rounded-full" />
            </div>
            <Skeleton className="h-8 w-4/5" />
            <Skeleton className="h-4 w-56" />
            <div className="flex gap-2.5">
              <Skeleton className="h-11 w-36 rounded-md" />
              <Skeleton className="h-11 w-36 rounded-md" />
            </div>
            <div className="flex flex-col gap-4 rounded-frame border border-line p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-11 w-56" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="size-[88px] rounded-full" />
              </div>
              <Skeleton className="h-16 w-full rounded-tile" />
              <div className="flex gap-2.5">
                <Skeleton className="h-13 flex-[1.2] rounded-md" />
                <Skeleton className="h-13 flex-1 rounded-md" />
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 min-[1121px]:grid-cols-[1fr_420px]">
          <Skeleton className="h-[420px] w-full rounded-lg" />
          <Skeleton className="h-[420px] w-full rounded-lg" />
        </div>
      </div>
    </LoadingRegion>
  );
}
