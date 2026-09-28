import type { ReactNode } from "react";
import {
  type DealScoreResult,
  type Recommendation,
  MIN_DAYS_FOR_SCORE,
  MIN_OBSERVATIONS_FOR_SCORE,
} from "@/lib/pricing/deal-score";
import { InfoIcon } from "@/components/ui/icons";
import { VerdictTag } from "./verdict-tag";

/** Say exactly what is missing (design §12.3): not enough tracked days, or not enough days with data. */
function insufficientDetail(stats: DealScoreResult["stats"] | undefined): string {
  const days = Math.max(0, Math.floor(stats?.daysCovered ?? 0));
  const obs = Math.max(0, Math.floor(stats?.observations ?? 0));
  if (days < MIN_DAYS_FOR_SCORE) {
    return days === 0
      ? `Hệ thống chưa ghi nhận giá của sản phẩm này (cần ít nhất ${MIN_DAYS_FOR_SCORE} ngày).`
      : `Hệ thống mới ghi nhận giá ${days} ngày (cần ít nhất ${MIN_DAYS_FOR_SCORE} ngày).`;
  }
  return `Mới có dữ liệu giá ${obs} ngày (cần ít nhất ${MIN_OBSERVATIONS_FOR_SCORE} ngày có dữ liệu).`;
}

/** One calm sentence per verdict, worded from the data, never a promise about future prices. */
const VERDICT_NOTE: Record<Exclude<Recommendation, "insufficient_data">, string> = {
  buy: "Giá đang ở vùng thấp so với giá hệ thống ghi nhận.",
  wait: "Giá ở mức trung bình, chưa gần mức thấp nhất đã ghi nhận.",
  avoid: "Giá cao hơn đáng kể so với giá hệ thống ghi nhận gần đây.",
};

/**
 * The verdict's one sentence. When the seller's advertised discount is not real, the sentence says
 * both things at once, so the verdict and "Giảm giá chưa thực chất" never read as a contradiction:
 * the price can be good against history while the seller's "−25%" is measured from an inflated list price.
 */
export function verdictNote(recommendation: Recommendation, fakeSale = false): string | undefined {
  if (recommendation === "insufficient_data") return undefined;
  if (!fakeSale) return VERDICT_NOTE[recommendation];
  return recommendation === "buy"
    ? "Giá đang ở vùng thấp so với giá hệ thống ghi nhận, dù mức giảm người bán ghi chưa thực chất."
    : `${VERDICT_NOTE[recommendation]} Mức giảm người bán ghi chưa thực chất.`;
}

interface DealScoreBadgeProps {
  result: DealScoreResult;
  /** false hides the verdict pill beside the heading. */
  showVerdict?: boolean;
  /** The reasons list, placed between the heading and the scale. */
  children?: ReactNode;
}

/** The three verdict bands of the 0–100 scale (DESIGN.md "Thang 0–100"). */
const BANDS = [
  { range: "0–49", words: "Chưa nên mua", fr: 50, tone: "bg-avoid" },
  { range: "50–74", words: "Có thể chờ", fr: 25, tone: "bg-wait" },
  { range: "75+", words: "Nên mua", fr: 25, tone: "bg-buy" },
] as const;
const GRID = "grid grid-cols-[50fr_25fr_25fr] gap-1";

/** 0–100 scale in the three verdict bands, labelled in words; the ink marker is the current score. */
function ScoreScale({ score }: { score: number }) {
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-bold text-ink-2">Thang đo Deal Score</p>
      <div className="relative" aria-hidden="true">
        <div className={`${GRID} h-2.5`}>
          {BANDS.map((b, i) => (
            <span
              key={b.range}
              className={`${b.tone} ${i === 0 ? "rounded-l-full" : ""} ${i === BANDS.length - 1 ? "rounded-r-full" : ""}`}
            />
          ))}
        </div>
        <span
          className="absolute -top-[5px] h-5 w-2 -translate-x-1/2 rounded-full border-2 border-surface bg-ink"
          style={{ left: `clamp(4px, ${score}%, calc(100% - 4px))` }}
        />
      </div>
      <div className={`${GRID} text-[12px] leading-snug text-ink-2`}>
        {BANDS.map((b) => (
          <span key={b.range}>
            <span className="num font-semibold text-ink">{b.range}</span>
            <br />
            {b.words}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The "Vì sao N điểm?" card body (DESIGN.md "Viên kết luận và vòng điểm"): heading with the verdict
 * pill, the reasons, the 0–100 scale in verdict bands, then how the score is computed. The ring
 * itself lives in the price card. The explanation states the weights actually used for the
 * headline score (62,5 / 37,5, no bestOffer — decision Đ7).
 */
export function DealScoreBadge({ result, showVerdict = true, children }: DealScoreBadgeProps) {
  const raw = result?.score;
  const score = raw != null && Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : null;
  const recommendation: Recommendation =
    score == null ? "insufficient_data" : (result?.recommendation ?? "insufficient_data");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="deal-score-heading" className="display text-[22px] font-bold leading-tight text-ink">
          {score != null ? (
            <>
              Vì sao <span className="num">{score}</span> điểm?
            </>
          ) : (
            "Vì sao chưa có điểm?"
          )}
        </h2>
        {showVerdict && <VerdictTag recommendation={recommendation} />}
      </div>

      {score == null && (
        <p className="text-[15px] text-ink-2">Chưa đủ dữ liệu để chấm. {insufficientDetail(result?.stats)}</p>
      )}

      {children}

      {score != null && (
        <>
          <hr className="border-line" />
          <ScoreScale score={score} />
        </>
      )}

      <div className="flex gap-2.5 rounded-md bg-surface-2 px-3.5 py-3 text-[13px] leading-normal text-ink-2">
        <InfoIcon className="mt-0.5 size-4" strokeWidth={2} />
        <div className="max-w-[68ch] space-y-1.5">
          <p>
            Điểm tính trên giá tốt nhất mỗi ngày trong 90 ngày hệ thống ghi nhận, đã loại các đợt flash sale:{" "}
            <span className="num font-bold text-ink">62,5%</span> theo vị trí của giá hiện tại so với các mức giá đã
            ghi nhận, <span className="num font-bold text-ink">37,5%</span> theo khoảng cách tới mức thấp nhất.
          </p>
          <p>Hoa hồng tiếp thị không nằm trong phép tính. Đây là thông tin tham khảo, không phải lời khuyên tài chính.</p>
        </div>
      </div>
    </div>
  );
}
