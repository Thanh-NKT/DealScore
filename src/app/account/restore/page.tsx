import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { restoreAccount, signOut } from "@/actions/account";
import { ClockIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

export default async function RestoreAccountPage() {
  const user = await requireUser({
    path: "/account/restore",
    allowPendingDeletion: true,
  });

  // If the account is not pending deletion, go back to /account
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
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:py-14">
      <div className="space-y-6 rounded-lg border border-line bg-surface p-7 max-[760px]:p-5">
        <span className="inline-flex size-12 items-center justify-center rounded-md bg-surface-2 text-ink">
          <ClockIcon className="size-6" strokeWidth={2} />
        </span>

        <div className="space-y-2">
          <h1 className="display text-[28px] font-extrabold leading-[1.15] text-ink max-[760px]:text-[24px]">Tài khoản đang chờ xóa</h1>
          <p className="text-[15px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
            Tài khoản <strong className="font-semibold text-ink">{user.email}</strong> đã được yêu cầu xóa mềm và dự kiến sẽ bị xóa vĩnh viễn vào
            ngày <strong className="num font-semibold text-ink">{purgeDateStr}</strong>.
          </p>
        </div>

        <div className="rounded-md bg-surface-2 p-4 text-[14px] leading-relaxed text-ink-2">
          <p>
            Bạn vẫn đang trong thời hạn 30 ngày cho phép khôi phục. Nếu bạn khôi phục, toàn bộ danh sách Watch và cài đặt thông báo của bạn sẽ
            được kích hoạt trở lại bình thường.
          </p>
        </div>

        <div className="space-y-3">
          <form action={restoreAccount}>
            <button
              type="submit"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-md bg-primary px-4 text-[16px] font-semibold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover"
            >
              Khôi phục tài khoản của tôi
            </button>
          </form>

          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-[15px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2"
            >
              Không khôi phục, đăng xuất ngay
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
