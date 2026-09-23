"use client";

import { useState, useRef, type PointerEvent } from "react";
import { formatVnd } from "@/lib/format";

interface Point {
  x: number;
  y: number;
  day: string;
  price: number;
}

interface PriceChartHoverProps {
  points: Point[];
  width: number;
  height: number;
}

export function PriceChartHover({ points, width, height }: PriceChartHoverProps) {
  const [activePoint, setActivePoint] = useState<Point | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!points || points.length === 0) {
    return null;
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;

    // Find the point nearest to mouseX
    let closest = points[0];
    let minDiff = Math.abs(points[0].x - mouseX);

    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = points[i];
      }
    }

    setActivePoint(closest);
  };

  const handlePointerLeave = () => {
    setActivePoint(null);
  };

  const formatDate = (d: string) => {
    try {
      const p = d.split("-");
      if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
      return d;
    } catch {
      return d;
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="absolute inset-0 cursor-crosshair touch-none"
    >
      {activePoint && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {/* Vertical guide line */}
          <line
            x1={activePoint.x}
            y1={16}
            x2={activePoint.x}
            y2={height - 32}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 3"
            className="text-foreground/40"
          />

          {/* Highlighted point */}
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="4.5"
            className="fill-foreground stroke-background stroke-2"
          />

          {/* Tooltip box */}
          <g
            transform={`translate(${Math.min(
              Math.max(activePoint.x - 60, 64),
              width - 130,
            )}, ${Math.max(activePoint.y - 48, 16)})`}
          >
            <rect
              width="120"
              height="36"
              rx="6"
              className="fill-foreground text-background shadow-md"
            />
            <text
              x="60"
              y="15"
              textAnchor="middle"
              className="fill-background text-[10px] font-medium"
            >
              {formatDate(activePoint.day)}
            </text>
            <text
              x="60"
              y="29"
              textAnchor="middle"
              className="fill-background text-xs font-bold"
            >
              {formatVnd(activePoint.price)}
            </text>
          </g>
        </svg>
      )}
    </div>
  );
}
