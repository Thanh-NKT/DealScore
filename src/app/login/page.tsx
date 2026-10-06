import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { isGoogleAuthEnabled } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Đăng nhập — DealScore" };

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next: rawNext, error: rawError } = await searchParams;
  const next = safeNextPath(rawNext, "/");

  return (
    <AuthShell
      tab="login"
      next={next}
      title="Chào mừng trở lại"
      intro="Đăng nhập để xem các sản phẩm bạn đang theo dõi giá."
      footer={
        <p>
          Trước đây bạn đăng nhập bằng mã gửi qua email? Tài khoản đó chưa có mật khẩu, hãy chọn{" "}
          <Link href="/forgot-password" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
            Quên mật khẩu
          </Link>{" "}
          để tạo.
        </p>
      }
    >
      {isGoogleAuthEnabled() && <GoogleSignIn next={next} />}
      <LoginForm initialNext={next} initialError={rawError} />
    </AuthShell>
  );
}
