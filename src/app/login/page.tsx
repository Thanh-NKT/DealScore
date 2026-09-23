import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { LoginForm } from "@/components/account/login-form";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next: rawNext, error: rawError } = await searchParams;
  const next = safeNextPath(rawNext, "/");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:py-16">
      <div className="rounded-3xl border border-border bg-black/[0.01] p-6 sm:p-8 shadow-sm dark:bg-white/[0.01]">
        <div className="mb-6 space-y-2 text-center">
          <Link
            href="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background font-black text-sm mb-2"
          >
            K
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Đăng nhập Kairo
          </h1>
          <p className="text-xs text-muted leading-relaxed">
            Đăng nhập không cần mật khẩu. Nhận liên kết và mã 6 số qua email.
            Chưa có tài khoản sẽ tự động được tạo.
          </p>
        </div>

        <LoginForm initialNext={next} initialError={rawError} />
      </div>

      <p className="mt-8 text-center text-xs text-muted leading-relaxed">
        Bằng việc đăng nhập, bạn đồng ý với{" "}
        <Link href="/account/consent" className="text-foreground underline">
          Điều khoản sử dụng
        </Link>{" "}
        và{" "}
        <Link href="/account/consent" className="text-foreground underline">
          Chính sách quyền riêng tư
        </Link>{" "}
        của Kairo.
      </p>
    </main>
  );
}
