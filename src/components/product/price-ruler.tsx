import { formatVnd } from "@/lib/format";

interface PriceRulerProps {
  /** Lowest / median / highest daily price in the window. */
  low: number | null;
  median: number | null;
  high: number | null;
  /** Today's live price; null (sold out, no data) draws the range without a marker. */
  current: number | null;
  /** Window label, e.g. "90 ngày qua". */
  label?: string;
  className?: string;
}

const valid = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/** "Bằng mức thấp nhất" / "Cao hơn mức thấp nhất 3%": a fact about the range, never a verdict. */
export function rulerPositionText(current: number, low: number): string {
  if (current <= low) return "Bằng hoặc thấp hơn mức thấp nhất";
  const pct = Math.round((current / low - 1) * 100);
  return pct < 1 ? "Gần như bằng mức thấp nhất" : `Cao hơn mức thấp nhất ${pct}%`;
}

/**
 * Thước giá: where today's price sits between the window's low and high, with the median as a tick.
 * Iris on a grey track — the Deal Score gauge beside it carries the verdict colour. Renders
 * nothing without a real range (low < high).
 */
export function PriceRuler({ low, median, high, current, label = "90 ngày qua", className = "" }: PriceRulerProps) {
  if (!valid(low) || !valid(high) || high <= low) return null;
  const span = high - low;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - low) / span) * 100));
  const now = valid(current) ? current : null;
  const nowPct = now != null ? pos(now) : null;
  const medPct = valid(median) ? pos(median) : null;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="eyebrow text-ink-3">Thước giá · {label}</span>
        {now != null && <span className="text-label font-semibold text-ink">{rulerPositionText(now, low)}</span>}
      </div>

      <div className="relative mx-2 h-9">
        {/* track: the stretch from the low to today is shaded */}
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-surface-2">
          {nowPct != null && <span className="ruler-in absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${nowPct}%` }} />}
        </div>
        {medPct != null && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong"
            style={{ left: `${medPct}%` }}
          />
        )}
        {nowPct != null && (
          <span
            aria-hidden="true"
            className="ruler-in absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary shadow-glow ring-4 ring-surface"
            style={{ left: `${nowPct}%` }}
          >
            <span className="size-2 rounded-full bg-on-primary" />
          </span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-micro text-ink-3">
        <div className="flex flex-col gap-0.5">
          <dt>Thấp nhất</dt>
          <dd className="num text-body-sm font-semibold text-ink">{formatVnd(low)}</dd>
        </div>
        <div className="flex flex-col items-center gap-0.5 text-center">
          <dt>Trung vị</dt>
          <dd className="num text-body-sm font-semibold text-ink-2">{valid(median) ? formatVnd(median) : "—"}</dd>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <dt>Cao nhất</dt>
          <dd className="num text-body-sm font-semibold text-ink-2">{formatVnd(high)}</dd>
        </div>
      </dl>
    </div>
  );
}
