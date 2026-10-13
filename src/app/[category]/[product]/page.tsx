import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { loadActiveVouchers, loadProductPageData } from "@/lib/product/page-data";
import { loadSlugRedirect, slugRedirectPath } from "@/lib/product/slug-redirect";
import { createClient } from "@/lib/supabase/server";
import { toGroups } from "@/lib/vouchers/select";
import { collectedAt as vouchersCollectedAt } from "@/lib/vouchers/store";
import { PriceSummary } from "@/components/product/price-summary";
import { UnitPriceNote } from "@/components/product/unit-price";
import { SeasonCalendar } from "@/components/product/season-calendar";
import { productVoucherLine } from "@/lib/vouchers/patterns";
import { unitPrice } from "@/lib/pricing/unit-price";
import { VariantPicker } from "@/components/product/variant-picker";
import { variantVerdict } from "@/lib/pricing/variant-verdict";
import { verdictNote } from "@/lib/pricing/verdict-copy";
import { compareMarketplaces } from "@/lib/pricing/marketplace-compare";
import { MARKETPLACE_COMPARE_ID, MarketplaceCompare } from "@/components/product/marketplace-compare";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { PriceRuler } from "@/components/product/price-ruler";
import { UpdatedAt } from "@/components/product/updated-at";
import { BuyButton } from "@/components/product/buy-button";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { DraftProductNotice } from "@/components/product/draft-product-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getMyWatchForVariant } from "@/lib/watch/queries";
import { WatchButton } from "@/components/watch/watch-button";
import { buildProductJsonLd, productMetadata, productRedirectPath, serializeJsonLd, toSeoProduct } from "@/lib/seo/product";
import { siteUrl } from "@/lib/site-url";
import { trackAfter } from "@/lib/analytics/track";
import { isShareVisit, shareText, shareUrl } from "@/lib/share";
import { ShareButton } from "@/components/share/share-button";
import { marketplaceName } from "@/components/product/marketplace";
import { MarketplaceMark } from "@/components/product/marketplace-mark";
import { ProductGallery } from "@/components/product/product-gallery";
import { InteractivePriceChart } from "@/components/product/interactive-price-chart";
import { DealScoreBreakdown } from "@/components/product/deal-score-breakdown";
import { OfferList, VOUCHER_SECTION_ID } from "@/components/product/offer-list";
import { PriceAlertCard } from "@/components/product/price-alert-card";
import { DataReportDialog } from "@/components/product/data-report-dialog";
import { VoucherPicker } from "@/components/product/voucher-picker";
import { DiscountVerifyBanner } from "@/components/product/discount-verify-banner";
import { ProductStickyBar } from "@/components/product/product-sticky-bar";
import { variantLabel } from "@/components/product/variant-label";
import { canRefreshVouchers } from "@/lib/vouchers/refresh";

interface PageProps {
  params: Promise<{ category: string; product: string }>;
  searchParams: Promise<{ variant?: string; range?: string; ref?: string }>;
}

export const dynamic = "force-dynamic";

