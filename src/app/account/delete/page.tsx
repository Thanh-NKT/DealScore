import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { DeleteAccountForm } from "@/components/account/delete-account-form";

export const dynamic = "force-dynamic";

export default async function DeleteAccountPage() {
  await requireUser({ path: "/account/delete" });

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <nav aria-label="Đường dẫn" className="mb-3 text-[13px]">
        <Link href="/account" className="inline-flex min-h-10 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
            <path d="m15 6-6 6 6 6" />
          </svg>
          Tài khoản
        </Link>
      </nav>
      <div className="space-y-6 rounded-lg border border-line bg-surface p-7 max-[760px]:p-5">
        <div>
          <h1 className="display text-[28px] font-extrabold leading-[1.15] text-ink max-[760px]:text-[24px]">Xóa tài khoản</h1>
          <p className="mt-1.5 text-[15px] text-ink-2">Đọc kỹ những gì sẽ xảy ra trước khi xác nhận.</p>
        </div>

        <DeleteAccountForm />

        <Link
          href="/account"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-strong bg-surface text-[15px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2"
        >
          Giữ tài khoản và quay lại
        </Link>
      </div>
    </main>
  );
}
