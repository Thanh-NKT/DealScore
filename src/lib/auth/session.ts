import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { decideAuthGate, safeNextPath } from "@/lib/auth/redirect";

export interface CurrentUser {
  id: string;
  email: string | null;
  consentVersion: string | null;
  marketingOptIn: boolean;
  deletedAt: string | null;
}

/**
 * Lấy thông tin người dùng hiện tại từ session server (cookie).
 * Trả về null nếu chưa đăng nhập.
 * Ném lỗi nếu đã có auth.user nhưng không đọc được hồ sơ public.users.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, consent_version, marketing_opt_in, deleted_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error(
      `Không thể tải hồ sơ người dùng ${user.id}: ${profileError?.message ?? "hồ sơ không tồn tại"}`,
    );
  }

  return {
    id: profile.id,
    email: profile.email,
    consentVersion: profile.consent_version,
    marketingOptIn: profile.marketing_opt_in,
    deletedAt: profile.deleted_at,
  };
}

/**
 * Bắt buộc người dùng phải đăng nhập và thỏa mãn các cổng kiểm tra (AuthGate).
 * Nếu không thỏa mãn, tự động redirect() tới cổng tương ứng.
 */
export async function requireUser(opts: {
  path?: string;
  allowPendingDeletion?: boolean;
  allowMissingConsent?: boolean;
} = {}): Promise<CurrentUser> {
  const path = opts.path ?? "/";
  const user = await getCurrentUser();

  const gate = decideAuthGate({
    userId: user?.id ?? null,
    profile: user
      ? {
          consentVersion: user.consentVersion,
          deletedAt: user.deletedAt,
        }
      : null,
    path,
    allowPendingDeletion: opts.allowPendingDeletion,
    allowMissingConsent: opts.allowMissingConsent,
  });

  if (gate.kind === "ok") {
    return user!;
  }

  redirect(gate.to);
}

/**
 * Điều hướng người dùng sau khi xác thực OTP thành công.
 * Kiểm tra xem tài khoản có đang chờ xóa hoặc cần đồng ý điều khoản trước khi về `next`.
 *
 * Dùng CHÍNH client vừa verifyOtp: session mới ghi vào cookie trong cùng request
 * chưa chắc đã được một createClient() khác đọc lại — khi đó người dùng vừa đăng
 * nhập xong lại bị coi là chưa đăng nhập.
 */
export async function redirectAfterLogin(
  supabase: SupabaseClient<Database>,
  userId: string,
  next: string,
): Promise<never> {
  const safeNext = safeNextPath(next, "/");

  const { data: profile, error } = await supabase
    .from("users")
    .select("consent_version, deleted_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Không thể tải hồ sơ người dùng ${userId}: ${error.message}`);

  const gate = decideAuthGate({
    userId,
    profile: profile ? { consentVersion: profile.consent_version, deletedAt: profile.deleted_at } : null,
    path: safeNext,
  });

  if (gate.kind === "ok") {
    redirect(safeNext);
  } else {
    redirect(gate.to);
  }
}
