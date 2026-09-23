import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { DeleteAccountForm } from "@/components/account/delete-account-form";

export const dynamic = "force-dynamic";

export default async function DeleteAccountPage() {
  await requireUser({ path: "/tai-khoan/xoa" });

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12 sm:py-16">
      <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.02] p-6 sm:p-8 shadow-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 font-bold text-sm mb-1">
            ⚠
          </div>
          <h1 className="text-xl font-bold tracking-tight text-red-600 dark:text-red-400 sm:text-2xl">
            Xác nhận xóa tài khoản
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            Hành động này sẽ bắt đầu quá trình xóa tài khoản Kairo của bạn.
          </p>
        </div>

        <div className="rounded-2xl border border-red-500/10 bg-background/50 p-4 text-xs leading-relaxed text-muted space-y-3">
          <p className="font-semibold text-foreground">
            Những điều sẽ xảy ra khi bạn xác nhận:
          </p>
          <ul className="list-disc pl-4 space-y-1.5">
            <li>
              Mọi cảnh báo giá (email và push) sẽ <strong>dừng ngay lập tức</strong>.
            </li>
            <li>
              Bạn sẽ bị <strong>đăng xuất khỏi tất cả thiết bị</strong>.
            </li>
            <li>
              Trong vòng <strong>30 ngày</strong>, tài khoản được giữ ở trạng thái
              chờ xóa. Bạn có thể đăng nhập lại bất kỳ lúc nào để khôi phục.
            </li>
            <li>
              Sau 30 ngày, toàn bộ hồ sơ, danh sách Watch và lịch sử cảnh báo sẽ
              bị <strong>xóa vĩnh viễn</strong> và không thể khôi phục.
            </li>
            <li>
              Lịch sử lượt bấm mua hàng được giữ lại độc lập (tách khỏi tài
              khoản, không còn gắn với danh tính của bạn) để đối soát hoa hồng
              với sàn thương mại điện tử.
            </li>
          </ul>
        </div>

        <DeleteAccountForm />

        <div className="text-center pt-2">
          <Link
            href="/tai-khoan"
            className="text-xs font-semibold text-muted hover:text-foreground"
          >
            ← Hủy và quay lại Tài khoản
          </Link>
        </div>
      </div>
    </main>
  );
}
