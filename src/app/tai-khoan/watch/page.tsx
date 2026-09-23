import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listMyWatches } from "@/lib/watch/queries";
import { WatchList } from "@/components/watch/watch-list";

export const dynamic = "force-dynamic";

export default async function MyWatchesPage() {
  const user = await requireUser({ path: "/tai-khoan/watch" });
  const items = await listMyWatches(user.id, new Date());

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12 space-y-8">
      {/* Header & Breadcrumb */}
      <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <nav aria-label="Đường dẫn" className="text-xs text-muted flex items-center gap-2 mb-2">
            <Link href="/tai-khoan" className="hover:text-foreground">
              ← Tài khoản
            </Link>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Watch của tôi
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            Danh sách các phiên bản sản phẩm bạn đang theo dõi giá và nhận cảnh
            báo tự động.
          </p>
        </div>

        <Link
          href="/tim-kiem"
          className="inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90 self-start sm:self-auto shrink-0"
        >
          + Thêm sản phẩm mới
        </Link>
      </div>

      <WatchList initialItems={items} />

      {/* Chân trang với disclosure tiếp thị liên kết theo spec 1.5 */}
      <footer className="border-t border-border pt-6 text-center text-xs text-muted leading-relaxed">
        Kairo có thể nhận hoa hồng khi bạn mua qua liên kết. Điều này không làm
        thay đổi giá bạn trả và không ảnh hưởng đến đánh giá Deal Score.
      </footer>
    </main>
  );
}
