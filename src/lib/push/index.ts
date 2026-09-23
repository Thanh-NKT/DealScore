import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PushPayload, PushSender } from "@/lib/alerts/dispatch";

const MAX_FAILURES = 5;
const TTL_SECONDS = 12 * 3600;

export const sendPushToUser: PushSender = async (userId: string, payload: PushPayload) => {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) throw new Error("Missing VAPID keys");
  webpush.setVapidDetails(subject, pub, priv);

  const admin = createAdminClient();
  const { data: subs, error } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  if (error) throw new Error(`Failed to read push_subscriptions: ${error.message}`);

  const result = { delivered: 0, removed: 0, failed: 0 };
  const body = JSON.stringify(payload);
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: TTL_SECONDS });
      result.delivered++;
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the device unsubscribed — delete. Other errors: count, delete after 5.
      if (status === 404 || status === 410 || s.failure_count + 1 >= MAX_FAILURES) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        result.removed++;
        if (status !== 404 && status !== 410) result.failed++;
      } else {
        await admin.from("push_subscriptions").update({ failure_count: s.failure_count + 1 }).eq("id", s.id);
        result.failed++;
      }
    }
  }
  return result;
};
