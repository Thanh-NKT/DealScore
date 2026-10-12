"use client";

import { useCallback, useState } from "react";
import { ImageMissingIcon } from "@/components/ui/icons";

interface ProductImageProps {
  src: string | null | undefined;
  /** Frame padding / layout class; the image is inset by the same amount. */
  className?: string;
  iconClassName?: string;
  imgClassName?: string;
}

/**
 * Uncropped product image: `object-contain` inside a `surface-2` frame.
 * Uses explicit `minmax(0,1fr)` grid tracks and `min-h-0 min-w-0 max-h-full max-w-full`
 * so tall or large marketplace images always scale down to fit the frame without clipping.
 */
export function ProductImage({
  src,
  className = "aspect-square p-3",
  iconClassName = "size-10",
  imgClassName = "",
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // A server-rendered image can fail before hydration, when React is not listening for onError yet:
  // catch that case when the element is attached, or the browser's broken-image frame stays on screen.
  const checkLoaded = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && img.currentSrc) setFailedSrc(img.getAttribute("src"));
    },
    [],
  );
  const url = src?.trim() || null;
  const showImage = url != null && failedSrc !== url;
  const hasExplicitSize = /\b(size-|h-|aspect-)/.test(className);

  return (
    <div
      className={`relative grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center overflow-hidden bg-surface-2 ${
        hasExplicitSize ? "" : "aspect-square"
      } ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={checkLoaded}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(url)}
          className={`max-h-full max-w-full min-h-0 min-w-0 size-full object-contain ${imgClassName}`}
        />
      ) : (
        <ImageMissingIcon className={`text-ink-3 ${iconClassName}`} />
      )}
    </div>
  );
}
