import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isShareToken } from "@/lib/share-folder/token";
import { parseSharedFolder } from "@/lib/share-folder/view";
import { SharedFolderCard } from "@/components/share-folder/shared-folder-card";
import { ButtonLink } from "@/components/ui/button";
import { trackAfter } from "@/lib/analytics/track";
import { toVnDate } from "@/lib/format";

// Per-request (nonce CSP, revocation must apply at once).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

/** One RPC per request (metadata + page share it). Anon/RLS server client: the RPC is the only door. */
const loadShared = cache(async (token: string) => {
  if (!isShareToken(token)) return null; // guessed / short token: 404 without a DB call
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shared_folder_view", { p_token: token });
  if (error) throw new Error(`shared_folder_view failed: ${error.message}`);
  return parseSharedFolder(data);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const view = await loadShared(token);
  return {
    title: view ? `${view.title} — danh sách trên DealScore` : "Không tìm thấy danh sách",
    // A private list behind a secret link: never indexed, never leaks the URL through Referer.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // No product, image or user data in link previews: a generic title only.
    openGraph: { title: "Danh sách trên DealScore", type: "website", locale: "vi_VN" },
  };
}

export default async function SharedFolderPage({ params }: Props) {
  const { token } = await params;
  const view = await loadShared(token);
  if (!view) notFound();
  trackAfter("shared_folder_viewed", {});
  const now = new Date();
  const sub = [
    view.displayName ? `Danh sách của ${view.displayName}` : "Danh sách được chia sẻ",
    view.updatedAt ? `Cập nhật ${toVnDate(view.updatedAt)}` : null,
    `${view.items.length} sản phẩm`,
  ].filter(Boolean);

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-8 sm:px-6 lg:px-14">
        <header className="space-y-2">
          <h1 className="display text-h2 font-extrabold leading-tight text-ink text-balance">{view.title}</h1>
          <p className="text-body-sm text-ink-2">{sub.join(" · ")}</p>
        </header>
        {view.items.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {view.items.map((item, i) => (
              <SharedFolderCard key={`${item.href}-${i}`} item={item} now={now} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-surface p-6 text-body text-ink-2">Danh sách này chưa có sản phẩm.</p>
        )}
        <section className="flex flex-col items-start gap-3 rounded-lg bg-surface-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body font-semibold text-ink">Theo dõi giá như thế này trên DealScore</p>
          <ButtonLink href="/register" variant="primary">
            Tạo tài khoản miễn phí
          </ButtonLink>
        </section>
      </div>
    </main>
  );
}
