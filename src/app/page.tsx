import Link from "next/link";
import SupabaseStatus from "@/components/supabase-status";
import { UrlLookupForm } from "@/components/lookup/url-lookup-form";
import { SearchBox } from "@/components/search/search-box";
import { ProductCard } from "@/components/search/product-card";
import { searchProducts } from "@/lib/search";

export default async function Home() {
  // Lấy danh sách sản phẩm mới cập nhật cho trang chủ
  const { items: recentProducts } = await searchProducts({
    sort: "updated",
    page: 1,
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-16 space-y-12">
      {/* 1. Header & Giới thiệu giá trị cốt lõi */}
      <header className="text-center max-w-2xl mx-auto space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          KAIRO · Personal Shopping Intelligence
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
          Đừng chỉ tìm giá rẻ. Tìm đúng thời điểm để mua.
        </h1>
        <p className="text-sm text-muted leading-relaxed sm:text-base">
          Lịch sử giá chuẩn hóa theo variant · Deal Score có giải thích · câu trả lời thẳng:{" "}
          <strong className="text-foreground">Nên mua / Có thể chờ / Chưa nên mua</strong>.
        </p>
      </header>

      {/* 2. Khối tra cứu nhanh bằng URL Shopee (P0) & Ô tìm kiếm */}
      <section className="mx-auto max-w-2xl space-y-4 rounded-3xl border border-border bg-black/[0.01] p-6 shadow-sm dark:bg-white/[0.01]">
        <div className="space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">
            1. Kiểm tra giá ngay từ link Shopee
          </label>
          <UrlLookupForm autoFocus />
        </div>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-border"></div>
          <span className="flex-shrink mx-4 text-xs uppercase tracking-wider text-muted">hoặc</span>
          <div className="flex-grow border-t border-border"></div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">
            2. Tìm kiếm trong kho dữ liệu
          </label>
          <SearchBox />
        </div>
      </section>

      {/* 3. Sản phẩm mới cập nhật */}
      {recentProducts.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Sản phẩm theo dõi gần đây
            </h2>
            <Link
              href="/tim-kiem"
              className="text-xs font-semibold text-foreground hover:underline"
            >
              Xem tất cả →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recentProducts.slice(0, 8).map((product) => (
              <ProductCard key={product.productId} item={product} />
            ))}
          </div>
        </section>
      )}

      {/* 4. Supabase Status (chỉ hiện trong môi trường dev) */}
      {process.env.NODE_ENV !== "production" && (
        <section className="border-t border-border pt-6">
          <SupabaseStatus />
        </section>
      )}

      {/* 5. Chân trang với affiliate disclosure bắt buộc */}
      <footer className="border-t border-border pt-6 text-center text-xs text-muted leading-relaxed">
        Một số liên kết là tiếp thị liên kết; nếu bạn mua hàng qua liên kết, chúng tôi có thể nhận hoa hồng.
        Điều này không thay đổi giá bạn trả và không ảnh hưởng đến Deal Score.
      </footer>
    </main>
  );
}
