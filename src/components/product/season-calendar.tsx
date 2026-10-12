import type { ProductSeason } from "@/lib/seasons/calendar";
import { seasonRowCopy, upcomingCopy } from "@/lib/seasons/calendar";
import type { CategorySeasonView } from "@/lib/seasons/category";
import { categorySeasonRowCopy } from "@/lib/seasons/category";

/**
 * "Lịch mùa giá" on the product page (UI spec §5.1): the next event date (a calendar fact, every state),
 * completed windows from recorded history, and a ranked bar list only with enough history. No advice.
 */
export function SeasonCalendar({ season }: { season: ProductSeason }) {
  const ranked = season.status === "ok" ? season.ranked : null;
  const maxDepth = ranked ? Math.max(...ranked.map((e) => Math.max(0, 1 - e.medianRatio)), 0.01) : 0;
  return (
    <section aria-labelledby="season-title" className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-ink-3">Theo các đợt sale lớn</span>
          <h2 id="season-title" className="display text-h3 font-semibold text-ink">
            Lịch mùa giá
          </h2>
        </div>
        {season.upcoming ? (
          <p className="rounded-full bg-accent px-3.5 py-1 text-body-sm font-semibold text-on-accent">{upcomingCopy(season.upcoming)}</p>
        ) : null}
      </div>

      {season.status === "insufficient" ? (
        <p className="text-body-sm text-ink-3">
          Chưa đủ dữ liệu: DealScore mới ghi nhận <span className="num">{season.coveredDays}</span> ngày giá, chưa có đợt sale nào đủ dữ
          liệu để so.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {season.events.map((e) => {
              const c = seasonRowCopy(e);
              return (
                <li key={e.key} className="flex flex-col gap-2 rounded-tile bg-surface-2/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="num text-h2 font-bold leading-none text-ink">{c.label}</p>
                    <span className="eyebrow shrink-0 pt-1 text-ink-3">{c.count}</span>
                  </div>
                  <p className={`num text-body-sm leading-snug ${c.lower ? "font-semibold text-buy" : "text-ink-2"}`}>{c.text}</p>
                </li>
              );
            })}
          </ul>
          {season.status === "partial" ? (
            <p className="text-micro text-ink-3">
              Cần khoảng <span className="num">{season.minDays}</span> ngày để xếp hạng các đợt.
            </p>
          ) : null}
          {ranked ? (
            <div className="space-y-2">
              <h3 className="text-body-sm font-semibold text-ink">Các đợt giá xuống sâu nhất trong lịch sử ghi nhận</h3>
              <div
                role="img"
                aria-label={ranked.map((e) => `${e.label}: ${Math.round((1 - e.medianRatio) * 100)}%`).join(", ")}
                className="flex flex-col gap-1.5"
              >
                {ranked.slice(0, 9).map((e) => {
                  const depth = Math.max(0, 1 - e.medianRatio);
                  return (
                    <div key={e.key} className="relative flex h-8 items-center overflow-hidden rounded-sm bg-surface-2">
                      <div className="absolute inset-y-0 left-0 bg-buy-soft" style={{ width: `${Math.round((depth / maxDepth) * 100)}%` }} />
                      <span className="relative px-2.5 text-label font-semibold text-ink">
                        {e.label} · <span className="num">{Math.round(depth * 100)}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
      <p className="text-micro text-ink-3">Không tính giá flash sale. Chỉ là lịch sử đã ghi nhận, không phải dự báo.</p>
    </section>
  );
}

/** Category strip (UI spec §5.2), closed by default; hidden entirely when the category has no row. */
export function CategorySeasonStrip({ name, view }: { name: string; view: CategorySeasonView | null }) {
  if (!view) return null;
  return (
    <details className="rounded-lg border border-line bg-surface px-4 py-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center text-body-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        Lịch mùa giá của {name}
      </summary>
      {view.status === "insufficient" ? (
        <p className="pb-1 pt-2 text-body-sm text-ink-3">
          Chưa đủ dữ liệu: cần ít nhất <span className="num">{view.min}</span> sản phẩm có lịch sử qua đợt sale (hiện có{" "}
          <span className="num">{view.best}</span>).
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pb-1 pt-2">
          {view.events.map((r) => (
            <li key={r.key} className="num text-body-sm text-ink-2">
              {categorySeasonRowCopy(r)}
            </li>
          ))}
        </ul>
      )}
      <p className="pt-1 text-micro text-ink-3">Chỉ là lịch sử đã ghi nhận, không phải dự báo.</p>
    </details>
  );
}
