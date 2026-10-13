import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { DiscoveryShell } from "@/components/discovery/discovery-shell";
import { PillStripSkeleton } from "@/components/discovery/discovery-skeleton";
import { RADAR_HEADING } from "@/components/discovery/headings";

/** /radar while the list loads: the real heading at once, then category pills and list rows. */
export default function RadarLoading() {
  return (
    <LoadingRegion label="Đang tải danh sách giảm giá…" className="flex w-full flex-1 flex-col">
      <DiscoveryShell {...RADAR_HEADING}>
        <div className="space-y-5">
          <PillStripSkeleton />
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-tile border border-line bg-surface">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="size-16 shrink-0 rounded-tile" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-8 w-28 max-sm:hidden" />
                <Skeleton className="size-12 shrink-0 rounded-full" />
              </li>
            ))}
          </ul>
        </div>
      </DiscoveryShell>
    </LoadingRegion>
  );
}
