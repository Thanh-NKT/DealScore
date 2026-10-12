import { Skeleton } from "@/components/ui/skeleton";

/** Same frame as ProductCard (full-bleed image, 2-line title, price capsule + gauge, footer; a row on phones). */
export function ProductCardSkeleton() {
  return (
    <div className="flex min-w-0 overflow-hidden rounded-lg border border-line bg-surface max-sm:flex-row sm:flex-col">
      <Skeleton className="shrink-0 max-sm:w-[112px] max-sm:self-stretch sm:aspect-[4/3] sm:w-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 max-sm:p-3">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
        <div className="mt-1 flex items-center justify-between gap-3 rounded-tile bg-surface-2/70 p-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="size-14 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-xs" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    </div>
  );
}
