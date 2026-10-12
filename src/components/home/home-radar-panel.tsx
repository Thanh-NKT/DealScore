"use client";

import { useState } from "react";
import Link from "next/link";
import type { RadarItem } from "@/lib/discovery";
import { RadarList } from "@/components/discovery/radar-list";
import { TrendDownIcon } from "@/components/ui/icons";
import { pillClass } from "@/components/ui/pill";

type RadarFilter = "all" | "drop20" | "score75" | "buy";

const FILTERS: Array<{ key: RadarFilter; label: string }> = [
  { key: "all", label: "Giảm trên 10%" },
  { key: "drop20", label: "Giảm trên 20%" },
  { key: "score75", label: "Deal Score từ 75" },
  { key: "buy", label: "Nên mua" },
];

const RADAR_PREVIEW_COUNT = 5;

export function HomeRadarPanel({
  items,
  categoryNames,
}: {
  items: RadarItem[];
  categoryNames: Record<string, string>;
}) {
  const [filter, setFilter] = useState<RadarFilter>("all");

  const filtered = items.filter((item) => {
    if (filter === "drop20") return Math.round(item.dropPct * 100) >= 20;
    if (filter === "score75") return (item.score ?? 0) >= 75;
    if (filter === "buy") return item.recommendation === "buy";
    return true;
  });

  const visibleItems = filtered.slice(0, RADAR_PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-6 text-ink sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <span className="eyebrow flex items-center gap-1.5 text-ink-3">
            <TrendDownIcon className="size-3.5 text-buy" strokeWidth={2.4} />
            Radar giảm giá
          </span>
          <h2 className="display text-h2-sm font-bold leading-tight text-ink sm:text-h2">Giảm giá thật hôm nay</h2>
          <p className="max-w-[60ch] text-body-sm leading-normal text-ink-2">
            Giá đang thấp hơn thật so với trung vị 30 ngày hệ thống ghi nhận — không tính chiêu nâng giá rồi gạch.
          </p>
        </div>
        <Link
          href="/radar"
          className="inline-flex h-10 shrink-0 items-center rounded-full border border-line-strong/50 bg-surface px-4 text-label font-semibold text-ink transition-colors hover:border-primary hover:text-primary"
        >
          Xem tất cả →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="flex items-start gap-4 rounded-tile bg-surface-2/70 px-5 py-4">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink-3">
            <TrendDownIcon className="size-5" strokeWidth={2} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-control font-semibold text-ink">Hôm nay chưa có sản phẩm nào giảm giá thật.</p>
            <p className="max-w-[70ch] text-body-sm leading-relaxed text-ink-2">
              DealScore chỉ đưa sản phẩm vào đây khi giá thấp hơn trung vị 30 ngày ít nhất 10%. Danh sách được cập nhật mỗi
              ngày.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Lọc mức giảm" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={pillClass(active)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {visibleItems.length > 0 ? (
            <RadarList items={visibleItems} categoryNames={categoryNames} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2.5 rounded-frame border border-dashed border-line-strong/60 bg-surface/80 py-12 text-center">
              <p className="text-body-sm text-ink-2">Chưa có sản phẩm nào khớp bộ lọc này trong danh sách hôm nay.</p>
              {filter !== "all" && (
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="rounded-full border border-line-strong/50 bg-surface px-4 py-1.5 text-label font-semibold text-ink transition-colors hover:border-primary hover:text-primary cursor-pointer"
                >
                  Xem lại tất cả mức giảm
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
