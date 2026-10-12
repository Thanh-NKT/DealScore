import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listMySavedSearches } from "@/lib/saved-search/queries";
import { listMyDemandFollows } from "@/lib/demand-follow/queries";
import { demandFollowRowView, savedSearchRowView } from "@/lib/saved-search/view";
import { MAX_SAVED_SEARCHES } from "@/lib/saved-search/constants";
import { DemandFollowList, SavedSearchList } from "@/components/account/saved-searches";

export const dynamic = "force-dynamic";

/** "Tìm kiếm đã lưu" (roadmap P4 E/F, UI spec §1.2): saved searches and "Báo khi có" keywords. */
export default async function SavedSearchesPage() {
  const user = await requireUser({ path: "/account/searches" });
  const supabase = await createClient();
  const [searches, follows, cats] = await Promise.all([
    listMySavedSearches(user.id, supabase),
    listMyDemandFollows(user.id, supabase),
    supabase.from("categories").select("slug, name"),
  ]);
  const categoryNames = Object.fromEntries((cats.data ?? []).map((c) => [c.slug, c.name]));

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="space-y-1.5">
        <nav aria-label="Đường dẫn" className="text-label">
          <Link href="/account" className="inline-flex min-h-10 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4">
              <path d="m15 6-6 6 6 6" />
            </svg>
            Quay lại Tài khoản
          </Link>
        </nav>
        <h1 className="display text-h1-sm font-semibold leading-[1.1] text-ink sm:text-h1">Tìm kiếm đã lưu</h1>
      </div>

      <section aria-labelledby="saved-title" className="space-y-3">
        <h2 id="saved-title" className="display text-h3 font-semibold text-ink">
          Tìm kiếm đã lưu (<span className="num">{searches.length}</span>/<span className="num">{MAX_SAVED_SEARCHES}</span>)
        </h2>
        <SavedSearchList rows={searches.map((s) => savedSearchRowView(s, categoryNames))} />
      </section>

      {follows.length > 0 ? (
        <section aria-labelledby="follows-title" className="space-y-3">
          <h2 id="follows-title" className="display text-h3 font-semibold text-ink">
            Đang chờ có sản phẩm
          </h2>
          <DemandFollowList rows={follows.map(demandFollowRowView)} />
        </section>
      ) : null}
    </main>
  );
}
