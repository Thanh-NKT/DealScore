import Link from "next/link";
import type { ChartSeries } from "@/lib/pricing/chart-series";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { formatVnd } from "@/lib/format";
import { PriceChartHover } from "./price-chart-hover";

interface PriceChartProps {
  series: ChartSeries;
  range: 7 | 30 | 90;
  variantId: string;
  rows: DailyPriceRow[];
}

export function PriceChart({
  series,
  range,
  variantId,
  rows,
}: PriceChartProps) {
  const WIDTH = 720;
  const HEIGHT = 260;
  const PADDING_LEFT = 64;
  const PADDING_RIGHT = 16;
  const PADDING_TOP = 16;
  const PADDING_BOTTOM = 32;

  const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT; // 640
  const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM; // 212

  // Nếu không đủ 2 điểm để vẽ
  if (!series.renderable || series.min == null || series.max == null) {
    return (
      <section className="rounded-2xl border border-border p-6 text-center">
        <div className="flex items-center justify-between border-b border-border pb-4 mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Lịch sử giá
          </h3>
          <RangeTabs variantId={variantId} currentRange={range} />
        </div>
        <p className="text-sm text-muted py-12">
          Cần thêm dữ liệu để vẽ biểu đồ.
        </p>
      </section>
    );
  }

  // Biên độ Y: [min * 0.98, max * 1.02]
  const yMin = series.min * 0.98;
  const yMax = series.max === series.min ? series.max * 1.05 : series.max * 1.02;
  const yDiff = yMax - yMin;

  const scaleY = (val: number) => {
    return (
      HEIGHT -
      PADDING_BOTTOM -
      ((val - yMin) / yDiff) * PLOT_HEIGHT
    );
  };

  // Xác định ngày bắt đầu và kết thúc của cửa sổ
  const allPoints = series.segments.flat();
  const sortedDays = Array.from(new Set(allPoints.map((p) => p.day))).sort();
  const startDay = sortedDays[0];
  const endDay = sortedDays[sortedDays.length - 1];

  const startTime = new Date(`${startDay}T00:00:00Z`).getTime();
  const endTime = new Date(`${endDay}T00:00:00Z`).getTime();
  const timeDiff = Math.max(endTime - startTime, 86_400_000);

  const scaleX = (dayStr: string) => {
    const t = new Date(`${dayStr}T00:00:00Z`).getTime();
    return PADDING_LEFT + ((t - startTime) / timeDiff) * PLOT_WIDTH;
  };

  // Tính tọa độ cho từng segment
  const segmentPolylines = series.segments.map((seg) => {
    return seg
      .map((pt) => `${scaleX(pt.day).toFixed(1)},${scaleY(pt.price).toFixed(1)}`)
      .join(" ");
  });

  // Tọa độ cho hover
  const hoverPoints = allPoints.map((pt) => ({
    x: scaleX(pt.day),
    y: scaleY(pt.price),
    day: pt.day,
    price: pt.price,
  }));

  // Lưới và nhãn trục Y: low, median, high
  const yLevels = [
    { label: formatVnd(series.min), y: scaleY(series.min) },
    {
      label: formatVnd((series.min + series.max) / 2),
      y: scaleY((series.min + series.max) / 2),
    },
    { label: formatVnd(series.max), y: scaleY(series.max) },
  ];

  // Nhãn trục X
  const step = range === 7 ? 1 : range === 30 ? 5 : 15;
  const xLabels: Array<{ text: string; x: number }> = [];
  for (let i = 0; i < sortedDays.length; i += step) {
    const d = sortedDays[i];
    const parts = d.split("-");
    const label = `${parts[2]}/${parts[1]}`;
    xLabels.push({ text: label, x: scaleX(d) });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Lịch sử giá ({range} ngày)
        </h3>
        <RangeTabs variantId={variantId} currentRange={range} />
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border bg-black/[0.01] p-2 dark:bg-white/[0.01]">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby="chart-title chart-desc"
          className="h-auto w-full select-none"
        >
          {/* Một chuỗi duy nhất: <title>/<desc> trong SVG ghép nhiều text node thì HTML từ server không khớp lúc hydrate. */}
          <title id="chart-title">{`Biểu đồ giá ${range} ngày`}</title>
          <desc id="chart-desc">
            {`Giá thấp nhất từ ${formatVnd(series.min)} đến ${formatVnd(series.max)}, theo dõi ${range} ngày.`}
          </desc>

          {/* Đường lưới và nhãn Y */}
          {yLevels.map((lvl, idx) => (
            <g key={idx}>
              <line
                x1={PADDING_LEFT}
                y1={lvl.y}
                x2={WIDTH - PADDING_RIGHT}
                y2={lvl.y}
                stroke="currentColor"
                strokeWidth="1"
                className="text-border"
                strokeDasharray="2 2"
              />
              <text
                x={PADDING_LEFT - 8}
                y={lvl.y + 4}
                textAnchor="end"
                className="fill-muted text-[10px] font-medium"
              >
                {lvl.label}
              </text>
            </g>
          ))}

          {/* Nhãn X */}
          {xLabels.map((lbl, idx) => (
            <text
              key={idx}
              x={lbl.x}
              y={HEIGHT - 12}
              textAnchor="middle"
              className="fill-muted text-[10px]"
            >
              {lbl.text}
            </text>
          ))}

          {/* Các phân đoạn polyline (ngắt đoạn khi thiếu dữ liệu) */}
          {segmentPolylines.map((pointsStr, idx) => (
            <polyline
              key={idx}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pointsStr}
              className="text-foreground"
            />
          ))}

          {/* Flash sale markers */}
          {series.flashMarkers.map((marker, idx) => (
            <circle
              key={idx}
              cx={scaleX(marker.day)}
              cy={scaleY(marker.price)}
              r="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-amber-500"
            />
          ))}
        </svg>

        {/* Client hover tooltip phủ lên */}
        <PriceChartHover
          points={hoverPoints}
          width={WIDTH}
          height={HEIGHT}
        />
      </div>

      {series.flashMarkers.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-500" />
          <span>Đã từng có flash sale</span>
        </div>
      )}

      {/* Bảng ẩn hiển thị toàn bộ dữ liệu cho SEO & trình đọc màn hình */}
      <table className="sr-only">
        <caption>Lịch sử giá chi tiết</caption>
        <thead>
          <tr>
            <th scope="col">Ngày</th>
            <th scope="col">Giá thấp nhất</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td>{formatVnd(row.min_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RangeTabs({
  variantId,
  currentRange,
}: {
  variantId: string;
  currentRange: number;
}) {
  const ranges = [7, 30, 90] as const;

  return (
    <nav aria-label="Khoảng thời gian" className="flex items-center gap-1">
      {ranges.map((r) => {
        const isActive = r === currentRange;
        return (
          <Link
            key={r}
            href={`?variant=${variantId}&range=${r}`}
            aria-current={isActive ? "true" : undefined}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-foreground text-background font-semibold"
                : "text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {r} ngày
          </Link>
        );
      })}
    </nav>
  );
}
