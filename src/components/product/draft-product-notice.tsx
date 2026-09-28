import { InfoIcon } from "@/components/ui/icons";
import { MIN_DAYS_FOR_SCORE } from "@/lib/pricing/deal-score";

interface DraftProductNoticeProps {
  isDraft: boolean;
  /** Offers currently shown for the selected variant. */
  offerCount: number;
  /** Days with a recorded price for the selected variant. */
  dataDays: number;
}

/**
 * Calm surface-2 note with an info icon, like the fake-sale note.
 * Shown on products created on the fly from a pasted link (ingest → status 'draft', decision Đ6).
 * Every sentence must match the data on the page: a draft can already have a long history and
 * several sellers, so the "short history" and "one seller" lines only appear when true.
 */
export function DraftProductNotice({ isDraft, offerCount, dataDays }: DraftProductNoticeProps) {
  if (!isDraft) return null;

  const shortHistory = dataDays < MIN_DAYS_FOR_SCORE;
  const singleSeller = offerCount <= 1;

  let limits: string | null = null;
  if (shortHistory && singleSeller) {
    limits = `Hiện mới có giá của một người bán và ${dataDays} ngày dữ liệu. Khi đủ ${MIN_DAYS_FOR_SCORE} ngày và đối chiếu được với người bán khác, Deal Score và phần so sánh sẽ đầy đủ hơn.`;
  } else if (shortHistory) {
    limits = `Hiện mới có ${dataDays} ngày dữ liệu giá; Deal Score cần ít nhất ${MIN_DAYS_FOR_SCORE} ngày.`;
  } else if (singleSeller) {
    limits = "Hiện mới có giá của một người bán, nên chưa so sánh được giữa các nơi bán.";
  }

  return (
    <aside
      role="note"
      aria-labelledby="draft-notice-heading"
      className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 rounded-tile border border-line bg-surface-2 px-4 py-3.5"
    >
      <InfoIcon className="mt-0.5 size-[18px] text-ink" strokeWidth={2} />
      <div className="min-w-0">
        <h3 id="draft-notice-heading" className="text-body-sm font-bold text-ink">
          Sản phẩm được thêm từ link dán vào
        </h3>
        <p className="mt-0.5 max-w-[75ch] text-body-sm leading-normal text-ink-2">
          Tên, thương hiệu và phiên bản được lấy tự động từ trang người bán và chưa được Kairo duyệt lại.
          {limits && <> {limits}</>}
        </p>
      </div>
    </aside>
  );
}
