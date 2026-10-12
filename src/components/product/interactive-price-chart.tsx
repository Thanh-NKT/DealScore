"use client";

import { useId, useMemo, useState, type KeyboardEvent, type MouseEvent, type TouchEvent } from "react";
import { historyStats, type DailyPriceRow } from "@/lib/pricing/price-history";
import { buildChartSeries } from "@/lib/pricing/chart-series";
import { formatVnd } from "@/lib/format";
import { SegmentedControl } from "@/components/ui/segmented";

export type ChartRange = 7 | 30 | 90;

interface InteractivePriceChartProps {
  rows: DailyPriceRow[];
  initialRange?: ChartRange;
  variantTitle?: string;
  currentPrice?: number | null;
  /** The current price is a flash-sale price: drawn as a flash marker, not on the regular line. */
  currentIsFlashSale?: boolean;
  /** The page's "now" (ISO), so server and client render the same Vietnam day. Defaults to now. */
  nowIso?: string;
}

const H = 280;
const W = 800;
const PAD = 24;

function formatDay(day: string): string {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

/**
 * "Lịch sử giá": the last N calendar days (Vietnam time) from buildChartSeries — x is the day, gaps
 * break the line, flash-sale days are markers — and low / median / high from historyStats(), the same
 * window and median the Deal Score uses.
 */
export function InteractivePriceChart({
  rows,
  initialRange = 90,
  variantTitle,
  currentPrice,
  currentIsFlashSale = false,
  nowIso,
}: InteractivePriceChartProps) {
  const uid = useId();
  const [range, setRange] = useState<ChartRange>(initialRange);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const now = useMemo(() => (nowIso ? new Date(nowIso) : new Date()), [nowIso]);
  const current = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;

  const series = useMemo(
    () => buildChartSeries(rows, range, now, { currentPrice: current, currentIsFlashSale }),
    [rows, range, now, current, currentIsFlashSale],
  );
  const history = useMemo(() => historyStats(rows, now, range), [rows, now, range]);

  const points = series.points;
  const m = points.length;
  const last = m > 0 ? points[m - 1] : null;
  const fallback = current ?? last?.price ?? 0;
  const lo = history.low ?? fallback;
  const hi = history.high ?? fallback;
  const med = history.median ?? fallback;
  const compared = current != null && !currentIsFlashSale ? current : (last?.price ?? null);
  const diffMedPct = compared != null && med > 0 ? ((compared - med) / med) * 100 : 0;

  const scaleLo = Math.min(lo, series.min ?? lo);
  const scaleHi = Math.max(hi, series.max ?? hi);
  const minVal = Math.min(scaleLo * 0.98, scaleLo);
  const maxVal = Math.max(scaleHi * 1.02, scaleHi + 1000);
  const span = series.spanDays;

  const getY = (val: number) => (maxVal === minVal ? H / 2 : PAD + ((maxVal - val) / (maxVal - minVal)) * (H - 2 * PAD));
  const getX = (x: number) => (span > 0 ? (x / span) * W : W / 2);

  const lines = series.segments.map((seg) => seg.map((p) => `${getX(p.x).toFixed(1)},${getY(p.price).toFixed(1)}`));

  let lowestIdx = -1;
  for (let i = 0; i < m; i++) {
    if (lowestIdx < 0 || points[i].price < points[lowestIdx].price) lowestIdx = i;
  }

  const activeIdx = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < m ? hoverIndex : m - 1;
  const activeItem = m > 0 ? points[activeIdx] : null;
  const daysAgo = activeItem ? span - activeItem.x : 0;
  const hoverDateLabel = !activeItem
    ? "Hôm nay"
    : daysAgo === 0
      ? "Hôm nay"
      : daysAgo === 1
        ? "Hôm qua"
        : `${formatDay(activeItem.day)} (${daysAgo} ngày trước)`;

  /** Nearest plotted day to a horizontal position. */
  const handlePointer = (clientX: number, rect: DOMRect) => {
    if (m === 0) return;
    const target = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * span;
    let best = 0;
    for (let i = 1; i < m; i++) {
      if (Math.abs(points[i].x - target) < Math.abs(points[best].x - target)) best = i;
    }
    setHoverIndex(best);
  };

  const onMouseMove = (e: MouseEvent<SVGRectElement>) => handlePointer(e.clientX, e.currentTarget.getBoundingClientRect());
  const onTouchMove = (e: TouchEvent<SVGRectElement>) => {
    if (e.touches.length > 0) handlePointer(e.touches[0].clientX, e.currentTarget.getBoundingClientRect());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (m === 0) return;
    const at = hoverIndex ?? m - 1;
    const next =
      e.key === "ArrowLeft" ? Math.max(0, at - 1)
      : e.key === "ArrowRight" ? Math.min(m - 1, at + 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? m - 1
      : null;
    if (next == null) return;
    e.preventDefault();
    setHoverIndex(next);
  };

  const hoverX = activeItem ? getX(activeItem.x) : W / 2;
  const hoverY = getY(activeItem?.price ?? lo);
  const dataDays = history.dayCount;

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 sm:p-7">
      {/* Header with Variant & Range Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h2 className="display text-h3 font-semibold text-ink">Lịch sử giá</h2>
            {variantTitle && (
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-micro font-semibold text-ink-2">
                {variantTitle}
              </span>
            )}
          </div>
          <span className="text-label text-ink-3">
            {dataDays < range
              ? `Mới có ${dataDays} ngày dữ liệu trong ${range} ngày qua. Rê chuột hoặc dùng phím mũi tên để xem giá từng ngày.`
              : "Giá thấp nhất mỗi ngày trên các nơi bán đã gom. Rê chuột hoặc dùng phím mũi tên để xem từng ngày."}
          </span>
        </div>

        <SegmentedControl
          label="Khoảng thời gian"
          value={range}
          options={([7, 30, 90] as const).map((r) => ({ value: r, label: `${r} ngày` }))}
          onChange={(r) => {
            setRange(r);
            setHoverIndex(null);
          }}
          segmentClassName="min-w-[68px]"
        />
      </div>

      {/* 4 Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-tile bg-buy-soft p-3 sm:px-4">
          <span className="text-micro font-semibold text-buy">Thấp nhất</span>
          <span className="num display text-title font-bold text-buy">{formatVnd(lo)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-tile bg-surface-2/70 p-3 sm:px-4">
          <span className="text-micro font-semibold text-ink-3">Giá trung vị</span>
          <span className="num display text-title font-bold text-ink">{formatVnd(med)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-tile bg-surface-2/70 p-3 sm:px-4">
          <span className="text-micro font-semibold text-ink-3">Cao nhất</span>
          <span className="num display text-title font-bold text-ink">{formatVnd(hi)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-tile bg-surface-2/70 p-3 sm:px-4">
          <span className="text-micro font-semibold text-ink-3">So với giá trung vị</span>
          <span className={`num display text-title font-bold ${diffMedPct <= 0 ? "text-buy" : "text-avoid"}`}>
            {diffMedPct <= 0 ? "−" : "+"}
            {Math.abs(diffMedPct).toFixed(1).replace(".", ",")}%
          </span>
        </div>
      </div>

      {/* Active Point Inspector Card (announced to screen readers as it changes) */}
      <div
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-tile border border-line px-4 py-2.5 text-label text-ink"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <span className="size-2.5 rounded-full bg-surface ring-[2.5px] ring-primary" />
          <span>
            Ngày: <strong className="font-semibold text-ink">{hoverDateLabel}</strong>
          </span>
        </span>
        <span>
          Giá ghi nhận:{" "}
          <strong className="num text-body font-bold text-ink">{formatVnd(activeItem?.price ?? (current ?? null))}</strong>
        </span>
        <span className="text-ink-3">{activeItem?.current ? "Giá hiện tại" : "Thấp nhất trong ngày"}</span>
      </div>

      {/* SVG Chart with Crosshair & Interactivity */}
      <div
        className="relative h-[280px] w-full rounded-sm pl-24 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        tabIndex={m > 0 ? 0 : undefined}
        role="group"
        aria-label={`Biểu đồ lịch sử giá ${range} ngày. Dùng phím mũi tên trái, phải để xem từng ngày.`}
        onKeyDown={onKeyDown}
        onBlur={() => setHoverIndex(null)}
      >
        {/* Y-axis Labels */}
        <span style={{ top: `${Math.max(4, Math.min(250, getY(hi) - 10))}px` }} className="absolute left-0 text-micro text-ink-3">
          {formatVnd(hi)}
        </span>
        <span
          style={{ top: `${Math.max(4, Math.min(250, getY(med) - 10))}px` }}
          className="absolute left-0 text-micro font-semibold text-ink-2"
        >
          {formatVnd(med)}
        </span>
        <span
          style={{ top: `${Math.max(4, Math.min(250, getY(lo) - 10))}px` }}
          className="absolute left-0 text-micro font-semibold text-buy"
        >
          {formatVnd(lo)}
        </span>

        <svg
          width="100%"
          height="280"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="overflow-visible"
        >
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Background Grid Lines */}
          <line x1="0" x2={W} y1={getY(hi)} y2={getY(hi)} stroke="var(--line)" strokeWidth="1" />
          <line x1="0" x2={W} y1={getY(lo)} y2={getY(lo)} stroke="var(--line)" strokeWidth="1" />
          <line
            x1="0"
            x2={W}
            y1={getY(med)}
            y2={getY(med)}
            stroke="var(--line-strong)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
          />

          {/* One area + line per continuous segment: a day without data is a gap, never interpolated */}
          {lines.map((pts, i) =>
            pts.length >= 2 ? (
              <g key={`seg-${i}`} data-segment="">
                <path
                  d={`M ${pts[0].split(",")[0]},${H} L ${pts.join(" L ")} L ${pts[pts.length - 1].split(",")[0]},${H} Z`}
                  fill={`url(#${uid}-area)`}
                />
                <polyline
                  points={pts.join(" ")}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : (
              <circle
                key={`seg-${i}`}
                data-segment=""
                cx={pts[0].split(",")[0]}
                cy={pts[0].split(",")[1]}
                r="3.5"
                fill="var(--primary)"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}

          {/* Flash-sale days: markers only, they are not part of the regular history */}
          {series.flashMarkers.map((f) => (
            <circle
              key={`flash-${f.day}`}
              data-flash=""
              cx={getX(f.x)}
              cy={getY(f.price)}
              r="4.5"
              fill="var(--wait)"
              stroke="var(--surface)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Lowest Point Ring */}
          {lowestIdx >= 0 && (
            <circle
              cx={getX(points[lowestIdx].x)}
              cy={getY(points[lowestIdx].price)}
              r="6"
              fill="var(--surface)"
              stroke="var(--buy)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Current Point Dot */}
          {last && (
            <circle
              cx={getX(last.x)}
              cy={getY(last.price)}
              r="7"
              fill="var(--surface)"
              stroke="var(--primary)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Hover Crosshair & Dot */}
          {hoverIndex !== null && activeItem && (
            <>
              <line
                x1={hoverX}
                x2={hoverX}
                y1="0"
                y2={H}
                stroke="var(--ink-3)"
                strokeWidth="1"
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={hoverX}
                cy={hoverY}
                r="7"
                fill="var(--surface)"
                stroke="var(--primary)"
                strokeWidth="2.5"
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

      {/* X-axis date labels: x is the calendar day, so even spacing is true spacing */}
      <div className="flex justify-between pl-24 text-micro text-ink-3">
        <span>{range} ngày trước</span>
        <span>{Math.round((range * 2) / 3)} ngày trước</span>
        <span>{Math.round(range / 3)} ngày trước</span>
        <span>Hôm nay</span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-5 pl-24 pt-1 text-label text-ink-2">
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
          <span className="size-2.5 rounded-full bg-surface ring-[2.5px] ring-primary" />
          <span>Ngày đang xem</span>
        </span>
        {series.flashMarkers.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-wait" />
            <span>Flash sale (không tính vào lịch sử giá)</span>
          </span>
        )}
      </div>
    </div>
  );
}
