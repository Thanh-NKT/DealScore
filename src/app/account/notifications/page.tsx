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
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="space-y-1.5">
        <nav aria-label="Đường dẫn" className="text-[13px]">
          <Link href="/account" className="inline-flex min-h-10 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4"><path d="m15 6-6 6 6 6" /></svg>
            Quay lại Tài khoản
          </Link>
        </nav>
        <h1 className="display text-[30px] font-extrabold leading-[1.1] text-ink sm:text-[40px]">Cài đặt thông báo</h1>
        <p className="text-[16px] leading-relaxed text-ink-2">
          Tùy chỉnh phương thức và thời điểm bạn muốn nhận cảnh báo biến động giá từ Kairo.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-7 max-[760px]:p-5">
        <NotificationSettingsForm initialSettings={settings} />
      </div>
    </main>
  );
}
