import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/** /account/watch while the list loads: the WatchList frame (sidebar + title, three tiles, rows). */
export default function WatchLoading() {
  return (
    <LoadingRegion label="Đang tải sản phẩm đang theo dõi…" className="w-full flex-1 bg-canvas py-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 items-start gap-8 px-4 sm:px-8 lg:px-14 min-[1080px]:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-6 max-[1079px]:hidden">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-56" />
              <Skeleton className="h-6 w-72" />
            </div>
            <Skeleton className="h-13 w-full max-w-[500px] rounded-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-11 w-full max-w-[520px] rounded-full" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
