import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/actions/account";
import { MarketingToggle } from "@/components/account/marketing-toggle";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12 space-y-8">
      {/* Account header */}
      <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Tài khoản của tôi
          </h1>
          <p className="text-xs text-muted mt-1">
            Đăng nhập với email:{" "}
            <strong className="text-foreground">{user.email}</strong>
            {joinedDate && ` · Thành viên từ ${joinedDate}`}
          </p>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5 transition-colors"
          >
            Đăng xuất
          </button>
        </form>
      </div>

      {/* Management sections grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Card: My Watches */}
        <section className="flex flex-col justify-between rounded-3xl border border-border bg-black/[0.01] p-6 shadow-sm dark:bg-white/[0.01]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-sm">
                🔔
              </span>
              <span className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-xs font-semibold text-foreground">
                {activeWatchCount ?? 0} đang bật
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                Sản phẩm đang theo dõi
              </h2>
              <p className="text-xs text-muted leading-relaxed mt-1">
                Xem khoảng cách tới mức giá mục tiêu, trạng thái biến động giá và
                các cảnh báo đã nhận.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/account/watch"
              className="inline-flex w-full items-center justify-center rounded-xl bg-foreground py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
            >
              Quản lý Watch →
            </Link>
          </div>
        </section>

        {/* Card: Notification settings */}
        <section className="flex flex-col justify-between rounded-3xl border border-border bg-black/[0.01] p-6 shadow-sm dark:bg-white/[0.01]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                ⚙
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                Cài đặt thông báo
              </h2>
              <p className="text-xs text-muted leading-relaxed mt-1">
                Tùy chỉnh kênh nhận tin (Email, Web Push), tần suất tức thì hoặc
                tóm tắt ngày, và khung giờ im lặng.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/account/notifications"
              className="inline-flex w-full items-center justify-center rounded-xl border border-border bg-background py-2 text-xs font-semibold text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              Chỉnh sửa thông báo →
            </Link>
          </div>
        </section>
      </div>

      {/* Marketing preferences */}
      <section className="rounded-3xl border border-border bg-black/[0.01] p-6 shadow-sm dark:bg-white/[0.01] space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
          Tùy chọn bản tin & Khuyến mãi
        </h2>
        <MarketingToggle initialOptIn={user.marketingOptIn} />
      </section>

      {/* Data & privacy */}
      <section className="rounded-3xl border border-border bg-black/[0.01] p-6 shadow-sm dark:bg-white/[0.01] space-y-6">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Dữ liệu cá nhân & Quyền riêng tư
          </h2>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            Bạn có toàn quyền kiểm soát dữ liệu của mình tại Kairo theo quy định
            về bảo vệ dữ liệu cá nhân.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-border">
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              Xuất dữ liệu cá nhân
            </h3>
            <p className="text-xs text-muted">
              Tải về toàn bộ hồ sơ, cài đặt, danh sách Watch và lịch sử tra cứu
              dưới dạng file JSON.
            </p>
          </div>
          <a
            href="/account/export"
            download
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground hover:bg-black/5 dark:hover:bg-white/5 shrink-0"
          >
            Tải dữ liệu của tôi (.json)
          </a>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-border">
          <div>
            <h3 className="text-xs font-semibold text-red-600 dark:text-red-400">
              Xóa tài khoản
            </h3>
            <p className="text-xs text-muted">
              Dừng toàn bộ thông báo giá ngay lập tức. Bạn có thể khôi phục trong
              vòng 30 ngày.
            </p>
          </div>
          <Link
            href="/account/delete"
            className="inline-flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 shrink-0"
          >
            Yêu cầu xóa tài khoản
          </Link>
        </div>
      </section>
    </main>
  );
}
