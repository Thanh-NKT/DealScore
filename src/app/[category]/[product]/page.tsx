import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadActiveVouchers, loadProductPageData } from "@/lib/product/page-data";
import { toGroups } from "@/lib/vouchers/select";
import { collectedAt as vouchersCollectedAt } from "@/lib/vouchers/store";
import { PriceSummary } from "@/components/product/price-summary";
import { VariantPicker } from "@/components/product/variant-picker";
import { verdictNote } from "@/lib/pricing/verdict-copy";
import { compareMarketplaces } from "@/lib/pricing/marketplace-compare";
import { MarketplaceCompare } from "@/components/product/marketplace-compare";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { UpdatedAt } from "@/components/product/updated-at";
import { BuyButton } from "@/components/product/buy-button";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { DraftProductNotice } from "@/components/product/draft-product-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getMyWatchForVariant } from "@/lib/watch/queries";
import { WatchButton } from "@/components/watch/watch-button";
import { buildProductJsonLd, productMetadata, serializeJsonLd, toSeoProduct } from "@/lib/seo/product";
import { siteUrl } from "@/lib/site-url";
import { trackAfter } from "@/lib/analytics/track";
import { isShareVisit, shareText, shareUrl } from "@/lib/share";
import { ShareButton } from "@/components/share/share-button";
import { marketplaceName } from "@/components/product/marketplace";
import { ProductGallery } from "@/components/product/product-gallery";
import { InteractivePriceChart } from "@/components/product/interactive-price-chart";
import { DealScoreBreakdown } from "@/components/product/deal-score-breakdown";
import { OfferList } from "@/components/product/offer-list";
import { PriceAlertCard } from "@/components/product/price-alert-card";
import { VoucherPicker } from "@/components/product/voucher-picker";
import { DiscountVerifyBanner } from "@/components/product/discount-verify-banner";
import { ProductStickyBar } from "@/components/product/product-sticky-bar";
import { variantLabel } from "@/components/product/variant-label";

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
  const { product: productSlug } = await params;
  const { variant, range: rawRange, ref } = await searchParams;

  let range: 7 | 30 | 90 = 30;
  if (rawRange === "7") range = 7;
  else if (rawRange === "90") range = 90;

  const data = await getPageData(productSlug, variant);

  if (!data) {
    notFound();
  }

  const { product, variants, selectedVariantId, pricing, dailyPrices } = data;

  const user = await getCurrentUser();
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
  const cheapest = pricing.cheapest;
  const currentPrice = cheapest?.price ?? pricing.lastKnown?.price ?? null;

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
  const marketplaceComparison = compareMarketplaces(pricing.offers);

  const goHref =
    cheapest?.listingUrl
      ? `/go/${encodeURIComponent(cheapest.marketplace)}/${encodeURIComponent(cheapest.offerId)}?src=web`
      : null;

  const voucherPlatform = cheapest ? marketplaceName(cheapest.marketplace) : "Shopee";
  const voucherListing = cheapest ? data.offerListings?.[cheapest.offerId] : undefined;
  // Same list the offers' effective prices were computed from (page-data), so the picker's estimate,
  // the offer line and the Deal Score reason agree.
  const vouchers =
    cheapest && voucherListing && currentPrice != null && currentPrice > 0
      ? (data.offerVouchers?.[cheapest.offerId] ?? (await loadActiveVouchers(voucherListing)))
      : [];
  const voucherGroups = currentPrice != null && currentPrice > 0 ? toGroups(vouchers, currentPrice, voucherPlatform) : [];

  return (
    <div className="flex w-full flex-col bg-canvas pb-24">
      <div className="mx-auto w-full max-w-[1440px] px-4 pt-5 sm:px-8 lg:px-14">
        {jsonLd && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
        )}

        {/* Breadcrumb Bar */}
        <nav aria-label="Đường dẫn" className="flex flex-wrap items-center gap-2 pb-5 text-label text-ink-3">
          <Link href="/" className="transition-colors hover:text-ink">
            Trang chủ
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/search?cat=${product.categorySlug}`} className="transition-colors hover:text-ink">
            {product.categoryName}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="max-w-[42ch] truncate font-semibold text-ink">{product.canonicalName}</span>
        </nav>

        <article className="flex flex-col gap-8">
          {/* Section 1: Unified Hero & Decision Card */}
          <section className="grid grid-cols-1 items-stretch gap-8 rounded-hero border border-line bg-surface p-5 sm:p-7 min-[1121px]:grid-cols-[460px_minmax(0,1fr)] min-[1121px]:gap-10">
            {/* Left: Image Gallery (90-day stats live in the chart card: one source of truth) */}
            <div className="flex flex-col max-[1120px]:order-2">
              <ProductGallery
                image={product.image}
                alt={product.canonicalName}
                galleryImages={data.galleryImages}
              />
            </div>

            {/* Right: Decision Core & Pricing */}
            <div className="flex flex-col justify-between gap-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/search?cat=${product.categorySlug}`}
                      className="rounded-full border border-line bg-surface-2/60 px-3 py-1 text-micro font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                    >
                      {product.categoryName}
                    </Link>
                    {offerCount >= 1 && (
                      <span className="rounded-full bg-primary-soft px-3 py-1 text-micro font-bold text-primary">
                        Đã gom {offerCount} nơi bán cùng mẫu
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-micro text-ink-3">
                      <span className="size-1.5 rounded-full bg-buy" />
                      {pricing.updatedAt ? <UpdatedAt iso={pricing.updatedAt} isStale={pricing.isStale} variant="compact" /> : "Vừa cập nhật"}
                    </span>
                  </div>

                  <h1 className="display text-h2-sm font-extrabold leading-[1.22] tracking-tight text-ink sm:text-h1-sm">
                    {product.canonicalName}
                  </h1>

                  {(product.brand || product.model) && (
                    <div className="flex flex-wrap items-center gap-2 text-label text-ink-2">
                      {product.brand && (
                        <span>
                          Thương hiệu: <strong className="font-semibold text-ink">{product.brand}</strong>
                        </span>
                      )}
                      {product.brand && product.model && <span aria-hidden="true">·</span>}
                      {product.model && (
                        <span>
                          Mã SP: <strong className="font-semibold text-ink">{product.model}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Variant Selector */}
                <VariantPicker variants={variants} selectedId={selectedVariantId} range={range} />
              </div>

              {/* Main Price & Decision Box */}
              <div className="flex flex-col gap-4 rounded-frame border border-line bg-surface-2/35 p-5">
                {/* Top: Best Price + Deal Score Ring */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <PriceSummary
                    cheapest={cheapest ?? pricing.lastKnown}
                    offerCount={offerCount}
                    discountDoubtful={hasFakeSale}
                  />

                  {recommendation && (
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <ScoreRing
                        score={headline?.score}
                        recommendation={recommendation}
                        size="lg"
                        showBadge
                      />
                      <span className="text-micro font-bold text-ink-3">Deal Score</span>
                    </div>
                  )}
                </div>

                {recommendation && (
                  <VerdictTag
                    recommendation={recommendation}
                    size="lg"
                    note={verdictNote(recommendation, hasFakeSale)}
                  />
                )}

                {pricing.allOutOfStock && (
                  <p className="text-body-sm font-medium text-ink">
                    Tạm hết hàng ở mọi nơi bán đang theo dõi.
                  </p>
                )}

                {/* Bottom: Aligned Action Bar (the sticky bar appears once this scrolls away) */}
                <div id="primary-buy" className="flex flex-col gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {cheapest && (
                      <BuyButton
                        offerId={cheapest.offerId}
                        marketplace={cheapest.marketplace}
                        hasLink={Boolean(cheapest.listingUrl)}
                        affiliate={cheapest.affiliateEligible}
                        variant="primary"
                        size="lg"
                        affiliateLabel={false}
                        className="h-13 min-w-0 flex-[1.2_1_13rem] rounded-md text-control font-bold"
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
                      className="flex size-13 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-2 cursor-pointer"
                    />
                  </div>
                  <span className="text-micro leading-[1.45] text-ink-3">
                    Nếu bạn mua qua liên kết, Kairo có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Notice for ingest-created draft products */}
          <DraftProductNotice isDraft={product.status === "draft"} offerCount={offerCount} dataDays={dailyPrices.length} />

          {/* Section 2: Interactive Price History & Deal Score Breakdown */}
          <section className="grid grid-cols-1 items-start gap-6 min-[1121px]:grid-cols-[1fr_420px]">
            <InteractivePriceChart
              rows={dailyPrices}
              currentPrice={currentPrice ?? 0}
              variantTitle={currentVariant ? variantLabel(currentVariant.variantKey) : product.canonicalName}
            />

            <DealScoreBreakdown
              score={headline?.score ?? null}
              recommendation={recommendation}
              reasons={headline?.reasons ?? []}
            />
          </section>

          {/* Cross-marketplace comparison: renders only with ≥ 2 real marketplaces (never simulated) */}
          {marketplaceComparison && <MarketplaceCompare comparison={marketplaceComparison} offers={pricing.offers} />}

          {/* Section 3: Marketplace Comparison & Price Alert */}
          <section className="grid grid-cols-1 items-start gap-6 min-[1121px]:grid-cols-[1fr_420px]">
            <OfferList offers={pricing.offers} />

            <PriceAlertCard
              currentPrice={currentPrice}
              lowestPrice={pricing.stats.low}
              existingConfig={existingWatch?.config ?? null}
              isLoggedIn={Boolean(user)}
              variantId={selectedVariantId}
              currentPath={currentPath}
            />
          </section>

          {/* Section 3b: Voucher Picker */}
          <section id="ma-giam-gia" aria-labelledby="voucher-title">
            <VoucherPicker
              platform={voucherPlatform}
              productPrice={currentPrice}
              groups={voucherGroups}
              collectedAt={vouchersCollectedAt(vouchers)}
              goHref={goHref}
              refreshOfferId={cheapest?.offerId ?? null}
            />
          </section>

          {/* Section 4: Discount Verification Banner */}
          {/* Only when the seller advertises a discount: there is nothing to verify otherwise. */}
          {cheapest?.discountPercent != null && (
            <section>
              <DiscountVerifyBanner
                status={hasFakeSale ? "fake" : recommendation === "insufficient_data" ? "insufficient" : "ok"}
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
        price={currentPrice}
        score={headline?.score ?? null}
        recommendation={recommendation}
        image={product.image}
        buyUrl={goHref}
        buyLabel={cheapest ? `Đến ${marketplaceName(cheapest.marketplace)}` : "Xem nơi bán"}
        marketplace={cheapest?.marketplace}
        isWatching={existingWatch?.status === "active"}
        anchorId="primary-buy"
      />
    </div>
  );
}