const getPageData = cache((productSlug: string, variantId: string | undefined) =>
  loadProductPageData({ productSlug, variantId }),
);

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { product } = await params;
  const { variant } = await searchParams;
  const data = await getPageData(product, variant);
  return data ? productMetadata(toSeoProduct(data), siteUrl()) : {};
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const { category: categorySegment, product: productSlug } = await params;
  const query = await searchParams;
  const { variant, range: rawRange, ref } = query;

  let range: 7 | 30 | 90 = 30;
  if (rawRange === "7") range = 7;
  else if (rawRange === "90") range = 90;

  // The viewer is independent of the product: start the Auth + profile read now, in parallel with the
  // page data, instead of after it. The no-op catch keeps a 404 path from leaving it unhandled.
  const userPromise = getCurrentUser();
  userPromise.catch(() => {});

  const data = await getPageData(productSlug, variant);

  if (!data) {
    // A merged product's old slug (migration 0050): one 308 hop to the product it was merged into.
    // src/proxy.ts answers the real HTTP 308 from its cached table; this per-slug lookup is the fallback for
    // a merge newer than that cache (it streams, so it is a client-side redirect).
    const redirect = await loadSlugRedirect(await createClient(), productSlug);
    if (redirect) permanentRedirect(slugRedirectPath(redirect, query));
    notFound();
  }

  // /{anything}/{slug} used to render the page too: send it to the product's own category (308).
  const canonicalTarget = productRedirectPath(categorySegment, data.product, query);
  if (canonicalTarget) permanentRedirect(canonicalTarget);

  const { product, variants, selectedVariantId, pricing, dailyPrices } = data;
  // The indexable category landing page; a product without a category (san-pham fallback) has none.
  const categoryHref = product.categorySlug === "san-pham" ? "/search" : `/${product.categorySlug}`;
  // One "now" for server and client renders of the chart (its Vietnam day decides the window).
  const nowIso = new Date().toISOString();

  const user = await userPromise;
  const existingWatch = user
    ? await getMyWatchForVariant(user.id, selectedVariantId).catch((err) => {
        console.error("getMyWatchForVariant failed", err);
        return null;
      })
    : null;

  const currentVariant = variants.find((v) => v.id === selectedVariantId);
  const currentPath = `/${product.categorySlug}/${product.slug}?variant=${selectedVariantId}&range=${range}`;

  const headline = pricing.headline;
  const recommendation: Recommendation | null =
    headline && headline.score != null ? headline.recommendation : headline ? "insufficient_data" : null;
  const hasFakeSale = Boolean(pricing.fakeSaleMessage?.trim());
  // Deal Score label per variant chip: live headline for the selected one, a still-matching cache for the others.
  const verdictNow = new Date(nowIso);
  const pickerVariants = variants.map((v) => ({
    ...v,
    verdict: variantVerdict({ variant: v, selectedId: selectedVariantId, headline, cached: v.cachedScore, now: verdictNow }),
  }));
  // Deal Score, Watch and the chart work on the cheapest LISTED price (history has no vouchers)…
  const cheapest = pricing.cheapest;
  const currentPrice = cheapest?.price ?? pricing.lastKnown?.price ?? null;
  // …while "where to buy" follows the price the buyer pays after vouchers, on whichever marketplace.
  const buy = pricing.bestBuy ?? cheapest;
  const buyListedPrice = buy?.price ?? currentPrice;
  // P4 G: price per ml / g / piece of the hero price, from the selected variant's own text.
  const heroUnitPrice = unitPrice(buyListedPrice, currentVariant?.unitQuantity ?? null);

  trackAfter("product_viewed", {
    userId: user?.id ?? null,
    props: {
      product_id: product.id,
      variant_id: selectedVariantId,
      recommendation: recommendation ?? undefined,
      is_draft: product.status === "draft",
    },
  });

  if (isShareVisit(ref)) {
    trackAfter("share_opened", { userId: user?.id ?? null, props: { product_id: product.id } });
  }

  const jsonLd = buildProductJsonLd(toSeoProduct(data), siteUrl());
  const offerCount = pricing.offers.length;
  // The marketplaces this variant is tracked on, cheapest offer's first (offers are sorted by price).
  const trackedMarketplaces = [...new Set(pricing.offers.map((o) => o.marketplace))];
  const marketplaceComparison = compareMarketplaces(pricing.offers);

  const goHref =
    buy?.listingUrl
      ? `/go/${encodeURIComponent(buy.marketplace)}/${encodeURIComponent(buy.offerId)}?src=web`
      : null;

  const voucherPlatform = buy ? marketplaceName(buy.marketplace) : "Shopee";
  const voucherListing = buy ? data.offerListings?.[buy.offerId] : undefined;
  // Same list the offers' effective prices were computed from (page-data), so the picker's estimate,
  // the offer line and the Deal Score reason agree.
  const vouchers =
    buy && voucherListing && buyListedPrice != null && buyListedPrice > 0
      ? (data.offerVouchers?.[buy.offerId] ?? (await loadActiveVouchers(voucherListing)))
      : [];
  const voucherGroups =
    buyListedPrice != null && buyListedPrice > 0 ? toGroups(vouchers, buyListedPrice, voucherPlatform) : [];

  return (
    <div className="flex w-full flex-col bg-canvas pb-24">
      <div className="mx-auto w-full max-w-[1440px] px-4 pt-6 sm:px-6 lg:px-14">
        {jsonLd && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
        )}

        {/* Breadcrumb Bar */}
        <nav aria-label="Đường dẫn" className="flex flex-wrap items-center gap-1.5 pb-6 text-label text-ink-3">
          <Link href="/" className="rounded-full px-1 transition-colors hover:text-ink">
            Trang chủ
          </Link>
          <span aria-hidden="true" className="text-line-strong">›</span>
          <Link href={categoryHref} className="rounded-full px-1 transition-colors hover:text-ink">
            {product.categoryName}
          </Link>
          <span aria-hidden="true" className="text-line-strong">›</span>
          <span className="max-w-[42ch] truncate px-1 font-medium text-ink-2">{product.canonicalName}</span>
        </nav>

        <article className="flex flex-col gap-12">
          {/* Section 1: title, gallery, variants + the decision panel */}
          <section className="grid grid-cols-1 items-start gap-8 min-[1121px]:grid-cols-[minmax(0,1fr)_minmax(0,560px)] min-[1121px]:gap-12 2xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
            {/* Left: title, gallery, variants (90-day stats live in the ruler and the chart card) */}
            <div className="flex min-w-0 flex-col gap-6 max-[1120px]:contents">
              <div className="flex flex-col gap-3 max-[1120px]:order-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={categoryHref}
                    className="eyebrow rounded-full border border-line bg-surface px-2.5 py-1 text-ink-2 transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {product.categoryName}
                  </Link>
                  {offerCount >= 1 && (
                    <span className="rounded-full bg-accent px-2.5 py-1 text-micro font-semibold text-on-accent">
                      Đã gom {offerCount} nơi bán cùng mẫu
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-micro text-ink-3">
                    {!pricing.isStale && (
                      <span aria-hidden="true" className="relative flex size-2">
                        <span className="absolute inset-0 animate-ping rounded-full bg-buy/50 motion-reduce:hidden" />
                        <span className="relative size-2 rounded-full bg-buy" />
                      </span>
                    )}
                    {pricing.updatedAt ? <UpdatedAt iso={pricing.updatedAt} isStale={pricing.isStale} variant="compact" /> : "Vừa cập nhật"}
                  </span>
                </div>

                <h1 className="display max-w-[30ch] text-h2-sm font-bold leading-[1.06] text-ink sm:text-h2 xl:text-h1">
                  {product.canonicalName}
                </h1>

                {(product.brand || product.model) && (
                  <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-label text-ink-3">
                    {product.brand && (
                      <div className="flex gap-1.5">
                        <dt>Thương hiệu</dt>
                        <dd className="font-semibold text-ink">{product.brand}</dd>
                      </div>
                    )}
                    {product.model && (
                      <div className="flex gap-1.5">
                        <dt>Mã SP</dt>
                        <dd className="font-semibold text-ink">{product.model}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>

              {/* Phones: title, variants, the decision panel, then the gallery */}
              <div className="min-w-0 max-[1120px]:order-4 min-[1121px]:max-w-[640px]">
                <ProductGallery
                  image={product.image}
                  alt={product.canonicalName}
                  galleryImages={data.galleryImages}
                />
              </div>
              <div className="min-w-0 empty:hidden max-[1120px]:order-2">
                <VariantPicker variants={pickerVariants} selectedId={selectedVariantId} range={range} />
              </div>
            </div>

            {/* Right: the decision panel (sticky on wide screens) */}
            <div className="flex min-w-0 flex-col max-[1120px]:order-3 min-[1121px]:sticky min-[1121px]:top-28">
              <div className="flex flex-col overflow-hidden rounded-hero border border-line bg-surface shadow-lift">
                {/* Panel head: the marketplaces this answer weighs, each in its own colour. */}
                <div className="bg-iris-wash flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-7">
                  <span className="eyebrow text-ink-3">Bảng quyết định</span>
                  {trackedMarketplaces.length > 0 && (
                    <span className="flex min-w-0 items-center gap-2 text-micro text-ink-3">
                      <span className="truncate">{trackedMarketplaces.length > 1 ? "Đang so trên" : "Theo dõi trên"}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {trackedMarketplaces.map((m) => (
                          <MarketplaceMark key={m} marketplace={m} size="sm" label />
                        ))}
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-5 p-5 sm:p-7">
                  {/* Price + Deal Score gauge */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-[1_1_12rem] flex-col">
                      <PriceSummary
                        cheapest={buy ?? pricing.lastKnown}
                        offerCount={offerCount}
                      />
                      <UnitPriceNote unitPrice={heroUnitPrice} variantKey={currentVariant?.variantKey ?? ""} className="mt-1.5" />
                    </div>

                    {recommendation && (
                      <div className="flex shrink-0 flex-col items-center gap-1.5">
                        <ScoreRing
                          score={headline?.score}
                          recommendation={recommendation}
                          size="lg"
                        />
                        <span className="eyebrow text-ink-3">Deal Score</span>
                      </div>
                    )}
                  </div>

                  {recommendation && (
                    <VerdictTag
                      recommendation={recommendation}
                      size="lg"
                      note={verdictNote(recommendation, hasFakeSale, cheapest?.isFlashSale ?? false)}
                    />
                  )}

                  {pricing.allOutOfStock && (
                    <p className="rounded-tile bg-surface-2 px-4 py-3 text-body-sm font-medium text-ink">
                      Tạm hết hàng ở mọi nơi bán đang theo dõi.
                    </p>
                  )}

                </div>

                {/* Actions (the sticky bar appears once this scrolls away) */}
                <div id="primary-buy" className="flex flex-col gap-3 border-t border-line bg-surface-2/40 p-5 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {buy && (
                      <BuyButton
                        offerId={buy.offerId}
                        marketplace={buy.marketplace}
                        hasLink={Boolean(buy.listingUrl)}
                        affiliate={buy.affiliateEligible}
                        variant="primary"
                        size="lg"
                        affiliateLabel={false}
                        className="h-13 min-w-0 flex-[1.2_1_13rem] text-control font-semibold"
                      />
                    )}
                    <div className="min-w-0 flex-[1_1_11rem]">
                      <WatchButton
                        isLoggedIn={Boolean(user)}
                        productName={product.canonicalName}
                        variantKey={currentVariant?.variantKey ?? ""}
                        variantId={selectedVariantId}
                        currentPrice={currentPrice}
                        existingWatch={existingWatch}
                        currentPath={currentPath}
                      />
                    </div>
                    <ShareButton
                      iconOnly
                      productId={product.id}
                      url={shareUrl(siteUrl(), product)}
                      title={product.canonicalName}
                      text={shareText({
                        slug: product.slug,
                        categorySlug: product.categorySlug,
                        canonicalName: product.canonicalName,
                        price: currentPrice,
                        recommendation,
                      })}
                      className="flex size-13 shrink-0 items-center justify-center rounded-full border border-line-strong/50 bg-surface text-ink transition-colors hover:border-primary hover:text-primary cursor-pointer"
                    />
                  </div>
                  <span className="text-micro leading-[1.45] text-ink-3">
                    Nếu bạn mua qua liên kết, DealScore có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả.
                  </span>
                </div>

                {/* The evidence under the action: where it is cheapest, and where today's price sits in 90 days. */}
                {(marketplaceComparison || pricing.stats.dayCount >= 2) && (
                  <div className="flex flex-col gap-3 border-t border-line p-5 sm:px-7">
                    {marketplaceComparison && (
                      <a
                        href={`#${MARKETPLACE_COMPARE_ID}`}
                        className="group flex items-center gap-3.5 rounded-tile border border-line px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary-soft/30"
                      >
                        <span aria-hidden="true" className="flex shrink-0 items-center -space-x-1.5">
                          {marketplaceComparison.rows.slice(0, 3).map((r) => (
                            <MarketplaceMark key={r.marketplace} marketplace={r.marketplace} size="md" round className="ring-2 ring-surface" />
                          ))}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-body-sm font-semibold leading-snug text-ink">{marketplaceComparison.summary}</span>
                          <span className="text-label font-semibold text-primary">
                            So sánh {marketplaceComparison.rows.length} sàn <span aria-hidden="true">↓</span>
                          </span>
                        </span>
                      </a>
                    )}

                    {/* Where the cheapest listed price sits in its 90-day range (same basis as the Deal Score) */}
                    {pricing.stats.dayCount >= 2 && (
                      <PriceRuler
                        low={pricing.stats.low}
                        median={pricing.stats.median}
                        high={pricing.stats.high}
                        current={cheapest?.price ?? null}
                        className="rounded-tile border border-line px-4 py-3.5"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Notice for ingest-created draft products */}
          <DraftProductNotice isDraft={product.status === "draft"} offerCount={offerCount} dataDays={dailyPrices.length} />

          {/* Cross-marketplace comparison ("sàn nào rẻ hơn?", the first question): renders only with ≥ 2 real
              marketplaces (never simulated), so it sits right under the decision panel. */}
          {marketplaceComparison && <MarketplaceCompare comparison={marketplaceComparison} offers={pricing.offers} />}

          {/* Section 2: Interactive Price History & Deal Score Breakdown */}
          <section className="grid grid-cols-1 items-start gap-6 min-[1121px]:grid-cols-[1fr_420px]">
            <InteractivePriceChart
              rows={dailyPrices}
              initialRange={range}
              nowIso={nowIso}
              // Only a live in-stock price is "today"; the last known price of a sold-out variant is not.
              currentPrice={cheapest?.price ?? null}
              currentIsFlashSale={cheapest?.isFlashSale ?? false}
              variantTitle={currentVariant ? variantLabel(currentVariant.variantKey) : product.canonicalName}
            />

            <DealScoreBreakdown
              score={headline?.score ?? null}
              recommendation={recommendation}
              reasons={headline?.reasons ?? []}
            />
          </section>

          {/* P4 A: price-season calendar (recorded history + next event date), after the chart, before offers */}
          {data.season ? <SeasonCalendar season={data.season} /> : null}


          {/* Section 3: Marketplace Comparison & Price Alert */}
          <section className="grid grid-cols-1 items-start gap-6 min-[1121px]:grid-cols-[1fr_420px]">
            <OfferList
              offers={pricing.offers}
              bestBuyId={buy?.offerId ?? null}
              offerVouchers={data.offerVouchers}
              offerSellers={Object.fromEntries(Object.entries(data.offerListings ?? {}).map(([id, l]) => [id, l.sellerId]))}
            />

            <PriceAlertCard
              currentPrice={currentPrice}
              lowestPrice={pricing.stats.low}
              existingConfig={existingWatch?.config ?? null}
              isLoggedIn={Boolean(user)}
              variantId={selectedVariantId}
              currentPath={currentPath}
              dailyPrices={dailyPrices}
              nowIso={nowIso}
            />
          </section>

          {/* "Góp ý dữ liệu": one entry point, under the seller list / price alert */}
          <div className="-mt-2 flex justify-end">
            <DataReportDialog
              productId={product.id}
              productName={product.canonicalName}
              variantId={selectedVariantId}
              offers={pricing.offers.map((o) => ({
                offerId: o.offerId,
                marketplace: o.marketplace,
                sellerName: o.sellerName,
                price: o.price,
              }))}
            />
          </div>

          {/* Section 3b: Voucher Picker */}
          <section id={VOUCHER_SECTION_ID} aria-labelledby="voucher-title">
            <VoucherPicker
              platform={voucherPlatform}
              productPrice={buyListedPrice}
              groups={voucherGroups}
              collectedAt={vouchersCollectedAt(vouchers)}
              goHref={goHref}
              refreshOfferId={buy && canRefreshVouchers(buy.marketplace) ? buy.offerId : null}
            />
            {/* P4 K: the best-buy seller's recorded voucher pattern, only when there is one */}
            {data.bestBuyVouchers && productVoucherLine(data.bestBuyVouchers.sellerName, data.bestBuyVouchers.summary) ? (
              <p className="mt-3 text-body-sm text-ink-2">
                {productVoucherLine(data.bestBuyVouchers.sellerName, data.bestBuyVouchers.summary)}{" "}
                <Link href={`/seller/${data.bestBuyVouchers.sellerId}`} className="font-semibold text-primary underline underline-offset-2 hover:text-primary-hover">
                  Xem hồ sơ shop
                </Link>
              </p>
            ) : null}
          </section>

          {/* Section 4: Discount Verification Banner */}
          {/* Only when the seller advertises a discount: there is nothing to verify otherwise. */}
          {/* Same offer as the hero price and its discount chip (buy), so the two never disagree. */}
          {buy?.discountPercent != null && (
            <section>
              <DiscountVerifyBanner
                status={hasFakeSale ? "fake" : buy.discountChecked ? "ok" : "insufficient"}
                message={pricing.fakeSaleMessage}
              />
            </section>
          )}
        </article>
      </div>

      {/* Sticky Bottom Action Bar */}
      <ProductStickyBar
        productName={product.canonicalName}
        variantTitle={currentVariant ? variantLabel(currentVariant.variantKey) : product.canonicalName}
        price={buyListedPrice}
        score={headline?.score ?? null}
        recommendation={recommendation}
        image={product.image}
        buyUrl={goHref}
        buyLabel={buy ? `Đến ${marketplaceName(buy.marketplace)}` : "Xem nơi bán"}
        marketplace={buy?.marketplace}
        affiliate={buy?.affiliateEligible ?? false}
        isWatching={existingWatch?.status === "active"}
        anchorId="primary-buy"
      />
    </div>
  );
}
