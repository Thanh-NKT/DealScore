import Link from "next/link";
import { CheckIcon, DashIcon, InfoIcon } from "@/components/ui/icons";
import { ScoreRing, ScoreScale, VerdictTag } from "@/components/product/verdict-tag";
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
      ? [`DealScore cần ít nhất ${MIN_DAYS_FOR_SCORE} ngày và ${MIN_OBSERVATIONS_FOR_SCORE} lần ghi nhận giá hợp lệ để chấm Deal Score.`, ...reasons]
      : reasons,
  );

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-5 sm:p-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-ink-3">Vì sao có điểm này</span>
          <h2 className="display text-h3 font-semibold text-ink">
            {scoreVal != null ? "Phân tích Deal Score" : "Đang thu thập dữ liệu"}
          </h2>
        </div>
        <ScoreRing score={scoreVal} recommendation={recommendation} size="sm" showBadge />
      </div>

      {/* Reasons list */}
      <div className="flex flex-col">
        {shownReasons.length === 0 && (
          <p className="text-body-sm leading-relaxed text-ink-2">Chưa có lý do chi tiết cho mức giá này.</p>
        )}
        {shownReasons.map((r) => (
          <div key={r.text} className="flex items-start gap-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
            <span
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                r.kind === "pro" ? "bg-buy-soft text-buy" : "bg-surface-2 text-ink-2"
              }`}
            >
              {r.kind === "pro" ? <CheckIcon className="size-3.5" strokeWidth={2.6} /> : <DashIcon className="size-3.5" strokeWidth={2.6} />}
            </span>
            <span className="text-body-sm font-medium leading-relaxed text-ink">{r.text}</span>
          </div>
        ))}
      </div>

      {/* Deal Score scale */}
      <div className="flex flex-col gap-3 rounded-tile bg-surface-2/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-ink-3">Thang khuyến nghị</span>
          <VerdictTag recommendation={recommendation} />
        </div>

        <ScoreScale score={scoreVal} />

        <div className="grid grid-cols-[49fr_25fr_26fr] gap-1 text-micro leading-snug text-ink-3">
          <div>
            <strong className="num font-semibold text-avoid">0–49</strong>
            <span className="block">Chưa nên mua</span>
          </div>
          <div>
            <strong className="num font-semibold text-wait">50–74</strong>
            <span className="block">Có thể chờ</span>
          </div>
          <div className="text-right">
            <strong className="num font-semibold text-buy">75–100</strong>
            <span className="block">Nên mua</span>
          </div>
        </div>
      </div>

      {/* Weights */}
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow text-ink-3">Tỷ trọng cấu thành điểm</span>
        <div className="flex flex-col gap-2">
          {WEIGHTS.map((w) => (
            <div key={w.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-label">
                <span className="text-ink-2">{w.label}</span>
                <span className="num font-semibold text-ink">{w.weight}</span>
              </div>
              <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full rounded-full bg-primary" style={{ width: w.weight.replace(",", ".") }} />
              </span>
            </div>
          ))}
        </div>
        <p className="text-micro leading-relaxed text-ink-3">
          Sau đó cộng hoặc trừ vài điểm theo xu hướng giá gần đây và mức dao động giá.
        </p>
      </div>

      {/* Compact Footer Note */}
      <div className="flex items-start gap-2 border-t border-line pt-4 text-micro leading-relaxed text-ink-3">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
        <span>
          Giá flash sale không được tính vào lịch sử giá; nếu giá hiện tại là giá flash sale, điểm so nó với giá thường và lý do đầu tiên sẽ nói rõ. Hoa hồng tiếp thị không làm thay đổi điểm. Cần ít nhất {MIN_DAYS_FOR_SCORE} ngày và {MIN_OBSERVATIONS_FOR_SCORE} lần ghi nhận giá để chấm.
        </span>
      </div>

      <Link
        href="/deal-score"
        className="-mt-2 inline-flex min-h-10 items-center self-start text-label font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
      >
        Deal Score đúng tới đâu? →
      </Link>
    </div>
  );
}
