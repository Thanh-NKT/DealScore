import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { needsConsent } from "@/lib/account/consent";
import { ConsentForm } from "@/components/account/consent-form";

export const dynamic = "force-dynamic";

interface ConsentPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext, "/account");

  // Kiểm tra user hiện tại (cho phép thiếu consent để hiển thị form)
  const user = await requireUser({
    path: `/account/consent?next=${encodeURIComponent(next)}`,
    allowMissingConsent: true,
  });

  // Nếu người dùng đã đồng ý phiên bản hiện tại rồi thì chuyển hướng về next luôn
  if (!needsConsent(user.consentVersion)) {
    redirect(next);
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12 sm:py-16">
      <div className="rounded-3xl border border-border bg-black/[0.01] p-6 sm:p-8 shadow-sm dark:bg-white/[0.01] space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-sm mb-1">
            ⚖
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Điều khoản & Quyền riêng tư
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            Để bảo vệ quyền lợi và dữ liệu cá nhân theo quy định, vui lòng xác
            nhận sự đồng ý của bạn trước khi tiếp tục sử dụng Kairo.
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-background/50 p-4 text-xs leading-relaxed text-muted space-y-2">
          <p className="font-semibold text-foreground">Tóm tắt ngắn gọn:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Kairo giúp bạn theo dõi lịch sử biến động giá và nhận thông báo khi
              giá giảm.
            </li>
            <li>
              Chúng tôi chỉ gửi email/thông báo khi có thay đổi giá theo tiêu chí
              bạn cài đặt.
            </li>
            <li>
              Bạn có thể tải về toàn bộ dữ liệu cá nhân hoặc yêu cầu xóa tài
              khoản bất cứ lúc nào.
            </li>
          </ul>
        </div>

        <ConsentForm initialNext={next} />
      </div>
    </main>
  );
}
