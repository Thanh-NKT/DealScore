import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { confirmEmailLink } from "@/actions/confirm";
import { ConfirmButton } from "@/components/auth/confirm-button";
import { MailIcon, ShieldCheckIcon } from "@/components/ui/icons";
import { confirmFailureUrl, parseConfirmParams } from "@/lib/auth/confirm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Xác nhận — Kairo",
  robots: { index: false, follow: false },
};

interface ConfirmPageProps {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}

const CARD = "mx-auto w-full max-w-[480px] space-y-4 rounded-lg border border-line bg-surface p-7 max-[760px]:p-5";
const TITLE = "display text-h2 font-extrabold leading-[1.15] text-balance text-ink max-[760px]:text-price-input";
const BODY = "max-w-[68ch] text-body leading-[1.6] text-ink-2";
const ICON_TILE = "inline-flex size-12 items-center justify-center rounded-md bg-surface-2 text-ink";

/**
 * Landing page of the email links (old links included: same URL). Rendering it uses nothing:
 * the single-use token is spent only by the button's POST (see src/lib/auth/confirm.ts).
 */
export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const parsed = parseConfirmParams(await searchParams);
  if (!parsed.ok) redirect(confirmFailureUrl(parsed.type, "link_expired", parsed.next));
  const { tokenHash, type, next } = parsed.params;
  const recovery = type === "recovery";

  return (
    <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:py-14">
      <div className={CARD}>
        <span className={ICON_TILE}>
          {recovery ? <ShieldCheckIcon className="size-6" strokeWidth={2} /> : <MailIcon className="size-6" strokeWidth={2} />}
        </span>
        <h1 className={TITLE}>{recovery ? "Đặt lại mật khẩu" : "Xác nhận email của bạn"}</h1>
        <p className={BODY}>
          {recovery
            ? "Bấm nút bên dưới để tiếp tục. Sau đó bạn đặt mật khẩu mới cho tài khoản Kairo."
            : "Bấm nút bên dưới để hoàn tất đăng ký. Tài khoản Kairo dùng được ngay sau đó."}
        </p>
        <form action={confirmEmailLink}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={next} />
          <ConfirmButton label={recovery ? "Tiếp tục đặt mật khẩu mới" : "Xác nhận email"} />
        </form>
      </div>
    </main>
  );
}
