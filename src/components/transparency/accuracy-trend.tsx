import type { AccuracySummary } from "@/lib/transparency/accuracy";

const W = 640;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 32, left: 44 };
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
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(g) + 4} textAnchor="end" fontSize={12} fill="var(--ink-3)">
            {pct(g)}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={p.ranAt} cx={x(i)} cy={y(p.overall)} r={3.5} fill="var(--surface)" stroke="var(--primary)" strokeWidth={2} />
      ))}
      <text x={x(0)} y={H - 8} textAnchor="start" fontSize={12} fill="var(--ink-3)">
        {vnDay(first.ranAt)}
      </text>
      <text x={x(pts.length - 1)} y={H - 8} textAnchor="end" fontSize={12} fill="var(--ink-3)">
        {vnDay(last.ranAt)}
      </text>
    </svg>
  );
}
