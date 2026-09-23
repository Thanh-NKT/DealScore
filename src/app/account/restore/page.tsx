import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { restoreAccount, signOut } from "@/app/account/actions";

export const dynamic = "force-dynamic";

export default async function RestoreAccountPage() {
  const user = await requireUser({
    path: "/account/restore",
    allowPendingDeletion: true,
  });

  // Nếu tài khoản không ở trạng thái chờ xóa thì chuyển về /account
  if (!user.deletedAt) {
    redirect("/account");
  }

  const deletedDate = new Date(user.deletedAt);
  const purgeDate = new Date(deletedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const purgeDateStr = purgeDate.toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12 sm:py-16">
      <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.02] p-6 sm:p-8 shadow-sm space-y-6 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-xl">
          ⏳
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Tài khoản đang chờ xóa
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            Tài khoản <strong className="text-foreground">{user.email}</strong>{" "}
            đã được yêu cầu xóa mềm và dự kiến sẽ bị xóa vĩnh viễn vào ngày{" "}
            <strong className="text-foreground">{purgeDateStr}</strong>.
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-background/50 p-4 text-xs leading-relaxed text-muted text-left">
          <p>
            Bạn vẫn đang trong thời hạn 30 ngày cho phép khôi phục. Nếu bạn khôi
            phục, toàn bộ danh sách Watch và cài đặt thông báo của bạn sẽ được
            kích hoạt trở lại bình thường.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <form action={restoreAccount}>
            <button
              type="submit"
              className="w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              Khôi phục tài khoản của tôi
            </button>
          </form>

          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-xl border border-border py-2 text-xs font-semibold text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5 transition-colors"
            >
              Không khôi phục, đăng xuất ngay
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
