import type { Metadata } from "next";
import { loadRadar, RADAR_MIN_DROP } from "@/lib/discovery";
import { getFilterFacets } from "@/lib/search";
import { siteUrl } from "@/lib/site-url";
import { CategoryStrip, DiscoveryEmpty, DiscoveryShell, Pager } from "@/components/discovery/discovery-shell";
import { RadarList } from "@/components/discovery/radar-list";

interface PageProps {
  searchParams: Promise<{ cat?: string; page?: string }>;
}

export const dynamic = "force-dynamic";

const MIN_DROP_PCT = Math.round(RADAR_MIN_DROP * 100);

function parse(sp: { cat?: string; page?: string }) {
  const page = Number(sp.page);
  return { cat: sp.cat?.trim() || undefined, page: Number.isInteger(page) && page > 1 ? page : 1 };
}

function href(cat: string | undefined, page = 1): string {
  const q = new URLSearchParams();
  if (cat) q.set("cat", cat);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/radar?${s}` : "/radar";
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { cat, page } = parse(await searchParams);
  return {
    title: "Giảm giá thật hôm nay | Kairo",
    description: `Sản phẩm đang rẻ hơn ít nhất ${MIN_DROP_PCT}% so với giá trung vị 30 ngày Kairo ghi nhận — so với giá đã bán thật, không so với giá niêm yết.`,
    alternates: { canonical: `${siteUrl()}${href(cat, page)}` },
  };
}

/** Price Drop Radar (Phase 2): real drops against the recorded 30-day median. */
export default async function RadarPage({ searchParams }: PageProps) {
  const { cat, page } = parse(await searchParams);

  const [radarRes, facetsRes] = await Promise.allSettled([loadRadar({ categorySlug: cat, page }), getFilterFacets()]);
  if (radarRes.status === "rejected") console.error("radar: loadRadar failed", radarRes.reason);
  if (facetsRes.status === "rejected") console.error("radar: getFilterFacets failed", facetsRes.reason);
  const categories = facetsRes.status === "fulfilled" ? facetsRes.value.categories : [];
  const categoryNames = Object.fromEntries(categories.map((c) => [c.slug, c.name]));

  return (
    <DiscoveryShell
      title="Giảm giá thật hôm nay"
      lead={
        <>
          Những sản phẩm đang rẻ hơn ít nhất <strong className="font-semibold text-ink">{MIN_DROP_PCT}%</strong> so với giá
          trung vị 30 ngày mà Kairo ghi nhận. Chúng tôi so với giá đã bán thật, không so với giá niêm yết người bán tự đặt,
          nên “giảm 50%” trên giấy không lọt vào đây.
        </>
      }
      footnote="Chỉ tính sản phẩm còn hàng, có giá cập nhật trong 48 giờ và có ít nhất 10 ngày dữ liệu trong 30 ngày qua. Giá flash sale có thể chỉ kéo dài vài giờ. Hoa hồng tiếp thị không ảnh hưởng tới thứ tự."
    >
      {/* Light botanical panel: category pills, then one card-row per real drop. */}
      <section
        aria-label="Danh sách giảm giá thật"
        className="space-y-5 rounded-[24px] border border-line bg-surface p-5 text-ink sm:p-8"
      >
        <CategoryStrip tone="light" categories={categories} current={cat} hrefFor={(s) => href(s)} />
        {radarRes.status === "rejected" ? (
          <DiscoveryEmpty
            tone="light"
            title="Chưa tải được danh sách"
            body="Có lỗi khi đọc dữ liệu giá. Hãy thử lại sau ít phút."
            action={{ href: href(cat, page), text: "Thử lại" }}
          />
        ) : radarRes.value.items.length === 0 ? (
          page > 1 ? (
            <DiscoveryEmpty
              tone="light"
              title="Trang này không còn sản phẩm"
              body="Danh sách đã ngắn lại từ lúc bạn mở link."
              action={{ href: href(cat), text: "Về trang đầu" }}
            />
          ) : (
            <DiscoveryEmpty
              tone="light"
              title="Hôm nay chưa có đợt giảm giá thật nào"
              body={`Chưa sản phẩm nào${cat ? " trong danh mục này" : ""} rẻ hơn ${MIN_DROP_PCT}% so với trung vị 30 ngày. Giá đang ổn định là chuyện bình thường; bạn có thể đặt Watch để được báo khi giá giảm.`}
              action={{ href: "/search?sort=deal_score", text: "Xem sản phẩm có Deal Score cao" }}
            />
          )
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-2">
              <span className="num text-gradient-warm text-[18px] font-extrabold">{radarRes.value.total}</span> sản phẩm, giảm sâu nhất trước
            </p>
            <RadarList items={radarRes.value.items} categoryNames={categoryNames} />
          </div>
        )}
      </section>
      {radarRes.status === "fulfilled" && radarRes.value.items.length > 0 && (
        <Pager
          page={radarRes.value.page}
          totalPages={Math.ceil(radarRes.value.total / radarRes.value.pageSize)}
          hrefFor={(p) => href(cat, p)}
        />
      )}
    </DiscoveryShell>
  );
}
