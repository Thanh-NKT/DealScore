import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Đặt mật khẩu mới — Kairo" };

/** Reached from the recovery link via /auth/confirm, which has already opened a session. */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/forgot-password?error=link_expired");

  return (
    <AuthShell
      title="Đặt mật khẩu mới"
      intro={
        <p>
          Cho tài khoản <b className="font-semibold text-ink [overflow-wrap:anywhere]">{user.email}</b>. Sau khi lưu, bạn dùng
          mật khẩu này để đăng nhập.
        </p>
      }
    >
      <ResetPasswordForm email={user.email ?? ""} />
    </AuthShell>
  );
}
