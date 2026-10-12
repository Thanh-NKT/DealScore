import Link from "next/link";
import { verifyUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { UnsubscribeForm } from "@/components/watch/unsubscribe-form";
import { CheckCircleIcon, InfoIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

interface UnsubscribePageProps {
  searchParams: Promise<{ t?: string; done?: string }>;
}

type ScopeKind = "watch" | "email" | "saved_search" | "demand_follow";
const DONE_COPY: Record<ScopeKind, { title: string; body: string; href: string; link: string }> = {
  watch: {
    title: "Thông báo cho sản phẩm này đang tạm dừng",
    body: "DealScore vẫn ghi nhận giá sản phẩm này; bạn chỉ không nhận thông báo nữa. Bật lại bất cứ lúc nào trong “Đang theo dõi”.",
    href: "/account/watch",
    link: "Xem danh sách theo dõi",
  },
  email: {
    title: "Email thông báo giá đang tắt",
    body: "DealScore sẽ không gửi email thông báo giá nữa. Thông báo trên trình duyệt (nếu bạn đã bật) không thay đổi. Bật lại bất cứ lúc nào trong phần Thông báo.",
    href: "/account/notifications",
    link: "Cài đặt thông báo",
  },
  saved_search: {
    title: "Tìm kiếm này đang tạm dừng",
    body: "DealScore sẽ không báo sản phẩm mới cho tìm kiếm này nữa. Các tìm kiếm khác không bị ảnh hưởng. Bật lại bất cứ lúc nào trong “Tìm kiếm đã lưu”.",
    href: "/account/searches",
    link: "Xem tìm kiếm đã lưu",
  },
  demand_follow: {
    title: "Đã hủy báo cho từ khóa này",
    body: "DealScore đã xóa từ khóa này khỏi tài khoản của bạn và sẽ không báo nữa.",
    href: "/account/searches",
    link: "Xem tìm kiếm đã lưu",
  },
};
const ASK_COPY: Record<ScopeKind, { title: string; body: string }> = {
  watch: {
    title: "Tạm dừng thông báo cho sản phẩm này?",
    body: "Bạn sẽ không nhận thông báo giá cho sản phẩm này nữa. Các sản phẩm khác không bị ảnh hưởng.",
  },
  email: {
    title: "Tắt email thông báo giá?",
    body: "Bạn sẽ không nhận email thông báo giá từ DealScore nữa. Bạn vẫn xem được giá mọi lúc trên trang web.",
  },
  saved_search: {
    title: "Tạm dừng tìm kiếm đã lưu này?",
    body: "Bạn sẽ không nhận tin sản phẩm mới cho tìm kiếm này nữa. Các tìm kiếm và sản phẩm theo dõi khác không bị ảnh hưởng.",
  },
  demand_follow: {
    title: "Không báo cho từ khóa này nữa?",
    body: "DealScore sẽ xóa từ khóa này khỏi tài khoản của bạn. Các thông báo khác không bị ảnh hưởng.",
  },
};
const isScopeKind = (v: string | undefined): v is ScopeKind =>
  v === "watch" || v === "email" || v === "saved_search" || v === "demand_follow";

const CARD = "mx-auto w-full max-w-[480px] space-y-4 rounded-lg border border-line bg-surface p-7 max-[760px]:p-5";
const TITLE = "display text-h2 font-semibold leading-[1.15] text-balance text-ink max-[760px]:text-price-input";
const BODY = "max-w-[68ch] text-body leading-[1.6] text-ink-2";
const ICON_TILE = "inline-flex size-12 items-center justify-center rounded-md bg-surface-2 text-ink";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong/60 bg-surface px-5 text-control font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2";

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { t: token, done } = await searchParams;
  // No default value: a default string lives publicly in the repo, so anyone could forge tokens.
  const secret = process.env.UNSUBSCRIBE_SECRET;

  // Done. Worded as the current state, so it is also true when the person had already unsubscribed.
  if (isScopeKind(done)) {
    const copy = DONE_COPY[done];
    return (
      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-14">
        <div className={CARD}>
          <span className={ICON_TILE}>
            <CheckCircleIcon className="size-6" strokeWidth={2} />
          </span>
          <h1 className={TITLE}>{copy.title}</h1>
          <p className={BODY}>{copy.body}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={copy.href} className={SECONDARY}>
              {copy.link}
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
        <h1 className={TITLE}>{ASK_COPY[scope.kind].title}</h1>
        <p className={BODY}>{ASK_COPY[scope.kind].body}</p>
        <UnsubscribeForm token={token} scopeKind={scope.kind} />
        <Link href="/" className="inline-flex min-h-11 items-center text-control font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
          Không, giữ nguyên
        </Link>
      </div>
    </main>
  );
}
