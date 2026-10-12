import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { needsConsent } from "@/lib/account/consent";
import { ConsentForm } from "@/components/account/consent-form";
import { ShieldCheckIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

interface ConsentPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext, "/account");

  // Check the current user (missing consent allowed so the form can render)
  const user = await requireUser({
    path: `/account/consent?next=${encodeURIComponent(next)}`,
    allowMissingConsent: true,
  });

  // If the user already accepted the current version, go straight to next
  if (!needsConsent(user.consentVersion)) {
    redirect(next);
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:py-14">
      <div className="space-y-6 rounded-lg border border-line bg-surface p-7 max-[760px]:p-5">
        <div className="space-y-2">
          <span className="mb-2 inline-flex size-11 items-center justify-center rounded-md bg-surface-2 text-ink">
            <ShieldCheckIcon className="size-5" strokeWidth={2} />
          </span>
          <h1 className="display text-h2 font-semibold leading-[1.15] text-ink max-[760px]:text-price-input">Điều khoản &amp; Quyền riêng tư</h1>
          <p className="text-control leading-relaxed text-ink-2">
            Để bảo vệ quyền lợi và dữ liệu cá nhân theo quy định, vui lòng xác nhận sự đồng ý của bạn trước khi tiếp tục sử dụng DealScore.
          </p>
        </div>

        <div className="space-y-2 rounded-md bg-surface-2 p-4 text-body-sm leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">Tóm tắt ngắn gọn:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>DealScore giúp bạn theo dõi lịch sử biến động giá và nhận thông báo khi giá giảm.</li>
            <li>Chúng tôi chỉ gửi email/thông báo khi có thay đổi giá theo tiêu chí bạn cài đặt.</li>
            <li>Bạn có thể tải về toàn bộ dữ liệu cá nhân hoặc yêu cầu xóa tài khoản bất cứ lúc nào.</li>
          </ul>
        </div>

        <ConsentForm initialNext={next} />
      </div>
    </main>
  );
}
