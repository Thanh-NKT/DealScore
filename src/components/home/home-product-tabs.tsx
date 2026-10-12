"use client";

import { useState } from "react";
import Link from "next/link";
import type { SearchItem } from "@/lib/search";
import type { RadarItem, TrendingItem } from "@/lib/discovery";
import { ProductCard } from "@/components/search/product-card";
import { BellIcon, CheckCircleIcon, ClockIcon, TrendDownIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";
import { segmentClass, segmentTrack } from "@/components/ui/segmented";

type TabKey = "featured" | "drops" | "watched" | "updated";

interface HomeProductTabsProps {
  featuredProducts: SearchItem[];
  recentProducts: SearchItem[];
  watchedProducts: TrendingItem[];
  radarProducts: RadarItem[];
  categoryNames: Record<string, string>;
}

const TABS: Array<{
  key: TabKey;
  label: string;
  subtitle: string;
  seeAllHref: string;
  seeAllLabel: string;
}> = [
  {
    key: "featured",
    label: "Đáng mua nhất",
    subtitle: "Sản phẩm có Deal Score cao và mức giá tốt nhất trong lịch sử ghi nhận",
    seeAllHref: "/search?sort=deal_score",
    seeAllLabel: "Xem tất cả Deal điểm cao",
  },
  {
    key: "drops",
    label: "Mới giảm giá",
    subtitle: "Sản phẩm có giá hiện tại thấp hơn thật so với trung vị 30 ngày",
    seeAllHref: "/radar",
    seeAllLabel: "Xem tất cả giảm giá thật",
  },
  {
    key: "watched",
    label: "Được theo dõi nhiều",
    subtitle: "Sản phẩm đang được nhiều người theo dõi giá",
    seeAllHref: "/trending",
    seeAllLabel: "Mở bảng Xu hướng",
  },
  {
    key: "updated",
    label: "Vừa cập nhật",
    subtitle: "Sản phẩm vừa được hệ thống ghi nhận biến động giá mới nhất",
    seeAllHref: "/search?sort=updated",
    seeAllLabel: "Xem toàn bộ danh sách",
  },
];

export function HomeProductTabs({
  featuredProducts,
  recentProducts,
  watchedProducts,
  radarProducts,
  categoryNames,
}: HomeProductTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("featured");
  const [expanded, setExpanded] = useState(false);

  const currentMeta = TABS.find((t) => t.key === activeTab) ?? TABS[0];
  const limit = expanded ? 8 : 4;

  const activeTotalCount =
    activeTab === "featured"
      ? featuredProducts.length
      : activeTab === "drops"
        ? radarProducts.length
        : activeTab === "watched"
          ? watchedProducts.length
          : recentProducts.length;

  return (
    <section
      aria-labelledby="showcase-title"
      className="flex flex-col gap-6"
    >
      {/* Header + Segmented Tab Bar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="eyebrow text-ink-3">Chọn lọc tự động · theo dữ liệu giá</span>
          <h2 id="showcase-title" className="display text-h2-sm font-bold leading-tight text-ink sm:text-h2">
            Khám phá giá tốt hôm nay
          </h2>
          <p className="text-body-sm leading-normal text-ink-2">
            {currentMeta.subtitle} ·{" "}
            <Link href={currentMeta.seeAllHref} className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary">
              {currentMeta.seeAllLabel} →
            </Link>
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Chế độ xem sản phẩm"
          className={segmentTrack({ display: "flex", className: "flex-wrap" })}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon =
              tab.key === "featured"
                ? CheckCircleIcon
                : tab.key === "drops"
                  ? TrendDownIcon
                  : tab.key === "watched"
                    ? BellIcon
                    : ClockIcon;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setActiveTab(tab.key);
                  setExpanded(false);
                }}
                className={segmentClass(isActive)}
              >
                <Icon className={`size-3.5 ${isActive ? "text-primary" : "text-ink-3"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Product Grid */}
      {activeTab === "featured" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {featuredProducts.slice(0, limit).map((product) => (
            <ProductCard
              key={product.productId}
              item={product}
              categoryName={categoryNames[product.categorySlug]}
            />
          ))}
        </div>
      )}

      {activeTab === "drops" && (
        radarProducts.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {radarProducts.slice(0, limit).map((item) => {
              const pct = Math.round(item.dropPct * 100);
              return (
                <ProductCard
                  key={`${item.productId}-${item.variantId}`}
                  item={item}
                  categoryName={categoryNames[item.categorySlug]}
                  href={`/${item.categorySlug}/${item.slug}?variant=${item.variantId}`}
                  insight={
                    pct > 0
                      ? {
                          icon: <TrendDownIcon className="text-buy" />,
                          text: `Thấp hơn ${pct}% so với trung vị 30 ngày`,
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong/50 bg-surface py-12 text-center">
            <p className="text-control font-semibold text-ink">Chưa có sản phẩm giảm sâu hôm nay</p>
            <Link href="/radar" className="text-label font-semibold text-primary underline underline-offset-4">
              Xem tất cả giảm giá thật →
            </Link>
          </div>
        )
      )}

      {activeTab === "watched" && (
        watchedProducts.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {watchedProducts.slice(0, limit).map((product) => (
              <ProductCard
                key={product.productId}
                item={product}
                categoryName={categoryNames[product.categorySlug]}
                insight={
                  product.watchCount > 0
                    ? {
                        icon: <BellIcon className="text-ink-2" />,
                        text: `${product.watchCount} người đang theo dõi giá`,
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong/50 bg-surface py-12 text-center">
            <p className="text-control font-semibold text-ink">Chưa có dữ liệu theo dõi nổi bật trong tuần</p>
            <Link href="/trending" className="text-label font-semibold text-primary underline underline-offset-4">
              Mở trang Xu hướng →
            </Link>
          </div>
        )
      )}

      {activeTab === "updated" && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {recentProducts.slice(0, limit).map((product) => (
            <ProductCard
              key={product.productId}
              item={product}
              categoryName={categoryNames[product.categorySlug]}
            />
          ))}
        </div>
      )}

      {/* Bottom Action Bar: Expand 8 cards or Go to full page */}
      {activeTotalCount > 4 && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {expanded ? "Thu gọn danh sách" : `Xem thêm sản phẩm (${Math.min(8, activeTotalCount)} sản phẩm)`}
          </button>
          <Link
            href={currentMeta.seeAllHref}
            className={buttonClass({ size: "sm" })}
          >
            {currentMeta.seeAllLabel} →
          </Link>
        </div>
      )}
    </section>
  );
}
