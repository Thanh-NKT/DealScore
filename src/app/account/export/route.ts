import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildAccountExport, exportFileName } from "@/lib/account-export";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/account");
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const [
    profileRes,
    settingsRes,
    watchesRes,
    alertsRes,
    clicksRes,
    lookupsRes,
    pushRes,
  ] = await Promise.all([
    supabase.from("users").select("*").eq("id", user.id).single(),
    supabase.from("notification_settings").select("*").eq("user_id", user.id).single(),
    supabase.from("watches").select("*").eq("user_id", user.id),
    supabase
      .from("alert_events")
      .select("watch_id, trigger_types, price, deal_score, created_at, alert_deliveries(channel, status, sent_at), watches!inner(user_id)")
      .eq("watches.user_id", user.id),
    supabase.from("click_events").select("*").eq("user_id", user.id),
    admin
      .from("lookup_requests")
      .select("created_at, outcome")
      .eq("user_id", user.id),
    supabase.from("push_subscriptions").select("created_at, user_agent").eq("user_id", user.id),
  ]);

  // BẤT KỲ truy vấn nào lỗi → ném. Bỏ qua lỗi là đưa cho người dùng một file
  // thiếu dữ liệu mà trông như đầy đủ.
  const results = { profileRes, settingsRes, watchesRes, alertsRes, clicksRes, lookupsRes, pushRes };
  for (const [name, res] of Object.entries(results)) {
    if (res.error) throw new Error(`Xuất dữ liệu: đọc ${name} thất bại: ${res.error.message}`);
  }

  // Đơn hàng gắn với click của CHÍNH user — conversions chỉ service role đọc được.
  const clickIds = (clicksRes.data ?? []).map((c) => c.id);
  const orders: Array<{ purchase_time: string; status: string; order_value: number | null; item_id: string }> = [];
  for (let i = 0; i < clickIds.length; i += 500) {
    const { data, error } = await admin
      .from("conversions")
      .select("purchase_time, status, order_value, item_id")
      .in("click_event_id", clickIds.slice(i, i + 500));
    if (error) throw new Error(`Xuất dữ liệu: đọc đơn hàng thất bại: ${error.message}`);
    orders.push(...(data ?? []));
  }

  const now = new Date();
  const exportData = buildAccountExport({
    exportedAt: now,
    profile: profileRes.data!,
    settings: settingsRes.data!,
    watches: watchesRes.data ?? [],
    alertEvents: alertsRes.data ?? [],
    pushDevices: pushRes.data ?? [],
    orders,
    clicks: clicksRes.data ?? [],
    lookups: lookupsRes.data ?? [],
  });

  const filename = exportFileName(now);

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
