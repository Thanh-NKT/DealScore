"use client";

import { useId, useState, type FormEvent } from "react";
import { ClockIcon, LinkIcon } from "@/components/ui/icons";
import { LookupProblem } from "./lookup-problem";
import { slowMessage, useLookup } from "./use-lookup";

interface UrlLookupFormProps {
  autoFocus?: boolean;
  /**
   * "hero": the home page paste row — a borderless input and the primary button inside the
   * surrounding search card (the card draws the frame). "inline" (default): a standalone input with
   * its own control border, e.g. inside the search empty state.
   */
  variant?: "hero" | "inline";
}

const BUTTON_BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold transition-colors duration-150 ease-out";

/**
 * Paste a marketplace link → product page. The link is checked on the client first (instant
 * feedback for text that isn't a link, other marketplaces, shop/category links; share text with a
 * link inside is fine), then /api/lookup runs with a timeout the user can also cancel. Slow
 * first-time lookups say what is happening; every failure says what to do next.
 */
export function UrlLookupForm({ autoFocus = false, variant = "inline" }: UrlLookupFormProps) {
  const uid = useId();
  const [url, setUrl] = useState("");
  // An empty submit says what to do instead of greying out the main action on the home page.
  const [emptyHint, setEmptyHint] = useState(false);
  const lookup = useLookup();
  const busy = lookup.loading || lookup.navigating;
  const hero = variant === "hero";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setEmptyHint(true);
      document.getElementById(`${uid}-url`)?.focus();
      return;
    }
    void lookup.run(url);
  };

  const size = hero ? "min-h-13 px-6 text-[16px] font-bold" : "min-h-11 px-5 text-[16px]";

  return (
    <div className={`w-full ${hero ? "space-y-2" : "space-y-3"}`}>
      <form
        onSubmit={onSubmit}
        noValidate
        className={
          hero
            ? "flex items-center gap-2.5 rounded-md py-0 pl-3.5 min-[561px]:focus-within:outline-2 min-[561px]:focus-within:outline-offset-2 min-[561px]:focus-within:outline-(--focus) max-[560px]:flex-col max-[560px]:items-stretch max-[560px]:pl-0"
            : "flex gap-2 max-[560px]:flex-col"
        }
      >
        {hero && <LinkIcon className="size-5 text-ink-3 max-[560px]:hidden" />}
        <label htmlFor={`${uid}-url`} className="sr-only">
          Link sản phẩm
        </label>
        <input
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setEmptyHint(false);
            lookup.clearProblem();
          }}
          autoFocus={autoFocus}
          placeholder="Dán link sản phẩm Shopee (shopee.vn/… hoặc shope.ee/…)"
          readOnly={busy}
          aria-invalid={Boolean(lookup.problem) || undefined}
          aria-describedby={`${uid}-status`}
          className={
            hero
              ? "min-h-13 min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-3 focus:outline-none read-only:text-ink-2 max-[560px]:rounded-md max-[560px]:border max-[560px]:border-line-strong max-[560px]:px-3.5 max-[560px]:focus:border-primary max-[560px]:focus:outline-2 max-[560px]:focus:outline-offset-2 max-[560px]:focus:outline-(--focus) max-[560px]:aria-[invalid=true]:border-ink"
              : "min-h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3.5 text-[16px] text-ink placeholder:text-ink-3 focus:border-primary focus:outline-2 focus:outline-offset-2 focus:outline-(--focus) read-only:text-ink-2 aria-[invalid=true]:border-ink"
          }
        />
        {lookup.loading ? (
          <button
            type="button"
            onClick={lookup.cancel}
            className={`${BUTTON_BASE} ${size} border border-line-strong bg-surface text-ink hover:bg-surface-2`}
          >
            Hủy
          </button>
        ) : (
          <button
            type="submit"
            disabled={lookup.navigating}
            className={`${BUTTON_BASE} ${size} bg-primary text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3`}
          >
            {lookup.navigating ? "Đang mở…" : "Kiểm tra giá"}
          </button>
        )}
      </form>

      <div id={`${uid}-status`} aria-live="polite" className={hero ? "empty:hidden [&>*]:mt-1" : undefined}>
        {emptyHint && (
          <p className="max-w-[68ch] text-[14px] leading-normal text-ink-2">
            Dán link sản phẩm vào ô trên. Trong ứng dụng Shopee: mở sản phẩm → Chia sẻ → Sao chép liên kết.
          </p>
        )}
        {lookup.loading && (
          <p className="flex items-center gap-1.5 text-[14px] text-ink-2">
            <ClockIcon className="size-4" />
            {slowMessage(lookup.slow)}
          </p>
        )}
        {lookup.problem && <LookupProblem problem={lookup.problem} input={url} onRetry={() => void lookup.run(url)} />}
      </div>
    </div>
  );
}
