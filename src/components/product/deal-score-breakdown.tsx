import { CheckIcon, DashIcon, InfoIcon } from "@/components/ui/icons";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { parseReasons } from "@/lib/pricing/verdict-copy";
import { MIN_DAYS_FOR_SCORE, MIN_OBSERVATIONS_FOR_SCORE, type Recommendation } from "@/lib/pricing/deal-score";

interface DealScoreBreakdownProps {
  score: number | null | undefined;
  recommendation: Recommendation | null | undefined;
  reasons?: string[];
}

// The headline score is computed WITHOUT the cross-offer component (decision Đ7 in
// src/lib/pricing/variant-pricing.ts), so the 50/30 weights renormalise to 62.5/37.5, then v1 adds
// small trend / volatility adjustments. Keep this copy in step with the engine.
const WEIGHTS = [
  { weight: "62,5%", label: "Vị trí của giá trong 90 ngày" },
  { weight: "37,5%", label: "Khoảng cách tới mức thấp nhất" },
];

export function DealScoreBreakdown({
  score,
  recommendation,
  reasons = [],
}: DealScoreBreakdownProps) {
  const hasScore = score != null && Number.isFinite(score);
  const scoreVal = hasScore ? Math.min(100, Math.max(0, Math.round(score!))) : null;

  // Each reason carries its own tone (✓ in the buyer’s favour, ⚠ otherwise); the glyph is drawn as an icon, not text.
  // No score yet: the "still collecting data" note first, then any reasons that don't depend on the
  // score (e.g. the voucher estimate, spec 2026-09-28 §4).
  const shownReasons = parseReasons(
    scoreVal == null
      ? [`Kairo cần ít nhất ${MIN_DAYS_FOR_SCORE} ngày và ${MIN_OBSERVATIONS_FOR_SCORE} lần ghi nhận giá hợp lệ để chấm Deal Score.`, ...reasons]
      : reasons,
  );

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 sm:p-7">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <div className="space-y-1">
          <h2 className="display text-h3 font-bold tracking-tight text-ink">
            {scoreVal != null ? "Phân tích Deal Score" : "Đang thu thập dữ liệu"}
          </h2>
          <p className="text-label text-ink-3">
            Chấm điểm tự động từ dữ liệu giá thực tế
          </p>
        </div>
        <ScoreRing score={scoreVal} recommendation={recommendation} size="sm" showBadge />
      </div>

      {/* Reasons list */}
      <div className="flex flex-col gap-2.5">
        {shownReasons.length === 0 && (
          <p className="text-body-sm leading-relaxed text-ink-2">Chưa có lý do chi tiết cho mức giá này.</p>
        )}
        {shownReasons.map((r) => (
          <div
            key={r.text}
            className="flex items-start gap-3 rounded-md border border-line/70 bg-surface-2/45 p-3"
          >
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm ${
                r.kind === "pro" ? "bg-buy-soft text-buy" : "bg-surface text-ink-2 border border-line"
              }`}
            >
              {r.kind === "pro" ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : <DashIcon className="size-3.5" strokeWidth={2.5} />}
            </span>
            <span className="text-body-sm leading-relaxed font-medium text-ink">{r.text}</span>
          </div>
        ))}
      </div>

      {/* Deal Score Scale Bar */}
      <div className="flex flex-col gap-2.5 rounded-tile border border-line bg-surface-2/35 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-label font-bold text-ink-2">Thang đo khuyến nghị</span>
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

        <div className="grid grid-cols-[50fr_25fr_25fr] gap-1 text-micro leading-snug text-ink-3">
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
        <span className="text-micro font-bold text-ink-3">Tỷ trọng cấu thành điểm:</span>
        <div className="grid grid-cols-2 gap-2">
          {WEIGHTS.map((w) => (
            <div
              key={w.label}
              className="flex flex-col items-center justify-center rounded-inner border border-line bg-surface-2/40 px-2 py-2.5 text-center"
            >
              <span className="num display text-body font-extrabold text-primary">{w.weight}</span>
              <span className="mt-0.5 text-micro font-medium leading-tight text-ink-2">{w.label}</span>
            </div>
          ))}
        </div>
        <p className="text-micro leading-relaxed text-ink-3">
          Sau đó cộng hoặc trừ vài điểm theo xu hướng giá gần đây và mức dao động giá.
        </p>
      </div>

      {/* Compact Footer Note */}
      <div className="flex items-start gap-2 rounded-inner bg-surface-2/60 p-3 text-micro leading-relaxed text-ink-3">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
        <span>
          Giá flash sale không được tính vào lịch sử giá; nếu giá hiện tại là giá flash sale, điểm so nó với giá thường và lý do đầu tiên sẽ nói rõ. Hoa hồng tiếp thị không làm thay đổi điểm. Cần ít nhất {MIN_DAYS_FOR_SCORE} ngày và {MIN_OBSERVATIONS_FOR_SCORE} lần ghi nhận giá để chấm.
        </span>
      </div>
    </div>
  );
}
