interface DraftProductNoticeProps {
  isDraft: boolean;
}

export function DraftProductNotice({ isDraft }: DraftProductNoticeProps) {
  if (!isDraft) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-black/[0.02] p-4 text-sm dark:bg-white/[0.02]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-foreground">Sản phẩm mới thêm</h4>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Chúng tôi vừa bắt đầu theo dõi sản phẩm này. Cần khoảng 14 ngày để có đủ dữ liệu chấm điểm.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="shrink-0 cursor-not-allowed rounded-lg border border-border bg-black/5 px-3 py-2 text-xs font-medium text-muted dark:bg-white/5"
          title="Tính năng Watch sẽ có ở giai đoạn tiếp theo"
        >
          🔔 Tạo Watch theo dõi
        </button>
      </div>
    </div>
  );
}
