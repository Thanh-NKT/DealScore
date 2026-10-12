import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { loadSellerPage } from "@/lib/sellers/queries";
import { SellerProfileCard, VoucherPatternsCard } from "@/components/seller/seller-insights";
import { ProductCard } from "@/components/search/product-card";
import { marketplaceName } from "@/components/product/marketplace";
import { MarketplaceChip } from "@/components/product/marketplace-mark";

// Per-request (nonce CSP).
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ id: string }>;
}

const load = cache(async (id: string) => (UUID_RE.test(id) ? loadSellerPage(id) : null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id);
  return {
    title: data ? `${data.seller.name ?? "Shop"} — hồ sơ giá trên DealScore` : "Không tìm thấy shop",
    // Thin pages until real data (roadmap P4 Q6): not indexed, links still followed. Not in the sitemap.
    robots: { index: false, follow: true },
  };
}

export default async function SellerPage({ params }: Props) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { seller } = data;
  const market = marketplaceName(seller.marketplace);

  return (
    <main className="flex-1">
      <header className="border-b border-line bg-ledger">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-10 sm:px-6 sm:py-12 lg:px-14">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-ink-3">Hồ sơ giá của shop</span>
            <MarketplaceChip marketplace={seller.marketplace} />
            {seller.isOfficial ? (
              <span className="rounded-sm bg-primary-soft px-2 py-0.5 text-label font-bold text-primary">Chính hãng</span>
            ) : null}
          </div>
          <h1 className="display text-h1-sm font-semibold leading-[1.05] text-ink text-balance sm:text-h1">{seller.name ?? "Shop chưa rõ tên"}</h1>
          {seller.rating != null && seller.rating > 0 ? (
            <p className="text-body-sm text-ink-2">
              <span className="num font-semibold">{seller.rating.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}★</span> trên {market}
              {seller.ratingCount ? (
                <>
                  {" "}
                  (<span className="num">{seller.ratingCount.toLocaleString("vi-VN")}</span> đánh giá)
                </>
              ) : null}{" "}
              · đánh giá của sàn
            </p>
          ) : null}
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1440px] space-y-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-14">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <SellerProfileCard profile={data.profile} />
          <VoucherPatternsCard summary={data.vouchers} />
        </div>

        {data.products.length > 0 ? (
          <section aria-labelledby="seller-products" className="space-y-4">
            <h2 id="seller-products" className="display text-h3 font-semibold text-ink">
              Sản phẩm của shop trên DealScore
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
              {data.products.map((item) => (
                <ProductCard key={item.productId} item={item} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
