import { sellerProfileCopy, type SellerProfileView } from "@/lib/sellers/profile";
import { voucherPatternCopy, voucherSummaryCopy, type VoucherPatternSummary } from "@/lib/vouchers/patterns";
import { toVnDate } from "@/lib/format";

const CARD = "flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-xs";

/** "Giá của shop trong 90 ngày" (UI spec §4.1). Facts or the numbered "Chưa đủ dữ liệu" — never a guess. */
export function SellerProfileCard({ profile }: { profile: SellerProfileView | null }) {
  const copy = profile ? sellerProfileCopy(profile) : null;
  return (
    <section aria-labelledby="seller-profile-title" className={CARD}>
      <h2 id="seller-profile-title" className="display text-h4 font-bold text-ink">
        Giá của shop trong 90 ngày
      </h2>
      {!profile || !copy ? (
        <p className="text-body-sm text-ink-3">Chưa đủ dữ liệu: DealScore chưa tổng hợp giá của shop này trong tuần qua.</p>
      ) : copy.insufficient ? (
        <p className="text-body-sm text-ink-3">{copy.insufficient}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {copy.stability ? (
            <div>
              <p className="num display text-stat font-extrabold text-ink">{copy.stability.big}</p>
              <p className="text-body-sm text-ink-2">{copy.stability.label}</p>
              <p className="text-body-sm text-ink-3">{copy.stability.sub}</p>
            </div>
          ) : null}
          {copy.discounts ? (
            <div className="space-y-1">
              <p className="text-body-sm text-ink">{copy.discounts.line}</p>
              {copy.discounts.doubtfulPct != null ? (
                <p className="text-body-sm font-semibold text-wait">
                  <span className="num">{copy.discounts.doubtfulPct}%</span> lần ghi giảm giá có mức giảm chưa thực chất
                </p>
              ) : null}
              <p className="text-micro text-ink-3">
                Một lần = một tin bán trong một tuần. Kiểm tra bằng đúng cách DealScore đánh giá giảm giá trên trang sản phẩm.
              </p>
            </div>
          ) : null}
        </div>
      )}
      {profile?.status === "ok" ? (
        <p className="text-micro text-ink-3">Cập nhật {toVnDate(profile.computedAt)} · Không ảnh hưởng Deal Score.</p>
      ) : (
        <p className="text-micro text-ink-3">Không ảnh hưởng Deal Score.</p>
      )}
    </section>
  );
}

/** "Mã giảm giá của shop" (UI spec §4.1). */
export function VoucherPatternsCard({ summary }: { summary: VoucherPatternSummary }) {
  const empty = voucherSummaryCopy(summary);
  return (
    <section aria-labelledby="seller-vouchers-title" className={CARD}>
      <h2 id="seller-vouchers-title" className="display text-h4 font-bold text-ink">
        Mã giảm giá của shop
      </h2>
      {summary.status === "patterns" ? (
        <ul className="flex flex-col gap-3">
          {summary.patterns.map((p) => {
            const c = voucherPatternCopy(p);
            return (
              <li key={p.label} className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-body font-semibold text-ink">{c.title}</p>
                  <p className="text-body-sm text-ink-2">
                    {c.months}
                    {c.timing ? `, ${c.timing}` : ""}
                  </p>
                </div>
                {p.seenRecently ? (
                  <span className="inline-flex min-h-7 items-center rounded-full bg-buy-soft px-3 text-label font-semibold text-buy">Đang có</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body-sm text-ink-3">{empty}</p>
      )}
      <p className="text-micro text-ink-3">Chỉ là những gì DealScore đã ghi nhận, không phải lịch của shop.</p>
    </section>
  );
}
