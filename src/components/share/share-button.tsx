"use client";

import { useEffect, useId, useRef, useState } from "react";
import { recordShare } from "@/actions/share";
import { CheckIcon, ShareIcon } from "@/components/ui/icons";

interface ShareButtonProps {
  productId: string;
  url: string;
  title: string;
  text: string;
  className?: string;
  /** Render only the icon inside a square button (prevents text wrapping in compact action bars). */
  iconOnly?: boolean;
}

const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-surface px-4 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2 cursor-pointer";

type State = { kind: "idle" } | { kind: "copied" } | { kind: "manual" };

export function ShareButton({
  productId,
  url,
  title,
  text,
  className = SECONDARY,
  iconOnly = false,
}: ShareButtonProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  useEffect(() => {
    if (state.kind !== "copied") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 2500);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (state.kind === "manual") inputRef.current?.select();
  }, [state]);

  const onClick = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        void recordShare(productId, "native");
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState({ kind: "copied" });
      void recordShare(productId, "copy");
    } catch {
      setState({ kind: "manual" });
    }
  };

  const copied = state.kind === "copied";

  return (
    <div className="relative flex min-w-0 flex-col">
      <button
        type="button"
        onClick={onClick}
        aria-label={copied ? "Đã sao chép liên kết" : "Chia sẻ sản phẩm"}
        title={copied ? "Đã sao chép liên kết" : "Chia sẻ sản phẩm"}
        aria-describedby={`${uid}-status`}
        className={className}
      >
        {copied ? (
          <CheckIcon className="size-5 shrink-0 text-buy" strokeWidth={2.6} />
        ) : (
          <ShareIcon className="size-5 shrink-0" />
        )}
        {!iconOnly && <span className="whitespace-nowrap">{copied ? "Đã chép link" : "Chia sẻ"}</span>}
      </button>
      {!iconOnly && (
        <p id={`${uid}-status`} aria-live="polite" className="text-label leading-[1.45] text-ink-2 empty:hidden">
          {state.kind === "copied" ? "Đã sao chép liên kết." : state.kind === "manual" ? "Sao chép liên kết bên dưới:" : ""}
        </p>
      )}
      {iconOnly && (
        <span id={`${uid}-status`} aria-live="polite" className="sr-only">
          {state.kind === "copied" ? "Đã sao chép liên kết." : ""}
        </span>
      )}
      {state.kind === "manual" && (
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label="Liên kết chia sẻ"
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1.5 min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-label text-ink focus:border-primary focus:ring-1 focus:ring-primary focus-visible:outline-none"
        />
      )}
    </div>
  );
}
