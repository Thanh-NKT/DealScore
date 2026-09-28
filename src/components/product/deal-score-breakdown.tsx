import { CheckIcon, DashIcon, InfoIcon } from "@/components/ui/icons";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { MIN_DAYS_FOR_SCORE, MIN_OBSERVATIONS_FOR_SCORE, type Recommendation } from "@/lib/pricing/deal-score";

interface DealScoreBreakdownProps {
  score: number | null | undefined;
  recommendation: Recommendation | null | undefined;
  reasons?: string[];
}

const WEIGHTS = [
  { weight: "50%", label: "Vị trí lịch sử 90d" },
  { weight: "30%", label: "Khoảng cách đáy" },
  { weight: "20%", label: "So giá nơi bán" },
];

export function DealScoreBreakdown({
  score,
  recommendation,
  reasons = [],
}: DealScoreBreakdownProps) {
  const hasScore = score != null && Number.isFinite(score);
  const scoreVal = hasScore ? Math.min(100, Math.max(0, Math.round(score!))) : null;

  const shownReasons =
    reasons.length > 0
      ? reasons
      : scoreVal == null
        ? [`Kairo cần ít nhất ${MIN_DAYS_FOR_SCORE} ngày và ${MIN_OBSERVATIONS_FOR_SCORE} lần ghi nhận giá hợp lệ để chấm Deal Score.`]
        : [];
  const favourable = recommendation === "buy";

  return (
    <div className="flex flex-col gap-5 rounded-[20px] border border-line bg-surface p-6 sm:p-7">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <div className="space-y-1">
          <h2 className="display text-[22px] font-bold tracking-tight text-ink">
            {scoreVal != null ? "Phân tích Deal Score" : "Đang thu thập dữ liệu"}
          </h2>
          <p className="text-[13px] text-ink-3">
            Chấm điểm tự động từ dữ liệu giá thực tế
          </p>
        </div>
        <ScoreRing score={scoreVal} recommendation={recommendation} size="sm" showBadge />
      </div>

      {/* Reasons list */}
      <div className="flex flex-col gap-2.5">
        {shownReasons.length === 0 && (
          <p className="text-[14px] leading-relaxed text-ink-2">Chưa có lý do chi tiết cho mức giá này.</p>
        )}
        {shownReasons.map((r, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-[12px] border border-line/70 bg-surface-2/45 p-3"
          >
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[8px] ${
                favourable ? "bg-buy-soft text-buy" : "bg-surface text-ink-2 border border-line"
              }`}
            >
              {favourable ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : <DashIcon className="size-3.5" strokeWidth={2.5} />}
            </span>
            <span className="text-[13.5px] leading-relaxed font-medium text-ink">{r}</span>
          </div>
        ))}
      </div>

      {/* Deal Score Scale Bar */}
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface-2/35 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-ink-3">Thang đo khuyến nghị</span>
          <VerdictTag recommendation={recommendation} />
        </div>

        <div className="relative py-1.5">
          <div className="grid h-2.5 grid-cols-[50fr_25fr_25fr] gap-1">
            <span className="rounded-l-full bg-avoid" title="0–49: Chưa nên mua" />
            <span className="bg-wait" title="50–74: Có thể chờ" />
            <span className="rounded-r-full bg-buy" title="75+: Nên mua" />
          </div>

          {scoreVal != null && (
            <span
              aria-hidden="true"
              style={{ left: `calc(${scoreVal}% - 5px)` }}
              className="absolute top-0.5 h-4.5 w-2.5 rounded-full border-2 border-surface bg-night shadow-xs"
            />
          )}
        </div>

        <div className="grid grid-cols-[50fr_25fr_25fr] gap-1 text-[11px] leading-snug text-ink-3">
          <div>
            <strong className="num font-bold text-avoid">0–49</strong> · Chưa nên mua
          </div>
          <div>
            <strong className="num font-bold text-wait">50–74</strong> · Có thể chờ
          </div>
          <div className="text-right">
            <strong className="num font-bold text-buy">75–100</strong> · Nên mua
          </div>
        </div>
      </div>

      {/* 3 Weight Pillars */}
      <div className="space-y-2">
        <span className="text-[12px] font-bold text-ink-3">Tỷ trọng cấu thành điểm:</span>
        <div className="grid grid-cols-3 gap-2">
          {WEIGHTS.map((w) => (
            <div
              key={w.label}
              className="flex flex-col items-center justify-center rounded-[10px] border border-line bg-surface-2/40 px-2 py-2.5 text-center"
            >
              <span className="num display text-[16px] font-extrabold text-primary">{w.weight}</span>
              <span className="mt-0.5 text-[11px] font-medium leading-tight text-ink-2">{w.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Compact Footer Note */}
      <div className="flex items-start gap-2 rounded-[10px] bg-surface-2/60 p-3 text-[12px] leading-relaxed text-ink-3">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
        <span>
          Giá flash sale và hoa hồng tiếp thị không làm thay đổi điểm. Cần tối thiểu {MIN_DAYS_FOR_SCORE} ngày & {MIN_OBSERVATIONS_FOR_SCORE} mốc giá để chấm.
        </span>
      </div>
    </div>
  );
}
