import type { ReactNode } from "react";
import Link from "next/link";
import type { ChartSeries } from "@/lib/pricing/chart-series";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { formatVnd } from "@/lib/format";
import { PriceChartHover, type HoverPoint } from "./price-chart-hover";

interface PriceChartProps {
  series: ChartSeries;
  range: 7 | 30 | 90;
  variantId: string;
  rows: DailyPriceRow[];
  /** 90-day median from the pricing stats, so the chart and StatsRow show the same number. */
  median?: number | null;
  /** Stats boxes (StatsRow), rendered between the header and the chart. */
  children?: ReactNode;
}

type Layout = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Font size in viewBox units; the narrow chart uses a larger one so it renders ≥12px on phones. */
  font: number;
  xTicks: number;
};

/** Desktop and the ≤760px variant (DESIGN.md: separate 360-wide viewBox, labels ≥12px rendered). */
const WIDE: Layout = { width: 720, height: 262, left: 56, right: 12, top: 22, bottom: 34, font: 12, xTicks: 5 };
const NARROW: Layout = { width: 360, height: 262, left: 44, right: 10, top: 22, bottom: 34, font: 15, xTicks: 3 };

const DAY_MS = 86_400_000;
const dayMs = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const isValidPrice = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/** Axis labels in the compact Vietnamese form ("2,8tr", "950k"), with just enough decimals to stay distinct. */
function compactVnd(values: number[]): string[] {
  const fmt = (v: number, decimals: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(decimals).replace(".", ",").replace(/,?0+$/, "")}tr`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(Math.max(0, decimals - 1)).replace(".", ",").replace(/,?0+$/, "")}k`;
    return `${Math.round(v)}đ`;
  };
  for (const decimals of [1, 2, 3]) {
    const labels = values.map((v) => fmt(v, decimals));
    if (new Set(labels).size === labels.length) return labels;
  }
  return values.map((v) => formatVnd(v));
}

function RangeTabs({ variantId, currentRange }: { variantId: string; currentRange: number }) {
  return (
    <nav aria-label="Khoảng thời gian" className="inline-flex gap-1 rounded-md bg-surface-2 p-1">
      {([7, 30, 90] as const).map((r) => {
        const isActive = r === currentRange;
        return (
          <Link
            key={r}
            href={`?variant=${encodeURIComponent(variantId)}&range=${r}`}
            scroll={false}
            aria-current={isActive ? "true" : undefined}
            className={`inline-flex min-h-10 min-w-18 items-center justify-center rounded-sm px-3 text-[13px] font-semibold transition-colors duration-150 ease-out ${
              isActive ? "bg-night text-night-ink" : "text-ink-2 hover:bg-surface hover:text-ink"
            }`}
          >
            {r} ngày
          </Link>
        );
      })}
    </nav>
  );
}

function ChartHeader({ variantId, range }: { variantId: string; range: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <h2 id="price-chart-heading" className="display text-[22px] font-bold leading-tight text-ink">
          Lịch sử giá
        </h2>
        <p className="text-[13px] text-ink-3">Giá được hệ thống ghi nhận, lấy giá tốt nhất mỗi ngày</p>
      </div>
      <RangeTabs variantId={variantId} currentRange={range} />
    </div>
  );
}

interface Geometry {
  layout: Layout;
  lines: string[];
  /** Closed polygons under each line segment, down to the plot floor. */
  areas: string[];
  hover: HoverPoint[];
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; label: string; anchor: "start" | "middle" | "end" }>;
  low: { x: number; y: number; price: number } | null;
  current: { x: number; y: number } | null;
  median: { y: number; price: number } | null;
  flash: Array<{ x: number; y: number }>;
}

