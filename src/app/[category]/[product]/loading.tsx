import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/**
 * Product page while the server fetches prices: the hero frame (title + gallery on the left, the
 * decision panel on the right: head, price + gauge, verdict, actions, evidence) so the answer's place
 * is visible at once, then the marketplace face-off.
 */
export default function ProductLoading() {
  return (
    <LoadingRegion
      label="Đang tải giá và Deal Score…"
      className="mx-auto w-full max-w-[1440px] px-4 pb-24 pt-6 sm:px-6 lg:px-14"
    >
      <Skeleton className="mb-6 h-4 w-64" />
      <div className="flex flex-col gap-12">
        <div className="grid grid-cols-1 gap-8 min-[1121px]:grid-cols-[minmax(0,1fr)_minmax(0,560px)] min-[1121px]:gap-12">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-44 rounded-full" />
            </div>
            <Skeleton className="h-11 w-4/5" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="mt-2 h-[320px] w-full max-w-[640px] rounded-hero sm:h-[440px]" />
          </div>
          <div className="flex flex-col overflow-hidden rounded-hero border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-7">
              <Skeleton className="h-3 w-28" />
              <div className="flex gap-1">
                <Skeleton className="size-5 rounded-xs" />
                <Skeleton className="size-5 rounded-xs" />
              </div>
            </div>
            <div className="flex flex-col gap-5 p-5 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-12 w-60" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="size-[104px] rounded-full" />
              </div>
              <Skeleton className="h-[88px] w-full rounded-tile" />
            </div>
            <div className="flex gap-2.5 border-t border-line p-5 sm:px-7">
              <Skeleton className="h-13 flex-[1.2] rounded-full" />
              <Skeleton className="h-13 flex-1 rounded-full" />
              <Skeleton className="size-13 rounded-full" />
            </div>
            <div className="flex flex-col gap-3 border-t border-line p-5 sm:px-7">
              <Skeleton className="h-[64px] w-full rounded-tile" />
              <Skeleton className="h-[120px] w-full rounded-tile" />
            </div>
          </div>
        </div>
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </div>
    </LoadingRegion>
  );
}
