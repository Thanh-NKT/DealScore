"use client";

import { useState } from "react";
import Link from "next/link";
import type { RadarItem } from "@/lib/discovery";
import { RadarList } from "@/components/discovery/radar-list";
import { TrendDownIcon } from "@/components/ui/icons";

type RadarFilter = "all" | "drop20" | "score75" | "buy";

const FILTERS: Array<{ key: RadarFilter; label: string }> = [
  { key: "all", label: "Giảm trên 10%" },
  { key: "drop20", label: "Giảm trên 20%" },
  { key: "score75", label: "Deal Score từ 75" },
  { key: "buy", label: "Nên mua ngay" },
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
    <div className="flex flex-col gap-5 rounded-[20px] border border-line bg-surface p-6 text-ink sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-soft/70 px-3 py-1 text-[12px] font-bold text-primary">
            <TrendDownIcon className="size-3.5 text-buy" strokeWidth={2.4} />
            <span>Radar theo dõi giá 30 ngày</span>
          </div>
          <h2 className="display text-[26px] font-bold leading-[1.2] tracking-tight text-ink sm:text-[28px]">
            Giảm giá <span className="text-gradient-primary">thật hôm nay</span>
          </h2>
          <p className="max-w-[60ch] text-[14px] leading-normal text-ink-2">
            Giá đang thấp hơn thật so với trung vị 30 ngày hệ thống ghi nhận — không tính chiêu nâng giá rồi gạch.
          </p>
        </div>
        <Link
          href="/radar"
          className="inline-flex h-9 shrink-0 items-center rounded-[10px] border border-line-strong/50 bg-surface px-3.5 text-[13px] font-semibold text-primary shadow-2xs transition-colors hover:border-primary/40 hover:bg-primary-soft/60"
        >
          Xem tất cả ({items.length}) →
        </Link>
      </div>

      <div role="group" aria-label="Lọc mức giảm" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={`h-9 rounded-full border px-4 text-[13px] transition-all cursor-pointer ${
                active
                  ? "border-primary bg-primary font-bold text-on-primary shadow-xs"
                  : "border-line bg-surface/90 font-medium text-ink-2 hover:border-primary/35 hover:text-primary"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {visibleItems.length > 0 ? (
        <RadarList items={visibleItems} categoryNames={categoryNames} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2.5 rounded-[16px] border border-dashed border-line-strong/60 bg-surface/80 py-12 text-center">
          <p className="text-[14px] text-ink-2">
            Chưa có sản phẩm nào khớp bộ lọc này trong danh sách hôm nay.
          </p>
          {filter !== "all" && (
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="rounded-[8px] border border-primary/30 bg-primary-soft/60 px-3.5 py-1.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary-soft cursor-pointer"
            >
              Xem lại tất cả mức giảm
            </button>
          )}
        </div>
      )}
    </div>
  );
}
