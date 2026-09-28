"use client";

import { useId, useMemo, useState, type MouseEvent, type TouchEvent } from "react";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { formatVnd } from "@/lib/format";

interface InteractivePriceChartProps {
  rows: DailyPriceRow[];
  initialRange?: 7 | 30 | 90;
  variantTitle?: string;
  currentPrice?: number | null;
}

export function InteractivePriceChart({
  rows,
  initialRange = 90,
  variantTitle,
  currentPrice,
}: InteractivePriceChartProps) {
  const uid = useId();
  const [range, setRange] = useState<7 | 30 | 90>(initialRange);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Parse rows to sorted points
  const points = useMemo(() => {
    const valid: { day: string; price: number; hasFlash: boolean }[] = rows
      .filter((r) => r.min_price != null && Number.isFinite(r.min_price) && (r.min_price as number) > 0)
      .map((r) => ({
        day: r.day,
        price: Number(r.min_price),
        hasFlash: Boolean(r.has_flash_sale),
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    // If current price is provided and not in rows, append today
    if (currentPrice && currentPrice > 0) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (valid.length === 0 || valid[valid.length - 1].day !== todayStr) {
        valid.push({ day: todayStr, price: currentPrice, hasFlash: false });
      }
    }

    return valid;
  }, [rows, currentPrice]);

  // Slice for selected period
  const activePoints = useMemo(() => {
    if (points.length <= range) return points;
    return points.slice(-range);
  }, [points, range]);

  // Calculations for scale, median, min, max
  const stats = useMemo(() => {
    if (activePoints.length === 0) {
      const fallback = currentPrice && currentPrice > 0 ? currentPrice : 0;
      return {
        lo: fallback,
        hi: fallback,
        med: fallback,
        diffMedPct: 0,
      };
    }
    const prices: number[] = activePoints.map((p) => p.price);
    const sorted = [...prices].sort((a, b) => a - b);
    const lo = sorted[0] ?? 0;
    const hi = sorted[sorted.length - 1] ?? 0;
    const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const cur = prices[prices.length - 1] ?? 0;
    const diffMedPct = med > 0 ? ((cur - med) / med) * 100 : 0;
    return { lo, hi, med, diffMedPct };
  }, [activePoints, currentPrice]);

  const m = activePoints.length;
  const H = 280;
  const W = 800;
  const pad = 24;

  const minVal = Math.min(stats.lo * 0.98, stats.lo);
  const maxVal = Math.max(stats.hi * 1.02, stats.hi + 1000);

  const getY = (val: number) => {
    if (maxVal === minVal) return H / 2;
    return pad + ((maxVal - val) / (maxVal - minVal)) * (H - 2 * pad);
  };

  const getX = (idx: number) => {
    if (m <= 1) return W / 2;
    return (idx / (m - 1)) * W;
  };

  const polylinePts = useMemo(() => {
    if (m === 0) return "";
    return activePoints.map((p, i) => `${getX(i).toFixed(1)},${getY(p.price).toFixed(1)}`).join(" ");
  }, [activePoints, minVal, maxVal]);

  const areaPath = useMemo(() => {
    if (!polylinePts || m === 0) return "";
    return `M 0,${H} L ${polylinePts.split(" ").join(" L ")} L ${W},${H} Z`;
  }, [polylinePts, m]);

  // Find lowest point index
  const lowestIdx = useMemo(() => {
    if (m === 0) return 0;
    let minIdx = 0;
    for (let i = 1; i < m; i++) {
      if (activePoints[i].price < activePoints[minIdx].price) {
        minIdx = i;
      }
    }
    return minIdx;
  }, [activePoints, m]);

  // Hover position & active item
  const activeIdx = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < m ? hoverIndex : m - 1;
  const activeItem = (m > 0 && activePoints[activeIdx]) ? activePoints[activeIdx] : { day: "Hôm nay", price: stats.lo };
  const hoverX = getX(activeIdx);
  const hoverY = getY(activeItem.price);

  const handlePointer = (clientX: number, rect: DOMRect) => {
    if (m <= 1) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (m - 1));
    setHoverIndex(idx);
  };

  const onMouseMove = (e: MouseEvent<SVGRectElement>) => {
    handlePointer(e.clientX, e.currentTarget.getBoundingClientRect());
  };

  const onTouchMove = (e: TouchEvent<SVGRectElement>) => {
    if (e.touches.length > 0) {
      handlePointer(e.touches[0].clientX, e.currentTarget.getBoundingClientRect());
    }
  };

  const formatDay = (dayStr: string) => {
    try {
      const parts = dayStr.split("-");
      if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
    } catch {}
    return dayStr;
  };

  const daysDiff = m > 0 && activeIdx < m - 1 ? m - 1 - activeIdx : 0;
  const hoverDateLabel =
    activeIdx === m - 1
      ? "Hôm nay"
      : daysDiff === 1
        ? "Hôm qua"
        : `${formatDay(activeItem.day)} (${daysDiff} ngày trước)`;

  return (
    <div className="flex flex-col gap-5 rounded-[20px] border border-line bg-surface p-6 sm:p-7">
      {/* Header with Variant & Range Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h2 className="display text-[22px] font-bold tracking-tight text-ink">Lịch sử giá</h2>
            {variantTitle && (
              <span className="rounded-[8px] border border-line bg-surface-2 px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">
                {variantTitle}
              </span>
            )}
          </div>
          <span className="text-[13px] text-ink-3">
            {m < range
              ? `Mới có ${m} ngày dữ liệu. Rê chuột lên biểu đồ để xem giá từng ngày.`
              : "Giá thấp nhất mỗi ngày trên các nơi bán đã gom. Rê chuột để xem từng ngày."}
          </span>
        </div>

        <div role="group" aria-label="Khoảng thời gian" className="flex gap-1 rounded-[12px] bg-surface-2 p-1">
          {([7, 30, 90] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRange(r);
                setHoverIndex(null);
              }}
              aria-pressed={range === r}
              className={`min-w-[68px] h-10 rounded-[8px] text-[13px] font-semibold transition-colors cursor-pointer ${
                range === r
                  ? "bg-surface text-ink shadow-xs"
                  : "bg-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {r} ngày
            </button>
          ))}
        </div>
      </div>

      {/* 4 Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-[12px] bg-buy-soft p-3 sm:px-3.5">
          <span className="text-[12px] font-semibold text-buy">Thấp nhất</span>
          <span className="num display text-[18px] font-bold text-buy">{formatVnd(stats.lo)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[12px] bg-surface-2 p-3 sm:px-3.5">
          <span className="text-[12px] font-semibold text-ink-3">Giá trung vị</span>
          <span className="num display text-[18px] font-bold text-ink">{formatVnd(stats.med)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[12px] bg-surface-2 p-3 sm:px-3.5">
          <span className="text-[12px] font-semibold text-ink-3">Cao nhất</span>
          <span className="num display text-[18px] font-bold text-ink">{formatVnd(stats.hi)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[12px] bg-surface-2 p-3 sm:px-3.5">
          <span className="text-[12px] font-semibold text-ink-3">So với giá trung vị</span>
          <span
            className={`num display text-[18px] font-bold ${
              stats.diffMedPct <= 0 ? "text-buy" : "text-avoid"
            }`}
          >
            {stats.diffMedPct <= 0 ? "−" : "+"}
            {Math.abs(stats.diffMedPct).toFixed(1).replace(".", ",")}%
          </span>
        </div>
      </div>

      {/* Active Point Inspector Card */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[12px] bg-surface-2 px-4 py-2.5 text-[13px] text-ink">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="size-2 rounded-full bg-primary" />
          <span>
            Ngày: <strong className="font-semibold text-ink">{hoverDateLabel}</strong>
          </span>
        </span>
        <span>
          Giá ghi nhận:{" "}
          <strong className="num text-[16px] font-bold text-primary">{formatVnd(activeItem.price)}</strong>
        </span>
        <span className="text-ink-3">
          {activeIdx === m - 1 ? "Giá hiện tại" : "Thấp nhất trong ngày"}
        </span>
      </div>

      {/* SVG Chart with Crosshair & Interactivity */}
      <div className="relative h-[280px] w-full pl-24">
        {/* Y-axis Labels */}
        <span
          style={{ top: `${Math.max(4, Math.min(250, getY(stats.hi) - 10))}px` }}
          className="absolute left-0 text-[12px] text-ink-3"
        >
          {formatVnd(stats.hi)}
        </span>
        <span
          style={{ top: `${Math.max(4, Math.min(250, getY(stats.med) - 10))}px` }}
          className="absolute left-0 text-[12px] font-semibold text-ink-2"
        >
          {formatVnd(stats.med)}
        </span>
        <span
          style={{ top: `${Math.max(4, Math.min(250, getY(stats.lo) - 10))}px` }}
          className="absolute left-0 text-[12px] font-semibold text-buy"
        >
          {formatVnd(stats.lo)}
        </span>

        <svg
          width="100%"
          height="280"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Biểu đồ lịch sử giá ${range} ngày`}
          className="overflow-visible"
        >
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Background Grid Lines */}
          <line x1="0" x2={W} y1={getY(stats.hi)} y2={getY(stats.hi)} stroke="var(--line)" strokeWidth="1" />
          <line x1="0" x2={W} y1={getY(stats.lo)} y2={getY(stats.lo)} stroke="var(--line)" strokeWidth="1" />
          <line
            x1="0"
            x2={W}
            y1={getY(stats.med)}
            y2={getY(stats.med)}
            stroke="var(--line-strong)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
          />

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill={`url(#${uid}-area)`} />}

          {/* Main Line */}
          {polylinePts && (
            <polyline
              points={polylinePts}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Lowest Point Ring */}
          {m > 0 && (
            <circle
              cx={getX(lowestIdx)}
              cy={getY(activePoints[lowestIdx].price)}
              r="6"
              fill="var(--surface)"
              stroke="var(--buy)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Current Point Dot */}
          {m > 0 && (
            <circle
              cx={getX(m - 1)}
              cy={getY(activePoints[m - 1].price)}
              r="7"
              fill="var(--primary)"
              stroke="var(--surface)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Hover Crosshair & Dot */}
          {hoverIndex !== null && (
            <>
              <line
                x1={hoverX}
                x2={hoverX}
                y1="0"
                y2={H}
                stroke="var(--primary)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoverX}
                cy={hoverY}
                r="7"
                fill="var(--primary)"
                stroke="var(--surface)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}

          {/* Interactive Mouse & Touch Capture Plane */}
          <rect
            x="0"
            y="0"
            width={W}
            height={H}
            fill="transparent"
            className="cursor-crosshair"
            onMouseMove={onMouseMove}
            onTouchMove={onTouchMove}
            onMouseLeave={() => setHoverIndex(null)}
          />
        </svg>
      </div>

      {/* X-axis date labels */}
      <div className="flex justify-between pl-24 text-[12px] text-ink-3">
        <span>{range} ngày trước</span>
        <span>{Math.round((range * 2) / 3)} ngày trước</span>
        <span>{Math.round(range / 3)} ngày trước</span>
        <span>Hôm nay</span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 pl-24 pt-1 text-[13px] text-ink-2">
        <span className="flex items-center gap-2">
          <span className="h-[3px] w-4.5 rounded-full bg-primary" />
          <span>Giá thấp nhất mỗi ngày</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="w-4.5 border-t-2 border-dashed border-line-strong" />
          <span>Giá trung vị</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border-2 border-buy bg-surface" />
          <span>Giá thấp nhất</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-primary" />
          <span>Ngày đang xem</span>
        </span>
      </div>
    </div>
  );
}
