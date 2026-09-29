import Link from "next/link";
import { toSearchParams, type SearchParams } from "@/lib/search";
import { togglePrefsParams } from "@/lib/preferences";
import { HeartIcon } from "@/components/ui/icons";
import { pillClass } from "@/components/ui/pill";

/**
 * "Theo sở thích của tôi" (spec §5): a plain link that flips `prefs=1`, so it works without JS.
 * Off by default. Only rendered for signed-in users with non-empty preferences (the page decides).
 */
export function PrefsToggle({ base, on }: { base: SearchParams; on: boolean }) {
  const qs = toSearchParams(togglePrefsParams(base, on)).toString();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link href={qs ? `/search?${qs}` : "/search"} scroll={false} aria-pressed={on} className={pillClass(on, { className: "gap-1.5" })}>
        <HeartIcon className="size-4" />
        Theo sở thích của tôi
      </Link>
      <Link
        href="/account/preferences"
        className="inline-flex min-h-10 items-center px-1 text-label font-semibold text-ink-2 underline-offset-4 hover:text-ink hover:underline"
      >
        Sửa sở thích
      </Link>
    </div>
  );
}
