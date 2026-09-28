import { Skeleton } from "@/components/ui/skeleton";

/** Same frame as ProductCard (image stage, 2-line title, verdict pill, price capsule, footer). */
export function ProductCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-3.5">
      <Skeleton className="h-[204px] w-full rounded-tile" />
      <div className="flex flex-col gap-2.5 px-0.5">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-1 h-7 w-28 rounded-full" />
        <div className="flex items-center justify-between gap-3 rounded-md border border-line/80 p-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="size-12 rounded-full" />
        </div>
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  );
}
