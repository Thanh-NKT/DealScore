interface DealReasonsProps {
  reasons: string[];
}

export function DealReasons({ reasons }: DealReasonsProps) {
  if (!reasons || reasons.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-black/[0.01] p-4 dark:bg-white/[0.01]">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        Lý do đánh giá
      </h3>
      <ul className="space-y-1.5 text-sm">
        {reasons.map((reason, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="text-foreground/90">{reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