function buildGeometry(series: ChartSeries, median: number | null, layout: Layout): Geometry {
  const points = series.segments.flat();
  const linePrices = points.map((p) => p.price);
  const flashPrices = series.flashMarkers.map((m) => m.price).filter(isValidPrice);
  const all = [...linePrices, ...flashPrices, ...(median != null ? [median] : [])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // Flat series (one price all month) still needs a visible band around the line.
  const pad = hi === lo ? Math.max(lo * 0.05, 1_000) : (hi - lo) * 0.08;
  const yMin = Math.max(0, lo - pad);
  const yMax = hi + pad;

  const plotW = layout.width - layout.left - layout.right;
  const plotH = layout.height - layout.top - layout.bottom;
  const days = Array.from(new Set([...points.map((p) => p.day), ...series.flashMarkers.map((m) => m.day)])).sort();
  const t0 = dayMs(days[0]);
  const span = Math.max(dayMs(days[days.length - 1]) - t0, DAY_MS);
  const sx = (d: string) => layout.left + ((dayMs(d) - t0) / span) * plotW;
  const sy = (v: number) => layout.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const tickValues = hi === lo ? [lo] : [lo, (lo + hi) / 2, hi];
  const tickLabels = compactVnd(tickValues);

  // Up to N date labels spread by time, always including the first and last recorded day.
  const xCount = Math.min(layout.xTicks, days.length);
  const xDays = Array.from(
    new Set(
      Array.from({ length: xCount }, (_, i) => {
        const target = t0 + (span * i) / Math.max(1, xCount - 1);
        return days.reduce((best, d) => (Math.abs(dayMs(d) - target) < Math.abs(dayMs(best) - target) ? d : best));
      }),
    ),
  );

  const flashByDay = new Map(series.flashMarkers.filter((m) => isValidPrice(m.price)).map((m) => [m.day, m.price]));
  const lowPoint = points.reduce<(typeof points)[number] | null>((best, p) => (best == null || p.price < best.price ? p : best), null);
  const floor = (layout.height - layout.bottom).toFixed(1);
  const last = points.length > 0 ? points.reduce((a, b) => (dayMs(b.day) > dayMs(a.day) ? b : a)) : null;

  return {
    layout,
    // Step line: a day's best price holds until the next recorded day (DESIGN.md "đường bậc thang").
    lines: series.segments.map((seg) =>
      seg
        .flatMap((p, i) => {
          const here = `${sx(p.day).toFixed(1)},${sy(p.price).toFixed(1)}`;
          if (i === 0) return [here];
          return [`${sx(p.day).toFixed(1)},${sy(seg[i - 1].price).toFixed(1)}`, here];
        })
        .join(" "),
    ),
    areas: series.segments
      .filter((seg) => seg.length > 1)
      .map((seg) => {
        const first = sx(seg[0].day).toFixed(1);
        const end = sx(seg[seg.length - 1].day).toFixed(1);
        const top = seg
          .flatMap((p, i) => {
            const here = `${sx(p.day).toFixed(1)},${sy(p.price).toFixed(1)}`;
            return i === 0 ? [here] : [`${sx(p.day).toFixed(1)},${sy(seg[i - 1].price).toFixed(1)}`, here];
          })
          .join(" ");
        return `${first},${floor} ${top} ${end},${floor}`;
      }),
    hover: points.map((p) => ({ x: sx(p.day), y: sy(p.price), day: p.day, price: p.price, flashPrice: flashByDay.get(p.day) ?? null })),
    yTicks: tickValues.map((v, i) => ({ y: sy(v), label: tickLabels[i] })),
    xTicks: xDays.map((d, i) => ({
      x: sx(d),
      label: ddmm(d),
      anchor: xDays.length === 1 ? "middle" : i === 0 ? "start" : i === xDays.length - 1 ? "end" : "middle",
    })),
    low: lowPoint ? { x: sx(lowPoint.day), y: sy(lowPoint.price), price: lowPoint.price } : null,
    current: last ? { x: sx(last.day), y: sy(last.price) } : null,
    median: median != null ? { y: sy(median), price: median } : null,
    flash: series.flashMarkers.filter((m) => isValidPrice(m.price)).map((m) => ({ x: sx(m.day), y: sy(m.price) })),
  };
}

function ChartSvg({ geo, className, labelledBy }: { geo: Geometry; className: string; labelledBy?: string }) {
  const { layout: L, low, median, current } = geo;
  const right = L.width - L.right;
  // Flip the low label to the left of its dot when it would run past the plot's right edge
  // (bold text ≈ 0.56em per character).
  const lowLabel = low ? `Thấp nhất ${formatVnd(low.price)}` : "";
  const lowOnRight = low != null && low.x + 10 + lowLabel.length * L.font * 0.56 > right;
  const lowLabelBelow = low != null && low.y < L.height - L.bottom - L.font * 1.6;

  return (
    <svg
      viewBox={`0 0 ${L.width} ${L.height}`}
      className={`h-auto w-full select-none overflow-visible ${className}`}
      role={labelledBy ? "img" : undefined}
      aria-labelledby={labelledBy}
      aria-hidden={labelledBy ? undefined : true}
      style={{ fontSize: L.font }}
    >
      {geo.yTicks.map((t) => (
        <g key={t.label}>
          <line x1={L.left} x2={right} y1={t.y} y2={t.y} className="stroke-line" strokeWidth={1} />
          <text x={L.left - 8} y={t.y + L.font * 0.35} textAnchor="end" className="num fill-ink-3 font-medium">
            {t.label}
          </text>
        </g>
      ))}
      {geo.xTicks.map((t) => (
        <text key={t.label} x={t.x} y={L.height - 8} textAnchor={t.anchor} className="num fill-ink-3 font-medium">
          {t.label}
        </text>
      ))}

      {median && (
        <g>
          <line x1={L.left} x2={right} y1={median.y} y2={median.y} className="stroke-ink-3" strokeWidth={1.5} strokeDasharray="6 6" />
          <text x={right} y={median.y - 6} textAnchor="end" className="fill-ink-2 stroke-surface font-semibold [paint-order:stroke]" strokeWidth={4} strokeLinejoin="round">
            Trung vị {formatVnd(median.price)}
          </text>
        </g>
      )}

      {geo.areas.map((pts, i) => (
        <polygon key={`area-${i}`} points={pts} className="fill-primary-soft" fillOpacity={0.7} />
      ))}
      {geo.lines.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {/* A single-day segment has no line: draw it as a dot so the day isn't lost. */}
      {geo.lines.filter((pts) => !pts.includes(" ")).map((pts, i) => {
        const [x, y] = pts.split(",").map(Number);
        return <circle key={`solo-${i}`} cx={x} cy={y} r={2.5} className="fill-primary" />;
      })}

      {geo.flash.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r={4} className="fill-surface stroke-ink-3" strokeWidth={1.5} />
      ))}

      {low && (
        <g>
          <circle cx={low.x} cy={low.y} r={5} className="fill-surface stroke-ink" strokeWidth={2.5} />
          <text
            x={low.x + (lowOnRight ? -10 : 10)}
            y={lowLabelBelow ? low.y + L.font * 1.25 : low.y - 8}
            textAnchor={lowOnRight ? "end" : "start"}
            className="fill-ink stroke-surface font-bold [paint-order:stroke]"
            strokeWidth={4}
            strokeLinejoin="round"
          >
            {lowLabel}
          </text>
        </g>
      )}

      {current && <circle cx={current.x} cy={current.y} r={6} className="fill-primary stroke-surface" strokeWidth={2.5} />}
    </svg>
  );
}

