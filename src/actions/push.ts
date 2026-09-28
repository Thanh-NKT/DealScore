"use server";

import { requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { trackAfter } from "@/lib/analytics/track";

/** subscription = PushSubscription.toJSON() from the browser. */
export async function savePushSubscription(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser({ path: "/account/notifications" });
  let url: URL;
  try {
    url = new URL(subscription.endpoint);
  } catch {
    return { ok: false, error: "Trình duyệt chưa bật được thông báo. Kiểm tra quyền thông báo của trang rồi thử lại." };
  }
  if (url.protocol !== "https:" || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { ok: false, error: "Trình duyệt chưa bật được thông báo. Kiểm tra quyền thông báo của trang rồi thử lại." };
  }

  // A device can switch signed-in users: if the endpoint belongs to another user, delete the old row.
  // Only admin can delete another user's row — identity was established by requireUser above.
  const admin = createAdminClient();
  const { error: delError } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", subscription.endpoint)
    .neq("user_id", user.id);
  if (delError) throw new Error(`Failed to clean up old subscription: ${delError.message}`);

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
  if (error) throw new Error(`Failed to save push subscription: ${error.message}`);
  trackAfter("push_enabled", { userId: user.id });
  return { ok: true };
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await requireUser({ path: "/account/notifications" });
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(`Failed to delete push subscription: ${error.message}`);
}
