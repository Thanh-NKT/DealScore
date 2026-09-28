"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatVnd } from "@/lib/format";

export interface HoverPoint {
  /** Coordinates in the chart's viewBox units. */
  x: number;
  y: number;
  day: string; // 'YYYY-MM-DD'
  price: number;
  /** Flash-sale price that day, shown for context but excluded from the line. */
  flashPrice: number | null;
}

interface PriceChartHoverProps {
  points: HoverPoint[];
  width: number;
  height: number;
  plotTop: number;
  plotBottom: number;
  className?: string;
}

const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${WEEKDAYS[d.getUTCDay()]}, ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/**
 * Hover / touch / keyboard read-out over the server-rendered chart. Pointer: nearest recorded day.
 * Touch keeps vertical page scrolling (`touch-pan-y`) so the chart never traps a phone user.
 * Keyboard: focus the chart, then ←/→ (Home/End) move day by day; a live region reads the value.
 */
export function PriceChartHover({ points, width, height, plotTop, plotBottom, className = "" }: PriceChartHoverProps) {
  const [index, setIndex] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  if (!points || points.length === 0) return null;
  const active = index != null ? points[Math.min(index, points.length - 1)] : null;

  const nearest = (clientX: number) => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null; // hidden variant (desktop vs phone chart)
    const x = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    }
    return best;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const i = nearest(e.clientX);
    if (i != null) setIndex(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const current = index ?? last;
    const next =
      e.key === "ArrowLeft" ? Math.max(0, current - 1)
      : e.key === "ArrowRight" ? Math.min(last, current + 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (e.key === "Escape") {
      setIndex(null);
      return;
    }
    if (next == null) return;
    e.preventDefault();
    setIndex(next);
  };

  const leftPct = active ? (active.x / width) * 100 : 0;
  const shift = leftPct < 18 ? "translate-x-0" : leftPct > 82 ? "-translate-x-full" : "-translate-x-1/2";

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label="Xem giá từng ngày: dùng phím mũi tên trái, phải"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerMove}
      onPointerLeave={() => setIndex(null)}
      onFocus={() => setIndex((i) => i ?? points.length - 1)}
      onBlur={() => setIndex(null)}
      onKeyDown={onKeyDown}
      className={`absolute inset-0 cursor-crosshair touch-pan-y rounded-md outline-offset-4 ${className}`}
    >
      {active && (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
            <line x1={active.x} x2={active.x} y1={plotTop} y2={plotBottom} className="stroke-primary" strokeWidth={1.5} strokeDasharray="4 4" />
            <circle cx={active.x} cy={active.y} r={6} className="fill-primary stroke-surface" strokeWidth={2.5} />
          </svg>
          <div
            className={`pointer-events-none absolute top-0 ${shift} whitespace-nowrap rounded-md border border-line bg-surface px-3 py-2 shadow-lift`}
            style={{ left: `${leftPct}%` }}
          >
            <p className="text-[12px] font-semibold text-ink-3">{formatDay(active.day)}</p>
            <p className="num text-[18px] font-extrabold leading-tight text-ink">{formatVnd(active.price)}</p>
            {active.flashPrice != null && (
              <p className="text-[12px] text-ink-3">
                Flash sale <span className="num">{formatVnd(active.flashPrice)}</span> (không tính)
              </p>
            )}
          </div>
        </>
      )}
      <p className="sr-only" aria-live="polite">
        {active ? `${formatDay(active.day)}: ${formatVnd(active.price)}` : ""}
      </p>
    </div>
  );
}
