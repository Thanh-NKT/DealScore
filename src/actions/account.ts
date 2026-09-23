"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CURRENT_CONSENT_VERSION } from "@/lib/account/consent";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email";
import { renderAccountDeletionEmail } from "@/lib/email/templates/account-deletion";
import {
  parseNotificationSettings,
  toRow,
  type SettingsField,
} from "@/lib/account/notification-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { purgeDate as computePurgeDate } from "@/lib/account/purge-date";
import { siteUrl as getSiteUrl } from "@/lib/site-url";

export type ActionResult<E extends string = string> =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; errors: Partial<Record<E, string>> };

/**
 * Đồng ý điều khoản và chính sách (Cổng consent).
 */
export async function acceptConsent(
  prev: ActionResult<"agree">,
  form: FormData,
): Promise<ActionResult<"agree">> {
  const user = await requireUser({ path: "/account/consent", allowMissingConsent: true });

  const agree = form.get("agree") === "on";
  const marketing = form.get("marketing") === "on";
  const rawNext = form.get("next") as string | null;
  const next = safeNextPath(rawNext, "/account");

  if (!agree) {
    return {
      status: "error",
      errors: {
        agree:
          "Bạn phải đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư để tiếp tục.",
      },
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({
      consent_version: CURRENT_CONSENT_VERSION,
      consent_at: new Date().toISOString(),
      marketing_opt_in: marketing,
    })
    .eq("id", user.id);

  if (error) {
    throw new Error(`Lỗi cập nhật đồng ý điều khoản: ${error.message}`);
  }

  redirect(next);
}

/**
 * Cập nhật cài đặt thông báo (Email, Push, Giờ im lặng, Tần suất).
 */
export async function updateNotificationSettings(
  prev: ActionResult<SettingsField>,
  form: FormData,
): Promise<ActionResult<SettingsField>> {
  const user = await requireUser({ path: "/account/notifications" });
  const parsed = parseNotificationSettings(form);

  if (!parsed.ok) {
    return {
      status: "error",
      errors: parsed.errors,
    };
  }

  const supabase = await createClient();
  const rowData = toRow(parsed.value);

  const { error } = await supabase
    .from("notification_settings")
    .update(rowData)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Lỗi cập nhật cài đặt thông báo: ${error.message}`);
  }

  revalidatePath("/account/notifications");
  return { status: "saved" };
}

/**
 * Bật/tắt tùy chọn nhận email marketing.
 */
export async function updateMarketingOptIn(
  prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const user = await requireUser({ path: "/account/notifications" });
  const marketing = form.get("marketing") === "on";

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ marketing_opt_in: marketing })
    .eq("id", user.id);

  if (error) {
    throw new Error(`Lỗi cập nhật nhận email marketing: ${error.message}`);
  }

  revalidatePath("/account");
  return { status: "saved" };
}

/**
 * Yêu cầu xóa mềm tài khoản (giữ lại 30 ngày để khôi phục).
 */
export async function requestAccountDeletion(
  prev: ActionResult<"confirm">,
  form: FormData,
): Promise<ActionResult<"confirm">> {
  const user = await requireUser({ path: "/account/delete" });
  const confirm = (form.get("confirm") as string | null)?.trim().normalize("NFC") ?? "";

  if (confirm !== "XÓA" && confirm !== "xóa") {
    return {
      status: "error",
      errors: {
        confirm: 'Vui lòng gõ chính xác chữ "XÓA" để xác nhận.',
      },
    };
  }

  const now = new Date();
  const purgeDate = computePurgeDate(now);
  const siteUrl = getSiteUrl();

  // 1. Cập nhật deleted_at bằng admin client
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ deleted_at: now.toISOString() })
    .eq("id", user.id)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Lỗi khi yêu cầu xóa tài khoản: ${error.message}`);
  }

  // 2. Gửi email xác nhận (nếu lỗi chỉ log, không chặn quy trình xóa)
  if (user.email) {
    try {
      const emailContent = renderAccountDeletionEmail({ purgeDate, siteUrl });
      await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    } catch (err) {
      console.warn("Lỗi gửi email xác nhận xóa tài khoản:", err);
    }
  }

  // 3. Đăng xuất khỏi mọi thiết bị
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });

  redirect("/?account=deleted");
}

/**
 * Khôi phục tài khoản đang trong trạng thái chờ xóa.
 */
export async function restoreAccount(): Promise<void> {
  const user = await requireUser({ path: "/account/restore", allowPendingDeletion: true });

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ deleted_at: null })
    .eq("id", user.id);

  if (error) {
    throw new Error(`Lỗi khôi phục tài khoản: ${error.message}`);
  }

  revalidatePath("/account");
  redirect("/account");
}

/**
 * Đăng xuất khỏi phiên hiện tại trên thiết bị này.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}
