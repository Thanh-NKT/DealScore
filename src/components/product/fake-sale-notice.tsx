interface FakeSaleNoticeProps {
  message: string | null;
}

export function FakeSaleNotice({ message }: FakeSaleNoticeProps) {
  if (!message) {
    return null;
  }

  return (
    <aside
      role="note"
      className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-bg p-4 text-sm text-warn"
    >
      <span className="text-base select-none" aria-hidden="true">
        ⚠️
      </span>
      <div>
        <h4 className="font-semibold text-warn">Giảm giá chưa thực chất</h4>
        <p className="mt-0.5 text-xs opacity-90 leading-relaxed">{message}</p>
      </div>
    </aside>
  );
}
