import Link from "next/link";
import { verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { UnsubscribeForm } from "@/components/watch/unsubscribe-form";
import { CheckCircleIcon, InfoIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

interface UnsubscribePageProps {
  searchParams: Promise<{ t?: string; done?: string }>;
}

const CARD = "mx-auto w-full max-w-[480px] space-y-4 rounded-lg border border-line bg-surface p-7 max-[760px]:p-5";
const TITLE = "display text-h2 font-extrabold leading-[1.15] text-balance text-ink max-[760px]:text-price-input";
const BODY = "max-w-[68ch] text-body leading-[1.6] text-ink-2";
const ICON_TILE = "inline-flex size-12 items-center justify-center rounded-md bg-surface-2 text-ink";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-control font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2";

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { t: token, done } = await searchParams;
  // No default value: a default string lives publicly in the repo, so anyone could forge tokens.
  const secret = process.env.UNSUBSCRIBE_SECRET;

  // Done. Worded as the current state, so it is also true when the person had already unsubscribed.
  if (done === "watch" || done === "email") {
    return (
      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-14">
        <div className={CARD}>
          <span className={ICON_TILE}>
            <CheckCircleIcon className="size-6" strokeWidth={2} />
          </span>
          <h1 className={TITLE}>
            {done === "watch" ? "Thông báo cho sản phẩm này đang tạm dừng" : "Email thông báo giá đang tắt"}
          </h1>
          <p className={BODY}>
            {done === "watch"
              ? "Kairo vẫn ghi nhận giá sản phẩm này; bạn chỉ không nhận thông báo nữa. Bật lại bất cứ lúc nào trong “Đang theo dõi”."
              : "Kairo sẽ không gửi email thông báo giá nữa. Thông báo trên trình duyệt (nếu bạn đã bật) không thay đổi. Bật lại bất cứ lúc nào trong phần Thông báo."}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={done === "watch" ? "/account/watch" : "/account/notifications"} className={SECONDARY}>
              {done === "watch" ? "Xem danh sách theo dõi" : "Cài đặt thông báo"}
            </Link>
            <Link href="/" className="inline-flex min-h-11 items-center px-2 text-control font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
              Về trang chủ
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Missing UNSUBSCRIBE_SECRET → treat every token as invalid.
  const scope = token && secret ? verifyUnsubscribeToken(token, secret) : null;

  if (!scope || !token) {
    return (
      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-14">
        <div className={CARD}>
          <span className={ICON_TILE}>
            <InfoIcon className="size-6" strokeWidth={2} />
          </span>
          <h1 className={TITLE}>Liên kết này không còn dùng được</h1>
          <p className={BODY}>
            Có thể liên kết bị cắt mất một phần khi sao chép, hoặc đã cũ. Bạn vẫn tắt được thông báo trong tài khoản, chỉ mất vài giây.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href="/account/notifications" className={SECONDARY}>
              Cài đặt thông báo
            </Link>
            <Link href="/" className="inline-flex min-h-11 items-center px-2 text-control font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
              Về trang chủ
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-14">
      <div className={CARD}>
        <h1 className={TITLE}>
          {scope.kind === "watch" ? "Tạm dừng thông báo cho sản phẩm này?" : "Tắt email thông báo giá?"}
        </h1>
        <p className={BODY}>
          {scope.kind === "watch"
            ? "Bạn sẽ không nhận thông báo giá cho sản phẩm này nữa. Các sản phẩm khác không bị ảnh hưởng."
            : "Bạn sẽ không nhận email thông báo giá từ Kairo nữa. Bạn vẫn xem được giá mọi lúc trên trang web."}
        </p>
        <UnsubscribeForm token={token} scopeKind={scope.kind} />
        <Link href="/" className="inline-flex min-h-11 items-center text-control font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
          Không, giữ nguyên
        </Link>
      </div>
    </main>
  );
}
