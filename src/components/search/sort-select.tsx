"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SearchParams } from "@/lib/search";
import { ClockIcon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/segmented";

type Sort = NonNullable<SearchParams["sort"]>;

const OPTIONS: Array<{ value: Sort; label: string; needsQuery?: boolean }> = [
  { value: "relevance", label: "Phù hợp nhất", needsQuery: true },
  { value: "deal_score", label: "Deal Score cao" },
  { value: "price_asc", label: "Giá thấp → cao" },
  { value: "updated", label: "Mới cập nhật" },
  { value: "price_desc", label: "Giá cao → thấp" },
];

export function SortSelect({ params, baseQuery }: { params: SearchParams; baseQuery: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current: Sort = params.sort ?? (params.q ? "relevance" : "updated");
  const [shown, setShown] = useOptimistic(current);
  const options = OPTIONS.filter((o) => !o.needsQuery || params.q);

  const defaultSort: Sort = params.q ? "relevance" : "updated";
  const hrefFor = (sort: Sort) => {
    const sp = new URLSearchParams(baseQuery);
    if (sort !== defaultSort) sp.set("sort", sort);
    const qs = sp.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  const handlePick = (next: Sort) => {
    if (next === shown) return;
    startTransition(() => {
      setShown(next);
      router.push(hrefFor(next), { scroll: false });
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <SegmentedControl
        label="Sắp xếp"
        value={shown}
        options={options}
        onChange={handlePick}
        disabled={pending}
        size="md"
        className="overflow-x-auto"
      />

      {pending && (
        <p aria-live="polite" className="text-micro text-ink-3">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            Đang sắp xếp lại…
          </span>
        </p>
      )}
    </div>
  );
}
