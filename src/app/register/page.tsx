import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { GoogleSignIn } from "@/components/auth/google-sign-in";
import { isGoogleAuthEnabled } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tạo tài khoản — Kairo" };

const LINK = "font-semibold text-primary underline underline-offset-4 hover:text-primary-hover";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(rawNext, "/");

  return (
    <AuthShell
      tab="register"
      next={next}
      title="Tạo tài khoản Kairo"
      intro="Miễn phí. Kairo gửi một thư để xác nhận email trước khi bạn bắt đầu theo dõi giá."
      footer={
        <p>
          Khi tạo tài khoản, bạn đồng ý với{" "}
          <Link href="/terms" className={LINK}>
            Điều khoản sử dụng
          </Link>{" "}
          và{" "}
          <Link href="/privacy" className={LINK}>
            Chính sách quyền riêng tư
          </Link>{" "}
          của Kairo.
        </p>
      }
    >
      {isGoogleAuthEnabled() && <GoogleSignIn next={next} label="Đăng ký bằng Google" />}
      <RegisterForm initialNext={next} />
    </AuthShell>
  );
}
