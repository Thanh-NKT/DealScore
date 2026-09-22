import {
  type DealScoreResult,
  RECOMMENDATION_LABEL,
} from "@/lib/deal-score";

interface DealScoreBadgeProps {
  result: DealScoreResult;
}

export function DealScoreBadge({ result }: DealScoreBadgeProps) {
  const { score, recommendation, stats } = result;
  const label = RECOMMENDATION_LABEL[recommendation];

  // Màu sắc theo token CSS đã định nghĩa trong globals.css
  const colorMap = {
    buy: "text-rec-buy bg-rec-buy-bg border-rec-buy/30",
    wait: "text-rec-wait bg-rec-wait-bg border-rec-wait/30",
    avoid: "text-rec-avoid bg-rec-avoid-bg border-rec-avoid/30",
    insufficient_data: "text-rec-unknown bg-rec-unknown-bg border-rec-unknown/30",
  };

  const badgeClass = colorMap[recommendation] || colorMap.insufficient_data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        {recommendation === "insufficient_data" ? (
          <div
            className={`flex h-20 items-center justify-center rounded-2xl border px-5 py-3 font-semibold ${badgeClass}`}
          >
            <div className="text-center">
              <div className="text-base font-bold">{label}</div>
              <div className="mt-0.5 text-xs opacity-80">
                Đã theo dõi {stats.daysCovered} ngày (cần tối thiểu 14 ngày)
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl border ${badgeClass}`}
            >
              <span className="text-3xl font-extrabold tracking-tight">
                {score ?? "—"}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                / 100
              </span>
            </div>

            <div>
              <div className="text-xl font-bold tracking-tight">{label}</div>
              <p className="mt-1 text-xs text-muted">
                Dựa trên phân tích phân vị giá và khoảng cách tới đáy lịch sử
              </p>
            </div>
          </>
        )}
      </div>

      {/* Phần giải thích mở rộng (dùng thẻ native <details> hoạt động không cần JS) */}
      <details className="group rounded-xl border border-border bg-black/[0.02] p-3 text-xs text-muted dark:bg-white/[0.02]">
        <summary className="cursor-pointer font-medium text-foreground hover:underline">
          Cách Kairo chấm điểm Deal Score?
        </summary>
        <div className="mt-2.5 space-y-2 leading-relaxed">
          <p>
            Điểm hiển thị đầu trang được tính toán độc lập cho offer rẻ nhất với
            trọng số: <strong>62.5%</strong> theo phân vị giá 90 ngày và{" "}
            <strong>37.5%</strong> theo khoảng cách tới mức đáy lịch sử (đã loại trừ flash sale).
          </p>
          <p className="text-[11px] italic opacity-80">
            * Đây là thông tin tham khảo dựa trên lịch sử dữ liệu thu thập, không phải lời khuyên tài chính.
          </p>
        </div>
      </details>
    </div>
  );
}
