import Link from "next/link";
import { verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { UnsubscribeForm } from "@/components/watch/unsubscribe-form";

export const dynamic = "force-dynamic";

interface UnsubscribePageProps {
  searchParams: Promise<{ t?: string; done?: string }>;
}

export default async function UnsubscribePage({
  searchParams,
}: UnsubscribePageProps) {
  const { t: token, done: completedKind } = await searchParams;
  // Không có giá trị mặc định: chuỗi mặc định nằm công khai trong repo, ai cũng giả được token.
  const secret = process.env.UNSUBSCRIBE_SECRET;

  // Trường hợp đã hoàn tất
  if (completedKind) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-16 text-center space-y-6">
        <div className="rounded-3xl border border-border bg-black/[0.01] p-6 sm:p-8 shadow-sm dark:bg-white/[0.01] space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-2xl font-bold">
            ✓
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {completedKind === "watch"
              ? "Đã tạm dừng Watch thành công"
              : "Đã tắt thông báo qua email"}
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            {completedKind === "watch"
              ? "Bạn sẽ không nhận thêm cảnh báo nào cho sản phẩm này trừ khi bạn kích hoạt lại trong tài khoản."
              : "Toàn bộ thông báo giá qua email đã được tắt. Bạn có thể bật lại bất cứ lúc nào trong Cài đặt thông báo."}
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl bg-foreground px-5 py-2 text-xs font-semibold text-background hover:opacity-90"
            >
              Về trang chủ Kairo
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Xác thực token
  // Thiếu UNSUBSCRIBE_SECRET → coi mọi token là không hợp lệ.
  const scope = token && secret ? verifyUnsubscribeToken(token, secret) : null;

  if (!scope || !token) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-16 text-center space-y-6">
        <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.02] p-6 sm:p-8 shadow-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 text-2xl font-bold">
            ✕
          </div>
          <h1 className="text-xl font-bold tracking-tight text-red-600 dark:text-red-400 sm:text-2xl">
            Liên kết không hợp lệ
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            Liên kết hủy đăng ký này không tồn tại hoặc đã bị chỉnh sửa. Vui
            lòng đăng nhập vào tài khoản để quản lý thông báo.
          </p>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl bg-foreground px-5 py-2 text-xs font-semibold text-background hover:opacity-90"
            >
              Đăng nhập Kairo
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-16 text-center space-y-6">
      <div className="rounded-3xl border border-border bg-black/[0.01] p-6 sm:p-8 shadow-sm dark:bg-white/[0.01] space-y-6">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 text-2xl font-bold">
          🔕
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {scope.kind === "watch"
              ? "Tạm dừng thông báo sản phẩm này?"
              : "Tắt toàn bộ email thông báo?"}
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            {scope.kind === "watch"
              ? "Bạn đang yêu cầu tạm dừng nhận thông báo cảnh báo biến động giá cho sản phẩm này."
              : "Bạn đang yêu cầu tắt toàn bộ email cảnh báo giá từ Kairo."}
          </p>
        </div>

        <UnsubscribeForm token={token} scopeKind={scope.kind} />

        <div>
          <Link
            href="/"
            className="text-xs text-muted hover:text-foreground font-medium"
          >
            ← Bỏ qua và quay lại trang chủ
          </Link>
        </div>
      </div>
    </main>
  );
}