/**
 * "Lịch sử giá" card. One 2px indigo step line over a soft primary-soft area; the recorded low is a
 * hollow ink dot with its price, the 90-day median a dashed ink-3 line, the latest recorded price a
 * filled indigo dot, flash-sale days hollow grey.
 * Days without data break the line (no interpolation). Below 760px a separate narrow SVG keeps
 * labels readable. A hidden table carries every recorded day for screen readers and SEO.
 */
const CARD = "flex flex-col gap-5 rounded-lg border border-line bg-surface p-7 max-[760px]:p-4";

export function PriceChart({ series, range, variantId, rows, median = null, children }: PriceChartProps) {
  const validRows = (rows ?? []).filter((r) => isValidPrice(r.min_price)).sort((a, b) => dayMs(a.day) - dayMs(b.day));
  const pointCount = series?.segments?.flat().length ?? 0;
  const safeMedian = isValidPrice(median) ? median : null;

  if (!series?.renderable || pointCount < 2) {
    const inRange = pointCount;
    return (
      <section aria-labelledby="price-chart-heading" className={CARD}>
        <ChartHeader variantId={variantId} range={range} />
        {children}
        <p className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-[15px] text-ink-2">
          {inRange === 0
            ? `Hệ thống chưa ghi nhận giá nào trong ${range} ngày qua.`
            : `Hệ thống mới ghi nhận giá ${inRange} ngày trong ${range} ngày qua, cần ít nhất 2 ngày để vẽ biểu đồ.`}
          {range < 90 && validRows.length >= 2 && (
            <>
              {" "}
              <Link href={`?variant=${encodeURIComponent(variantId)}&range=90`} scroll={false} className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
                Xem 90 ngày
              </Link>
            </>
          )}
        </p>
      </section>
    );
  }

  const wide = buildGeometry(series, safeMedian, WIDE);
  const narrow = buildGeometry(series, safeMedian, NARROW);
  const hasGaps = series.segments.length > 1;
  const low = wide.low?.price ?? null;
  const summary = `Giá ${range} ngày: thấp nhất ${formatVnd(low)}${
    safeMedian != null ? `, trung vị 90 ngày ${formatVnd(safeMedian)}` : ""
  }, giá ghi nhận gần nhất ${formatVnd(wide.hover.at(-1)?.price)}.`;

  return (
    <section aria-labelledby="price-chart-heading" className={CARD}>
      <ChartHeader variantId={variantId} range={range} />
      {children}

      <p id="price-chart-desc" className="sr-only">{summary}</p>
      <div className="relative">
        <ChartSvg geo={wide} className="max-[760px]:hidden" labelledBy="price-chart-heading price-chart-desc" />
        <ChartSvg geo={narrow} className="hidden max-[760px]:block" />
        <PriceChartHover points={wide.hover} width={WIDE.width} height={WIDE.height} plotTop={WIDE.top} plotBottom={WIDE.height - WIDE.bottom} className="max-[760px]:hidden" />
        <PriceChartHover points={narrow.hover} width={NARROW.width} height={NARROW.height} plotTop={NARROW.top} plotBottom={NARROW.height - NARROW.bottom} className="hidden max-[760px]:block" />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-2">
            <span className="h-[3px] w-[18px] rounded-full bg-primary" aria-hidden="true" /> Giá tốt nhất mỗi ngày
          </span>
          {safeMedian != null && (
            <span className="inline-flex items-center gap-2">
              <span className="w-[18px] border-t-2 border-dashed border-ink-3" aria-hidden="true" /> Trung vị 90 ngày
            </span>
          )}
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full border-2 border-ink" aria-hidden="true" /> Thấp nhất
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary" aria-hidden="true" /> Giá ghi nhận gần nhất
          </span>
          {wide.flash.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full border-[1.5px] border-ink-3" aria-hidden="true" /> Ngày có flash sale
            </span>
          )}
        </div>
        <p className="mt-2 max-w-[68ch] text-[13px] text-ink-3">
          Tính trên giá tốt nhất mỗi ngày, đã loại các đợt flash sale.
          {hasGaps && " Đoạn đứt là những ngày hệ thống không ghi nhận được giá."}
        </p>
      </div>

      {/* sr-only on the wrapper: a <table> ignores the 1px width and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>Giá được hệ thống ghi nhận theo ngày</caption>
          <thead>
            <tr>
              <th scope="col">Ngày</th>
              <th scope="col">Giá tốt nhất trong ngày</th>
              <th scope="col">Flash sale</th>
            </tr>
          </thead>
          <tbody>
            {validRows.map((row) => (
              <tr key={row.day}>
                <td>{ddmmyyyy(row.day)}</td>
                <td>{formatVnd(row.min_price)}</td>
                <td>{row.has_flash_sale && isValidPrice(row.flash_min_price) ? formatVnd(row.flash_min_price) : "Không"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
