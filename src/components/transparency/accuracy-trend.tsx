import type { AccuracySummary } from "@/lib/transparency/accuracy";

const W = 640;
const H = 200;
// No text inside the SVG: it scales with the width (≈ 0.5× at 375px), so labels are HTML at text-micro instead.
const PAD = { top: 12, right: 8, bottom: 12, left: 8 };
const MAX_POINTS = 12;

const vnDay = (iso: string) =>
  new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" });
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * One series: share of correct verdicts per weekly backtest (oldest → newest). Colours are tokens via
 * var(--…), so it follows light / dark. Renders nothing under 2 points.
 */
export function AccuracyTrend({ trend }: { trend: AccuracySummary["trend"] }) {
  const pts = trend.filter((t): t is { ranAt: string; overall: number } => t.overall != null).slice(-MAX_POINTS);
  if (pts.length < 2) return null;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (pts.length - 1);
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.overall).toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const label = `Tỉ lệ kết luận đúng qua ${pts.length} lần kiểm tra, từ ${pct(first.overall)} (${vnDay(first.ranAt)}) đến ${pct(last.overall)} (${vnDay(last.ranAt)}).`;

  return (
    <figure role="img" aria-label={label} className="m-0">
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative w-9 shrink-0 text-micro text-ink-3">
          {[0, 0.5, 1].map((g) => (
            <span key={g} className="num absolute right-0 -translate-y-1/2" style={{ top: `${(y(g) / H) * 100}%` }}>
              {pct(g)}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="h-auto min-w-0 flex-1">
          {[0, 0.5, 1].map((g) => (
            <line key={g} x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {pts.map((p, i) => (
            <circle key={p.ranAt} cx={x(i)} cy={y(p.overall)} r={3.5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2} />
          ))}
        </svg>
      </div>
      <div aria-hidden="true" className="num mt-1 flex justify-between pl-11 text-micro text-ink-3">
        <span>{vnDay(first.ranAt)}</span>
        <span>{vnDay(last.ranAt)}</span>
      </div>
    </figure>
  );
}
