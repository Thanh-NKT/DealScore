import type { Metadata } from "next";
import { loadTrending, type TrendingItem, type TrendingMode } from "@/lib/discovery";
import { getFilterFacets } from "@/lib/search";
import { siteUrl } from "@/lib/site-url";
import { ProductCard } from "@/components/search/product-card";
import { BellIcon, TrendUpIcon } from "@/components/ui/icons";
import { CategoryStrip, DiscoveryEmpty, DiscoveryShell, SegmentedLinks } from "@/components/discovery/discovery-shell";

interface PageProps {
  searchParams: Promise<{ tab?: string; cat?: string }>;
}

export const dynamic = "force-dynamic";

const TABS: Record<TrendingMode, { text: string; lead: string; empty: string }> = {
  watched: {
    text: "Nhiều người theo dõi",
    lead: "Sản phẩm có nhiều Watch đang hoạt động nhất: nhiều người đang chờ giá tốt cho chúng.",
    empty: "Một sản phẩm cần ít nhất 2 người theo dõi mới được xếp hạng, để không ai bị lộ mình đang chờ mua gì.",
  },
  rising: {
    text: "Đang được quan tâm",
    lead: "Sản phẩm có lượt xem tăng nhanh nhất trong 7 ngày qua so với 7 ngày trước đó.",
    empty: "Một sản phẩm cần ít nhất 3 lượt xem trong tuần và nhiều hơn tuần trước mới được xếp hạng.",
  },
};

function parse(sp: { tab?: string; cat?: string }): { mode: TrendingMode; cat: string | undefined } {
  return { mode: sp.tab === "rising" ? "rising" : "watched", cat: sp.cat?.trim() || undefined };
}

function href(mode: TrendingMode, cat: string | undefined): string {
  const q = new URLSearchParams();
  if (mode !== "watched") q.set("tab", mode);
  if (cat) q.set("cat", cat);
  const s = q.toString();
  return s ? `/trending?${s}` : "/trending";
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { mode, cat } = parse(await searchParams);
  return {
    title: `Xu hướng — ${TABS[mode].text} | Kairo`,
    description: TABS[mode].lead,
    alternates: { canonical: `${siteUrl()}${href(mode, cat)}` },
  };
}

function insightFor(mode: TrendingMode, item: TrendingItem) {
  if (mode === "watched") {
    return { icon: <BellIcon />, text: `${item.watchCount} người đang theo dõi giá` };
  }
  return {
    icon: <TrendUpIcon />,
    text: `${item.views7d} lượt xem tuần này (tuần trước ${item.viewsPrev7d})`,
  };
}

/** Trending / Most Watched (Phase 2). Rankings come from aggregate counts only. */
export default async function TrendingPage({ searchParams }: PageProps) {
  const { mode, cat } = parse(await searchParams);
  const tab = TABS[mode];

  const [listRes, facetsRes] = await Promise.allSettled([loadTrending(mode, { categorySlug: cat }), getFilterFacets()]);
  if (listRes.status === "rejected") console.error("trending: loadTrending failed", listRes.reason);
  if (facetsRes.status === "rejected") console.error("trending: getFilterFacets failed", facetsRes.reason);
  const categories = facetsRes.status === "fulfilled" ? facetsRes.value.categories : [];

  return (
    <DiscoveryShell
      title="Xu hướng"
      lead={tab.lead}
      controls={
        <>
          <SegmentedLinks
            label="Kiểu xếp hạng"
            options={(Object.keys(TABS) as TrendingMode[]).map((m) => ({
              href: href(m, cat),
              text: TABS[m].text,
              active: m === mode,
            }))}
          />
          <CategoryStrip categories={categories} current={cat} hrefFor={(s) => href(mode, s)} />
        </>
      }
      footnote="Xếp hạng chỉ dùng số đếm tổng hợp, không dùng thông tin của từng người. Được theo dõi nhiều không có nghĩa là giá đang tốt: hãy xem kết luận trên từng sản phẩm."
    >
      {listRes.status === "rejected" ? (
        <DiscoveryEmpty
          title="Chưa tải được danh sách"
          body="Có lỗi khi đọc dữ liệu. Hãy thử lại sau ít phút."
          action={{ href: href(mode, cat), text: "Thử lại" }}
        />
      ) : listRes.value.length === 0 ? (
        <DiscoveryEmpty
          title="Chưa đủ dữ liệu để xếp hạng"
          body={tab.empty}
          action={{ href: "/radar", text: "Xem giảm giá thật hôm nay" }}
        />
      ) : (
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4">
          {listRes.value.map((item) => (
            <li key={item.productId} className="flex [&>a]:flex-1">
              <ProductCard item={item} insight={insightFor(mode, item)} />
            </li>
          ))}
        </ol>
      )}
    </DiscoveryShell>
  );
}
