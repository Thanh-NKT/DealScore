"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SearchParams } from "@/lib/search";
import { ClockIcon } from "@/components/ui/icons";

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
      <div
        role="group"
        aria-label="Sắp xếp"
        className="flex max-w-full items-center gap-1 overflow-x-auto rounded-[12px] bg-surface-2 p-1"
      >
        {options.map((o) => {
          const isActive = shown === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => handlePick(o.value)}
              aria-pressed={isActive}
              disabled={pending}
              className={`h-10 shrink-0 whitespace-nowrap rounded-[8px] px-3.5 text-[14px] transition-all duration-150 ease-out cursor-pointer ${
                isActive
                  ? "bg-primary font-bold text-on-primary shadow-xs"
                  : "bg-transparent font-medium text-ink-2 hover:bg-surface/70 hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      {pending && (
        <p aria-live="polite" className="text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            Đang sắp xếp lại…
          </span>
        </p>
      )}
    </div>
  );
}
