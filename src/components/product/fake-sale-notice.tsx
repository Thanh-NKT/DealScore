import { formatVnd } from "@/lib/format";
import { InfoIcon } from "@/components/ui/icons";

interface FakeSaleNoticeProps {
  /** Detector output (detectFakeSale); null = no notice. */
  message: string | null;
  /** The seller's advertised % off their list price. */
  advertisedPercent?: number | null;
  currentPrice?: number | null;
  /** 30-day median of daily best prices — the same window detectFakeSale compares against. */
  median30d?: number | null;
  /**
   * Rendered inside the Deal Score block, under the reasons. The intro then explains the claim
   * instead of judging the price, since the verdict above already judges it.
   */
  embedded?: boolean;
}

const isValidPrice = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/** Plain-words distance from the median: "thấp hơn 3%", "cao hơn 2%", "ngang". */
function versusMedian(current: number, median: number): { value: string; words: string } {
  const pct = ((current - median) / median) * 100;
  if (Math.abs(pct) < 0.5) return { value: "≈0%", words: "ngang mức trung vị" };
  const rounded = Math.round(Math.abs(pct));
  return pct < 0
    ? { value: `−${rounded}%`, words: "thấp hơn mức trung vị" }
    : { value: `+${rounded}%`, words: "cao hơn mức trung vị" };
}

/**
 * DESIGN.md "Thông báo 'Giảm giá chưa thực chất'": a calm surface-2 box with an info icon. Neutral by rule: it talks about the price, never the seller
 * (no "lừa đảo", no warning colour). When the numbers are available it puts the advertised % next
 * to the gap from the 30-day median, so the shopper can see the claim against the record.
 */
export function FakeSaleNotice({
  message,
  advertisedPercent = null,
  currentPrice = null,
  median30d = null,
  embedded = false,
}: FakeSaleNoticeProps) {
  if (!message?.trim()) return null;

  const advertised =
    advertisedPercent != null && Number.isFinite(advertisedPercent) && advertisedPercent > 0
      ? Math.round(advertisedPercent)
      : null;
  const compare = isValidPrice(currentPrice) && isValidPrice(median30d) ? versusMedian(currentPrice, median30d) : null;
  const showCompare = advertised != null && compare != null;
  // The "price rose before the sale" heuristic has its own sentence worth keeping.
  const hikeNote = /tăng/i.test(message) ? "Giá đã tăng trong thời gian gần đây, trước đợt giảm này." : null;
  const intro =
    embedded && advertised != null
      ? `Con số −${advertised}% được tính trên giá niêm yết của người bán, không phải trên mức giá sản phẩm thường bán.`
      : "Mức giá hiện tại chưa thấp hơn đáng kể so với lịch sử quan sát.";

  return (
    <aside
      role="note"
      aria-labelledby="fake-sale-heading"
      className={`rounded-md bg-surface-2 px-4 py-3.5 text-ink ${embedded ? "" : "border border-line"}`}
    >
      <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5">
        <InfoIcon className="mt-0.5 size-[18px]" strokeWidth={2} />
        <div className="min-w-0">
          <h3 id="fake-sale-heading" className="text-[14px] font-bold">
            Giảm giá chưa thực chất
          </h3>
          <p className="mt-0.5 max-w-[68ch] text-[14px] leading-normal text-ink-2">
            {intro}
            {hikeNote && ` ${hikeNote}`}
          </p>

          {showCompare && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 border-t border-line-strong/40 pt-3 max-[420px]:grid-cols-1 max-[420px]:gap-y-2.5">
              <div className="min-w-0">
                <dt className="text-[12px] font-semibold text-ink-3">Người bán ghi giảm</dt>
                <dd className="num text-[18px] font-bold leading-tight">−{advertised}%</dd>
                <dd className="text-[12px] text-ink-3">so với giá niêm yết của họ</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[12px] font-semibold text-ink-3">So với giá hệ thống ghi nhận</dt>
                <dd className="num text-[18px] font-bold leading-tight">{compare.value}</dd>
                <dd className="text-[12px] text-ink-3">
                  {compare.words} 30 ngày (<span className="num">{formatVnd(median30d)}</span>)
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </aside>
  );
}
