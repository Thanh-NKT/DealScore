import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/actions/account";
import { MarketingToggle } from "@/components/account/marketing-toggle";
import { BellIcon, HeartIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const CARD = "rounded-lg border border-line bg-surface p-7 max-[760px]:p-5";
const SECONDARY =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-control font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2";

function SlidersIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

export default async function AccountPage() {
  const user = await requireUser({ path: "/account" });
  const supabase = await createClient();

  // Count active watches
  const { count: activeWatchCount } = await supabase
    .from("watches")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active");

  const { data: profile } = await supabase
    .from("users")
    .select("created_at")
    .eq("id", user.id)
    .single();

  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      {/* Account header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="display text-h1-sm font-extrabold leading-[1.1] text-ink sm:text-h1">Tài khoản của tôi</h1>
          <p className="text-control text-ink-2 [overflow-wrap:anywhere]">
            Đăng nhập với email: <strong className="font-semibold text-ink">{user.email}</strong>
            {joinedDate && (
              <>
                {" "}
                · Thành viên từ <span className="num">{joinedDate}</span>
              </>
            )}
          </p>
        </div>

        <form action={signOut}>
          <button type="submit" className={SECONDARY}>
            Đăng xuất
          </button>
        </form>
      </div>

      {/* Management sections */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <section className={`${CARD} flex flex-col justify-between gap-6`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex size-11 items-center justify-center rounded-md bg-accent text-on-accent">
                <BellIcon className="size-5" strokeWidth={2} />
              </span>
              <span className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 text-label font-semibold text-ink-2">
                <span className="num">{activeWatchCount ?? 0}</span> đang bật
              </span>
            </div>
            <div>
              <h2 className="display text-h3 font-bold leading-tight text-ink max-[760px]:text-title">Sản phẩm đang theo dõi</h2>
              <p className="mt-1.5 text-control leading-relaxed text-ink-2">
                Xem khoảng cách tới giá mong muốn, giá đã thay đổi thế nào và các thông báo giá đã nhận.
              </p>
            </div>
          </div>
          <Link
            href="/account/watch"
            className={buttonClass({ size: "md", block: true })}
          >
            Xem sản phẩm đang theo dõi
          </Link>
        </section>

        <section className={`${CARD} flex flex-col justify-between gap-6`}>
          <div className="space-y-4">
            <span className="inline-flex size-11 items-center justify-center rounded-md bg-surface-2 text-ink">
              <SlidersIcon />
            </span>
            <div>
              <h2 className="display text-h3 font-bold leading-tight text-ink max-[760px]:text-title">Cài đặt thông báo</h2>
              <p className="mt-1.5 text-control leading-relaxed text-ink-2">
                Tùy chỉnh kênh nhận tin (Email, Web Push), tần suất tức thì hoặc tóm tắt ngày, và khung giờ im lặng.
              </p>
            </div>
          </div>
          <Link href="/account/notifications" className={`${SECONDARY} w-full`}>
            Chỉnh sửa thông báo
          </Link>
        </section>

        <section className={`${CARD} flex flex-col justify-between gap-6 sm:col-span-2 sm:flex-row sm:items-center`}>
          <div className="flex items-start gap-4">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink">
              <HeartIcon className="size-5" />
            </span>
            <div>
              <h2 className="display text-h3 font-bold leading-tight text-ink max-[760px]:text-title">Sở thích mua sắm</h2>
              <p className="mt-1.5 text-control leading-relaxed text-ink-2">
                Hãng, danh mục, khoảng giá và sàn bạn hay mua — dùng cho nút “Theo sở thích của tôi” khi tìm kiếm.
              </p>
            </div>
          </div>
          <Link href="/account/preferences" className={`${SECONDARY} max-sm:w-full`}>
            Chỉnh sửa sở thích
          </Link>
        </section>
      </div>

      {/* Marketing preferences */}
      <section className={`${CARD} space-y-4`}>
        <h2 className="display text-h3 font-bold leading-tight text-ink max-[760px]:text-title">Tùy chọn bản tin &amp; Khuyến mãi</h2>
        <MarketingToggle initialOptIn={user.marketingOptIn} />
      </section>

      {/* Data & privacy */}
      <section className={`${CARD} space-y-5`}>
        <div>
          <h2 className="display text-h3 font-bold leading-tight text-ink max-[760px]:text-title">Dữ liệu cá nhân &amp; Quyền riêng tư</h2>
          <p className="mt-1.5 text-control leading-relaxed text-ink-2">
            Bạn có toàn quyền kiểm soát dữ liệu của mình tại Kairo theo quy định về bảo vệ dữ liệu cá nhân.
          </p>
        </div>

        <div className="flex flex-col items-start justify-between gap-4 border-t border-line pt-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-control font-semibold text-ink">Xuất dữ liệu cá nhân</h3>
            <p className="mt-0.5 text-body-sm text-ink-2">
              Tải về toàn bộ hồ sơ, cài đặt, danh sách sản phẩm đang theo dõi và lịch sử tra cứu dưới dạng file JSON.
            </p>
          </div>
          <a href="/account/export" download className={SECONDARY}>
            Tải dữ liệu của tôi (.json)
          </a>
        </div>

        <div className="flex flex-col items-start justify-between gap-4 border-t border-line pt-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-control font-semibold text-avoid">Xóa tài khoản</h3>
            <p className="mt-0.5 text-body-sm text-ink-2">
              Dừng toàn bộ thông báo giá ngay lập tức. Bạn có thể khôi phục trong vòng 30 ngày.
            </p>
          </div>
          <Link
            href="/account/delete"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-avoid bg-surface px-4 text-control font-semibold text-avoid transition-colors duration-150 ease-out hover:bg-avoid-soft"
          >
            Yêu cầu xóa tài khoản
          </Link>
        </div>
      </section>
    </main>
  );
}
