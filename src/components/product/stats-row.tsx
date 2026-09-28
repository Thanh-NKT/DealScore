import type { HistoryStats } from "@/lib/pricing/price-history";
import { formatVnd } from "@/lib/format";

interface StatsRowProps {
  /** Always has numbers when data exists — regardless of whether the Deal Score met its threshold. */
  stats: HistoryStats;
  trackingSince: string | null;
  /** Current in-stock best price, for the low / middle / high strip. Omit when out of stock. */
  currentPrice?: number | null;
}

const isValidPrice = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/** 'YYYY-MM-DD' → 'dd/mm/yyyy'; anything malformed → null (shown as "—"). */
function formatDay(d: string | null): string | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

type Zone = "low" | "mid" | "high";
const ZONE_TEXT: Record<Zone, string> = {
  low: "Giá hiện tại nằm ở vùng thấp so với giá hệ thống ghi nhận.",
  mid: "Giá hiện tại nằm ở vùng trung bình so với giá hệ thống ghi nhận.",
  high: "Giá hiện tại nằm ở vùng cao so với giá hệ thống ghi nhận.",
};

/**
 * Stepped low / middle / high strip in neutral surface tones. Same direction as the chart: left is
 * cheap. The indigo mark is the current price ("current" is the one place indigo marks a position); a price outside the recorded range
 * sits at the edge and the sentence says so instead of pretending it is inside.
 */
function RangeStrip({ low, high, current }: { low: number; high: number; current: number }) {
  const pos = (current - low) / (high - low);
  const clamped = Math.min(1, Math.max(0, pos));
  const zone: Zone = clamped < 1 / 3 ? "low" : clamped < 2 / 3 ? "mid" : "high";
  const sentence =
    pos < 0
      ? "Giá hiện tại thấp hơn mọi mức hệ thống ghi nhận trong 90 ngày."
      : pos > 1
        ? "Giá hiện tại cao hơn mọi mức hệ thống ghi nhận trong 90 ngày."
        : ZONE_TEXT[zone];

  return (
    <div className="mt-4">
      <p className="text-[14px] text-ink">{sentence}</p>
      <div className="relative mt-3 grid h-2.5 grid-cols-3 gap-1" aria-hidden="true">
        <span className="rounded-l-full bg-surface-2" />
        <span className="bg-[color-mix(in_oklab,var(--surface-2)_75%,var(--ink-3))]" />
        <span className="rounded-r-full bg-[color-mix(in_oklab,var(--surface-2)_50%,var(--ink-3))]" />
        <i
          className="absolute -top-[5px] h-5 w-2 -translate-x-1/2 rounded-full border-2 border-surface bg-primary"
          style={{ left: `clamp(4px, ${clamped * 100}%, calc(100% - 4px))` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 text-[12px] text-ink-3" aria-hidden="true">
        <span>Vùng thấp</span>
        <span className="text-center">Trung bình</span>
        <span className="text-right">Vùng cao</span>
      </div>
    </div>
  );
}

/**
 * Stats boxes inside the "Lịch sử giá" card (DESIGN.md "Biểu đồ lịch sử giá"): rounded-md
 * surface-2 boxes, Bricolage numbers. Low / median / high of each day's best price over 90 days, plus
 * when tracking started. Missing numbers show "—", never 0đ; when fewer than 90 days have data the
 * footnote says how many, so "90 ngày" never overstates the history.
 */
export function StatsRow({ stats, trackingSince, currentPrice = null }: StatsRowProps) {
  const low = isValidPrice(stats?.low) ? stats.low : null;
  const median = isValidPrice(stats?.median) ? stats.median : null;
  const high = isValidPrice(stats?.high) ? stats.high : null;
  const dayCount = Math.max(0, Math.floor(stats?.dayCount ?? 0));
  const since = formatDay(trackingSince);

  if (low == null && median == null && high == null && since == null) return null;

  const items: Array<{ label: string; value: string | null }> = [
    { label: "Thấp nhất (90 ngày)", value: low != null ? formatVnd(low) : null },
    { label: "Trung vị (90 ngày)", value: median != null ? formatVnd(median) : null },
    { label: "Cao nhất (90 ngày)", value: high != null ? formatVnd(high) : null },
    { label: "Theo dõi từ", value: since },
  ];
  const showStrip = low != null && high != null && high > low && isValidPrice(currentPrice);

  return (
    <section aria-label="Thống kê giá 90 ngày">
      <dl className="grid grid-cols-4 gap-3 max-[760px]:grid-cols-2">
        {items.map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-md bg-surface-2 px-3.5 py-3">
            <dt className="text-[12px] font-semibold text-ink-3">{label}</dt>
            <dd className={`num mt-0.5 text-[18px] font-bold leading-tight ${value == null ? "text-ink-3" : "text-ink"}`}>
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>

      {showStrip && <RangeStrip low={low} high={high} current={currentPrice} />}

      <p className="mt-3 text-[13px] text-ink-3 empty:hidden">
        {dayCount > 0 && dayCount < 90 && `Hệ thống mới ghi nhận giá ${dayCount} ngày trong 90 ngày qua.`}
        {dayCount === 0 && "Chưa có ngày nào đủ dữ liệu trong 90 ngày qua."}
      </p>
    </section>
  );
}
