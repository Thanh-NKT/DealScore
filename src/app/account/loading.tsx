import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

/**
 * /account and its settings pages while they load: back link, heading, lead, then two panels — the
 * narrow account frame instead of the root fallback's product grid.
 */
export default function AccountLoading() {
  return (
    <LoadingRegion label="Đang tải tài khoản…" className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-5 w-full max-w-[460px]" />
      </div>
      <Skeleton className="h-56 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </LoadingRegion>
  );
}
