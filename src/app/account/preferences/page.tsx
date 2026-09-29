import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getIntentVocab } from "@/lib/intent/vocab";
import { MARKETPLACES } from "@/lib/marketplaces";
import { getPreferenceCategories, getPreferencesForUser } from "@/lib/preferences/queries";
import { PreferencesForm } from "@/components/account/preferences-form";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const user = await requireUser({ path: "/account/preferences" });
  const supabase = await createClient();

  const [prefs, categories, vocab] = await Promise.all([
    getPreferencesForUser(supabase, user.id),
    getPreferenceCategories(supabase),
    getIntentVocab(),
  ]);

  // Saved brands that are no longer in the verified list stay visible (and checked) so a save
  // does not drop them silently.
  const known = new Set(vocab.brands.map((b) => b.toLowerCase()));
  const brands = [...vocab.brands, ...prefs.brands.filter((b) => !known.has(b.toLowerCase()))].sort((a, b) =>
    a.localeCompare(b, "vi"),
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="space-y-1.5">
        <nav aria-label="Đường dẫn" className="text-label">
          <Link href="/account" className="inline-flex min-h-10 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4"><path d="m15 6-6 6 6 6" /></svg>
            Quay lại Tài khoản
          </Link>
        </nav>
        <h1 className="display text-h1-sm font-extrabold leading-[1.1] text-ink sm:text-h1">Sở thích mua sắm</h1>
        <p className="text-body leading-relaxed text-ink-2">
          Hãng, danh mục, khoảng giá và sàn bạn hay mua. Khi tìm kiếm, bật “Theo sở thích của tôi” để Kairo lọc theo các lựa chọn này. Những gì bạn gõ hoặc chọn trên trang tìm kiếm luôn được ưu tiên.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-7 max-[760px]:p-5">
        <PreferencesForm
          initial={prefs}
          brands={brands}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          marketplaces={MARKETPLACES.map((m) => ({ id: m.id, name: m.name }))}
        />
      </div>
    </main>
  );
}
