import { Skeleton } from "@/components/ui/skeleton";

/** Category pill strip while a discovery list loads (same height as CategoryStrip's pills). */
export function PillStripSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden py-1">
      {["w-16", "w-24", "w-20", "w-28", "w-22"].map((w, i) => (
        <Skeleton key={i} className={`h-10 shrink-0 rounded-full ${w}`} />
      ))}
    </div>
  );
}
