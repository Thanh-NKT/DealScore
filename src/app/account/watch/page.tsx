import { addAffiliateDisclosure } from "@/lib/affiliate/disclosure";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow } from "@/lib/account/notification-settings";
import { listMyFolders, listMyWatches } from "@/lib/watch/queries";
import { WatchList } from "@/components/watch/watch-list";

export const dynamic = "force-dynamic";

export default async function MyWatchesPage() {
  const user = await requireUser({ path: "/account/watch" });
  const supabase = await createClient();

  const [rawItems, folders, settingsResult] = await Promise.all([
    listMyWatches(user.id, new Date(), supabase),
    listMyFolders(user.id, supabase),
    supabase.from("notification_settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  if (settingsResult.error) {
    throw new Error(`Failed to load notification settings: ${settingsResult.error.message}`);
  }
  // "Liên kết tiếp thị" next to "Đến {sàn}" (display only; the watch engine never reads affiliate data).
  const items = await addAffiliateDisclosure(supabase, rawItems);
  const settings = settingsResult.data ? fromRow(settingsResult.data) : DEFAULT_NOTIFICATION_SETTINGS;

  return (
    <div className="w-full bg-canvas py-8 sm:py-10">
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-14">
        <WatchList initialItems={items} folders={folders} settings={settings} />
      </div>
    </div>
  );
}
