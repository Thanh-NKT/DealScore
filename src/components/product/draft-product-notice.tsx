import { InfoIcon } from "@/components/ui/icons";

interface DraftProductNoticeProps {
  isDraft: boolean;
}

/**
 * Calm surface-2 note with an info icon, like the fake-sale note.
 * Shown on products created on the fly from a pasted link (ingest → status 'draft', decision Đ6).
 * Calm and short: says what is limited (one seller, a short price record) and why, without
 * suggesting anything is wrong with the product or the seller.
 */
export function DraftProductNotice({ isDraft }: DraftProductNoticeProps) {
  if (!isDraft) return null;

  return (
    <aside
      role="note"
      aria-labelledby="draft-notice-heading"
      className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 rounded-md border border-line bg-surface-2 px-4 py-3.5"
    >
      <InfoIcon className="mt-0.5 size-[18px] text-ink" strokeWidth={2} />
      <div className="min-w-0">
        <h3 id="draft-notice-heading" className="text-[14px] font-bold text-ink">
          Sản phẩm mới được thêm
        </h3>
        <p className="mt-0.5 max-w-[75ch] text-[14px] leading-normal text-ink-2">
          Kairo vừa bắt đầu theo dõi sản phẩm này từ đường link được dán vào, nên hiện chỉ có giá của người bán đó
          và lịch sử giá còn ngắn. Khi hệ thống ghi nhận đủ khoảng 14 ngày và đối chiếu được với người bán khác,
          Deal Score và phần so sánh sẽ đầy đủ hơn.
        </p>
      </div>
    </aside>
  );
}
