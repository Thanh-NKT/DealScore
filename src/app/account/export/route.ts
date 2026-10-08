import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildAccountExport, exportFileName } from "@/lib/account/export";
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
    prefsRes,
    foldersRes,
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
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    // At most 20 folders per user (trigger watch_folders_enforce_limit), far below the 1,000-row cap.
    supabase.from("watch_folders").select("id, name, sort_order, created_at").eq("user_id", user.id).order("sort_order"),
  ]);

  // ANY failing query → throw. Ignoring errors hands the user a file that is
  // missing data yet looks complete.
  const results = { profileRes, settingsRes, watchesRes, alertsRes, clicksRes, lookupsRes, pushRes, prefsRes, foldersRes };
  for (const [name, res] of Object.entries(results)) {
    if (res.error) throw new Error(`Data export: failed to read ${name}: ${res.error.message}`);
  }

  // Orders tied to the user's OWN clicks — conversions are readable only by the service role.
  const clickIds = (clicksRes.data ?? []).map((c) => c.id);
  const orders: Array<{ purchase_time: string; status: string; order_value: number | null; item_id: string }> = [];
  for (let i = 0; i < clickIds.length; i += 500) {
    const { data, error } = await admin
      .from("conversions")
      .select("purchase_time, status, order_value, item_id")
      .in("click_event_id", clickIds.slice(i, i + 500));
    if (error) throw new Error(`Data export: failed to read orders: ${error.message}`);
    orders.push(...(data ?? []));
  }

  // Analytics can exceed the silent 1000-row cap of PostgREST: page through.
  const activity: Array<{ created_at: string; name: string; props: unknown }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("analytics_events")
      .select("created_at, name, props")
      .eq("user_id", user.id)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Data export: failed to read activity: ${error.message}`);
    activity.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // Extension contributions are service-only tables, linked to the account by user_id (migration 0023).
  const extensionObservations: Array<{
    offer_id: string; observed_at: string; price: number; original_price: number | null; stock: number | null;
    free_shipping: boolean | null; has_voucher: boolean | null; promoted_at: string | null; created_at: string;
  }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("extension_observations")
      .select("offer_id, observed_at, price, original_price, stock, free_shipping, has_voucher, promoted_at, created_at")
      .eq("user_id", user.id)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Data export: failed to read extension observations: ${error.message}`);
    extensionObservations.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const extensionContributions: Array<{ created_at: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("extension_contributions")
      .select("created_at")
      .eq("user_id", user.id)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Data export: failed to read extension contributions: ${error.message}`);
    extensionContributions.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // "Góp ý dữ liệu" is a service-only table (migration 0043); the user's own rows, paged.
  const dataReports: Array<{ kind: string; message: string | null; created_at: string; status: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("data_reports")
      .select("kind, message, created_at, status")
      .eq("user_id", user.id)
      .order("created_at")
      .order("id") // unique tie-break: paging must not skip or repeat rows with the same created_at
      .range(from, from + 999);
    if (error) throw new Error(`Data export: failed to read data reports: ${error.message}`);
    dataReports.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const now = new Date();
  const exportData = buildAccountExport({
    activity,
    exportedAt: now,
    profile: profileRes.data!,
    settings: settingsRes.data!,
    preferences: prefsRes.data,
    watches: watchesRes.data ?? [],
    folders: foldersRes.data ?? [],
    alertEvents: alertsRes.data ?? [],
    pushDevices: pushRes.data ?? [],
    orders,
    clicks: clicksRes.data ?? [],
    lookups: lookupsRes.data ?? [],
    extensionObservations,
    extensionContributions,
    dataReports,
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
