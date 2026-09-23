"use server";

import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** subscription = PushSubscription.toJSON() từ trình duyệt. */
export async function savePushSubscription(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser({ path: "/account/notifications" });
  let url: URL;
  try {
    url = new URL(subscription.endpoint);
  } catch {
    return { ok: false, error: "Endpoint không hợp lệ." };
  }
  if (url.protocol !== "https:" || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { ok: false, error: "Đăng ký thông báo không hợp lệ." };
  }

  // Một thiết bị có thể đổi người đăng nhập: endpoint thuộc user khác thì xóa bản cũ.
  // Chỉ admin xóa được hàng của user khác — danh tính đã được requireUser xác định ở trên.
  const admin = createAdminClient();
  const { error: delError } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", subscription.endpoint)
    .neq("user_id", user.id);
  if (delError) throw new Error(`Dọn đăng ký cũ thất bại: ${delError.message}`);

  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(`Lưu đăng ký thông báo thất bại: ${error.message}`);
  return { ok: true };
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await requireUser({ path: "/account/notifications" });
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(`Xóa đăng ký thông báo thất bại: ${error.message}`);
}
