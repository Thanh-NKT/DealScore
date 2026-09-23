import type { HistoryStats } from "@/lib/pricing/price-history";
import { formatVnd } from "@/lib/format";

interface StatsRowProps {
  /** Luôn có số khi có dữ liệu — không phụ thuộc Deal Score đã đủ ngưỡng hay chưa. */
  stats: HistoryStats;
  trackingSince: string | null;
}

export function StatsRow({ stats, trackingSince }: StatsRowProps) {
  const { low, median, high, dayCount } = stats;

  const formatDate = (dStr: string | null) => {
    if (!dStr) return "—";
    try {
      const parts = dStr.split("-");
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dStr;
    } catch {
      return dStr;
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border p-3 text-center">
          <div className="text-[11px] font-medium text-muted uppercase tracking-wider">
            Đáy (90 ngày)
          </div>
          <div className="mt-1 text-base font-bold text-foreground">
            {formatVnd(low)}
          </div>
        </div>

        <div className="rounded-xl border border-border p-3 text-center">
          <div className="text-[11px] font-medium text-muted uppercase tracking-wider">
            Trung vị (90 ngày)
          </div>
          <div className="mt-1 text-base font-bold text-foreground">
            {formatVnd(median)}
          </div>
        </div>

        <div className="rounded-xl border border-border p-3 text-center">
          <div className="text-[11px] font-medium text-muted uppercase tracking-wider">
            Đỉnh (90 ngày)
          </div>
          <div className="mt-1 text-base font-bold text-foreground">
            {formatVnd(high)}
          </div>
        </div>

        <div className="rounded-xl border border-border p-3 text-center">
          <div className="text-[11px] font-medium text-muted uppercase tracking-wider">
            Bắt đầu theo dõi
          </div>
          <div className="mt-1 text-base font-bold text-foreground">
            {formatDate(trackingSince)}
          </div>
          {dayCount < 30 && dayCount > 0 && (
            <div className="text-[10px] text-muted">
              (Dựa trên {dayCount} ngày có dữ liệu)
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted italic">
        * Tính trên giá tốt nhất mỗi ngày, đã loại các đợt flash sale.
      </p>
    </div>
  );
}
