import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  fromRow,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "@/lib/account/notification-settings";
import { NotificationSettingsForm } from "@/components/account/notification-settings-form";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await requireUser({ path: "/account/notifications" });
  const supabase = await createClient();

  const { data: settingsRow } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const settings = settingsRow
    ? fromRow(settingsRow)
    : DEFAULT_NOTIFICATION_SETTINGS;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12 space-y-8">
      {/* Breadcrumb & Tiêu đề */}
      <div className="space-y-2">
        <nav aria-label="Đường dẫn" className="text-xs text-muted flex items-center gap-2">
          <Link href="/account" className="hover:text-foreground">
            ← Quay lại Tài khoản
          </Link>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Cài đặt thông báo
        </h1>
        <p className="text-xs text-muted leading-relaxed">
          Tùy chỉnh phương thức và thời điểm bạn muốn nhận cảnh báo biến động
          giá từ Kairo.
        </p>
      </div>

      <div className="rounded-3xl border border-border bg-black/[0.01] p-6 sm:p-8 shadow-sm dark:bg-white/[0.01]">
        <NotificationSettingsForm initialSettings={settings} />
      </div>
    </main>
  );
}
