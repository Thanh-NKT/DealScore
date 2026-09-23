import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeCutoff } from "@/lib/account/purge-date";

export { PURGE_AFTER_DAYS, purgeCutoff, purgeDate } from "@/lib/account/purge-date";

/**
 * Xóa hẳn các tài khoản đã yêu cầu xóa quá 30 ngày.
 * Xóa auth.users → cascade users → watches → alert_events, notification_settings;
 * click_events.user_id và lookup_requests.user_id → null.
 * Lỗi một user không dừng cả lượt. Chạy lại vô hại.
 */
export async function purgeDeletedAccounts(
  opts: { now: Date; limit?: number },
  client: SupabaseClient<Database> = createAdminClient(),
): Promise<{ purged: string[]; failed: Array<{ userId: string; error: string }> }> {
  const { data, error } = await client
    .from("users")
    .select("id")
    .lt("deleted_at", purgeCutoff(opts.now).toISOString())
    .order("deleted_at", { ascending: true })
    .limit(opts.limit ?? 100);
  if (error) throw new Error(`Đọc danh sách chờ xóa thất bại: ${error.message}`);

  const purged: string[] = [];
  const failed: Array<{ userId: string; error: string }> = [];
  for (const { id } of data ?? []) {
    const { error: delError } = await client.auth.admin.deleteUser(id);
    if (delError) failed.push({ userId: id, error: delError.message });
    else purged.push(id);
  }
  return { purged, failed };
}
