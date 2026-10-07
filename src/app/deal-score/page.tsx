import type { Metadata } from "next";
import { VerdictTag } from "@/components/product/verdict-tag";
import { AccuracyTrend } from "@/components/transparency/accuracy-trend";
import { MIN_DAYS_FOR_SCORE, MIN_OBSERVATIONS_FOR_SCORE } from "@/lib/pricing/deal-score";
import { DEFAULT_DROP_THRESHOLD, DEFAULT_HORIZON_DAYS } from "@/lib/pricing/backtest";
import { staticPageMetadata } from "@/lib/seo/static-page";
import { siteUrl } from "@/lib/site-url";
import { ACCURACY_MIN_SAMPLES, type Rate } from "@/lib/transparency/accuracy";
import { loadAccuracy } from "@/lib/transparency/load";

// Dynamic like every page (per-request nonce CSP); the backtest read itself is cached for an hour (load.ts).
export const dynamic = "force-dynamic";

const leadText = (horizonDays: number) =>
  `Mỗi tuần DealScore chấm lại kết luận trên lịch sử giá đã ghi nhận và kiểm tra giá ${horizonDays} ngày sau đó. Đây là kết quả thật, kể cả khi chưa đẹp.`;

export const metadata: Metadata = staticPageMetadata(
  { path: "/deal-score", title: "Độ chính xác Deal Score", description: leadText(DEFAULT_HORIZON_DAYS) },
  siteUrl(),
);

const pctText = (v: number) => `${Math.round(v * 100)}%`;
const vnDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

function RateTile({
  recommendation,
  rate,
  definition,
}: {
  recommendation: "buy" | "wait" | "avoid";
  rate: Rate;
  definition: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-xs">
      <VerdictTag recommendation={recommendation} />
      {rate.pct != null ? (
        <span className="num display text-stat font-extrabold text-ink">{pctText(rate.pct)}</span>
      ) : (
        <span className="display text-h4 font-bold text-ink-2">Chưa đủ mẫu</span>
      )}
      <span className="num text-label text-ink-2">
        {rate.correct}/{rate.n} lần đúng
      </span>
      <p className="text-micro leading-relaxed text-ink-3">{definition}</p>
    </div>
  );
}

export default async function DealScoreAccuracyPage() {
  const summary = await loadAccuracy();
  const latest = summary.latest;
  const horizon = latest?.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const dropPct = Math.round((latest?.dropThreshold ?? DEFAULT_DROP_THRESHOLD) * 100);
  const trendPoints = summary.trend.filter((t) => t.overall != null).length;

  return (
    <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-14">
      <div className="max-w-[68ch]">
        <h1 className="display text-h2 font-extrabold leading-tight text-balance text-ink">Deal Score đúng tới đâu?</h1>
        <p className="mt-4 text-body leading-relaxed text-ink-2">{leadText(horizon)}</p>
      </div>

      {latest != null && summary.enough ? (
        <>
          <section aria-labelledby="accuracy-latest" className="mt-10 flex flex-col gap-6">
            <h2 id="accuracy-latest" className="sr-only">
              Lần kiểm tra gần nhất
            </h2>
            {latest.overall != null && (
              <div className="flex flex-col gap-1">
                <span className="num display text-stat font-extrabold text-gradient-primary">{pctText(latest.overall)}</span>
                <span className="num text-body-sm text-ink-2">
                  kết luận đúng trong lần kiểm tra gần nhất · {latest.samples} mẫu, {latest.variants} sản phẩm ·{" "}
                  {vnDate(latest.ranAt)}
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <RateTile
                recommendation="buy"
                rate={latest.buy}
                definition={`Nên mua đúng khi giá không giảm thêm từ ${dropPct}% trở lên trong ${horizon} ngày sau đó.`}
              />
              <RateTile
                recommendation="wait"
                rate={latest.wait}
                definition={`Có thể chờ đúng khi giá có giảm từ ${dropPct}% trở lên trong ${horizon} ngày sau đó.`}
              />
              <RateTile
                recommendation="avoid"
                rate={latest.avoid}
                definition={`Chưa nên mua đúng khi giá có giảm từ ${dropPct}% trở lên trong ${horizon} ngày sau đó.`}
              />
            </div>
          </section>

          {trendPoints >= 2 && (
            <section aria-labelledby="accuracy-trend" className="mt-10 rounded-lg border border-line bg-surface p-5 shadow-xs sm:p-6">
              <h2 id="accuracy-trend" className="display text-h4 font-bold text-ink">
                Tỉ lệ đúng qua các tuần
              </h2>
              <div className="mt-4">
                <AccuracyTrend trend={summary.trend} />
              </div>
            </section>
          )}
        </>
      ) : (
        <p className="mt-10 max-w-[68ch] rounded-lg border border-line bg-surface-2/60 p-5 text-body leading-relaxed text-ink-2">
          Chưa đủ số liệu backtest để công bố tỉ lệ. DealScore sẽ hiện số khi có ít nhất{" "}
          <span className="num font-semibold text-ink">{ACCURACY_MIN_SAMPLES}</span> lần kiểm tra.
        </p>
      )}

      <section aria-labelledby="accuracy-method" className="mt-12 max-w-[68ch]">
        <h2 id="accuracy-method" className="display text-h3 font-bold text-ink">
          Cách tính
        </h2>
        <div className="mt-3 space-y-3 text-body leading-[1.6] text-ink-2">
          <p>
            Deal Score so giá hiện tại với lịch sử giá 90 ngày DealScore ghi nhận: 62,5% là vị trí của giá trong 90 ngày, 37,5% là
            khoảng cách tới mức thấp nhất. Sau đó cộng hoặc trừ vài điểm theo xu hướng giá gần đây và mức dao động giá.
          </p>
          <p>
            Cần ít nhất {MIN_DAYS_FOR_SCORE} ngày và {MIN_OBSERVATIONS_FOR_SCORE} lần ghi nhận giá để chấm. Giá flash sale không được
            tính vào lịch sử giá. Hoa hồng tiếp thị không làm thay đổi điểm.
          </p>
          <p>
            Mỗi lần kiểm tra, DealScore lùi về một ngày trong quá khứ, chấm lại kết luận chỉ bằng dữ liệu có tới ngày đó, rồi xem giá{" "}
            {horizon} ngày tiếp theo. Chỉ phiên bản Deal Score đang chạy được công bố ở đây.
          </p>
        </div>
      </section>
    </main>
  );
}
