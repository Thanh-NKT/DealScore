import type { MarketplaceComparison } from "@/lib/pricing/marketplace-compare";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { formatVnd } from "@/lib/format";
import { BuyButton } from "./buy-button";
import { MarketplaceMark } from "./marketplace-mark";
import { AFFILIATE_SENTENCE, NEUTRAL_CHIP, OFFER_CARD } from "./offer-list";

/** Anchor of the face-off; the decision panel links to it. */
export const MARKETPLACE_COMPARE_ID = "so-sanh-san";

// Up to three marketplaces side by side; more wrap onto the next row.
const COLS: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

/**
 * "So sánh giữa các sàn" (Phase 2) — the face-off. Only rendered when compareMarketplaces() found at
 * least two marketplaces with a real in-stock price. One column per marketplace, ranked by the price
 * paid after vouchers (listed price + "≈ X sau voucher" when lower), with a neutral "VS" between them.
 * Every column has the same template; the marketplace shows only in its mark and its exit button,
 * which wears that marketplace's colour. The cheapest column says so ("Rẻ nhất") and gets the solid
 * button; the others show the gap and the outlined one. Each column draws the price it pays as a bar
 * against the dearest one, so the gap reads at a glance.
 */
export function MarketplaceCompare({ comparison, offers }: { comparison: MarketplaceComparison; offers: PricedOffer[] }) {
  const byId = new Map(offers.map((o) => [o.offerId, o]));
  const paid = (row: MarketplaceComparison["rows"][number]) => row.effectivePrice ?? row.price;
  const maxPaid = Math.max(...comparison.rows.map(paid));
  const cols = COLS[Math.min(comparison.rows.length, 3)] ?? "md:grid-cols-3";
  return (
    <section id={MARKETPLACE_COMPARE_ID} aria-labelledby="marketplace-compare-heading" className={`${OFFER_CARD} scroll-mt-28`}>
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow text-ink-3">Mua ở sàn nào?</span>
        <h2 id="marketplace-compare-heading" className="display text-h3 font-bold leading-tight text-ink sm:text-h2-sm">
          So sánh giữa các sàn
        </h2>
        <p className="max-w-[75ch] text-body-sm text-ink-2">{comparison.summary}</p>
      </div>

      <ol className={`grid grid-cols-1 gap-3 ${cols}`}>
        {comparison.rows.map((row, i) => {
          const offer = byId.get(row.offerId);
          const cheapest = row.gap === 0;
          const width = maxPaid > 0 ? Math.max(6, (paid(row) / maxPaid) * 100) : 100;
          return (
            <li
              key={row.marketplace}
              className={`relative flex min-w-0 flex-col gap-4 rounded-tile border p-5 ${
                cheapest ? "border-primary/40 bg-primary-soft/40 ring-1 ring-primary/15" : "border-line bg-surface"
              }`}
            >
              {/* The neutral "VS" on the line between two columns (wide screens, same row only). */}
              {i > 0 && i % 3 !== 0 && (
                <span
                  aria-hidden="true"
                  className="display absolute -left-[22px] top-1/2 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-micro font-bold text-ink-3 shadow-sm md:flex"
                >
                  VS
                </span>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <MarketplaceMark marketplace={row.marketplace} size="md" />
                  <span className="truncate text-control font-semibold text-ink">{row.name}</span>
                </span>
                {cheapest ? (
                  <span className={NEUTRAL_CHIP}>Rẻ nhất</span>
                ) : (
                  <span className="num whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-0.5 text-micro font-semibold text-ink-2">
                    +{formatVnd(row.gap)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <p className="num text-price-row font-bold leading-tight text-ink sm:text-h3">{formatVnd(row.price)}</p>
                {row.effectivePrice != null && (
                  <span className="text-label text-ink-2">
                    ≈ <span className="num font-bold text-ink">{formatVnd(row.effectivePrice)}</span> sau voucher
                  </span>
                )}
              </div>

              <div className="mt-auto flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={`bar-grow block h-full origin-left rounded-full ${cheapest ? "bg-primary" : "bg-line-strong/55"}`}
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <p className="text-label text-ink-3">
                    <span className="num font-semibold text-ink-2">{row.sellers}</span> người bán còn hàng
                  </p>
                </div>

                <BuyButton
                  offerId={row.offerId}
                  marketplace={row.marketplace}
                  hasLink={Boolean(offer?.listingUrl)}
                  affiliate={offer?.affiliateEligible ?? false}
                  variant={row.marketplace === comparison.cheapest ? "primary" : "secondary"}
                  affiliateLabel={false}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line pt-4">
        <p className="max-w-[75ch] text-label leading-[1.45] text-ink-3">{AFFILIATE_SENTENCE}</p>
      </div>
    </section>
  );
}
