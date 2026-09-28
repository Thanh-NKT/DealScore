import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quên mật khẩu — Kairo" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Quên mật khẩu"
      intro="Nhập email bạn dùng với Kairo. Kairo sẽ gửi một link để bạn đặt mật khẩu mới."
      footer={
        <p>
          Nhớ ra rồi?{" "}
          <Link href="/login" className="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
            Quay lại đăng nhập
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm initialError={error} />
    </AuthShell>
  );
}
