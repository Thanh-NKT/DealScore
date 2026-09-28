"use client";

import { useEffect, useRef, useState } from "react";
import { ImageMissingIcon } from "@/components/ui/icons";

interface ProductGalleryProps {
  image?: string | null;
  alt: string;
  brand?: string | null;
  model?: string | null;
  warranty?: string | null;
  /** productGallery(): main image first, then matched listings' CDN images (deduplicated, ≤ 8). */
  galleryImages?: string[];
}

export function ProductGallery({
  image,
  alt,
  warranty,
  galleryImages = [],
}: ProductGalleryProps) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const images = (galleryImages.length > 0 ? galleryImages : image ? [image] : []).filter((src) => !failed.has(src));
  const [selectedIdx, setSelectedIdx] = useState(0);

  const markFailed = (src: string) => {
    setFailed((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
    setSelectedIdx(0);
  };

  const safeIdx = images.length > 0 ? Math.min(selectedIdx, images.length - 1) : 0;
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the selected thumbnail in view when the main-image arrows move past the visible strip.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children[safeIdx] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: left - 8, behavior: "smooth" });
    }
  }, [safeIdx]);

  const scrollStrip = (dir: -1 | 1) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: "smooth" });
  };
  const activeSrc = images[safeIdx] ?? images[0] ?? null;

  const prevImage = () => {
    if (images.length <= 1) return;
    setSelectedIdx((i) => (i <= 0 ? images.length - 1 : i - 1));
  };

  const nextImage = () => {
    if (images.length <= 1) return;
    setSelectedIdx((i) => (i + 1) % images.length);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/*
        Main image stage. It stretches to the height of the decision column beside it (flex-1), so a
        product with a single image leaves no empty band; the min heights keep it right on phones.
      */}
      <div className="group relative min-h-[320px] w-full flex-1 overflow-hidden rounded-frame border border-line/80 bg-surface-2/45 sm:min-h-[380px]">
        {activeSrc ? (
          <div className="absolute inset-6 flex items-center justify-center sm:inset-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeSrc}
              alt={alt}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => markFailed(activeSrc)}
              className="max-h-full max-w-full min-h-0 min-w-0 h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.03]"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageMissingIcon className="size-24 text-ink-3/50" />
          </div>
        )}

        {warranty && (
          <span className="absolute left-3.5 top-3.5 z-10 rounded-full border border-line/80 bg-surface/92 px-3 py-1 text-micro font-semibold text-ink-2 backdrop-blur-md shadow-2xs">
            {warranty}
          </span>
        )}

        {images.length > 1 && (
          <span className="num absolute right-3.5 top-3.5 z-10 rounded-full border border-line/80 bg-surface/90 px-2.5 py-1 text-nano font-bold text-ink-2 backdrop-blur-md shadow-2xs">
            {safeIdx + 1} / {images.length}
          </span>
        )}

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={prevImage}
              aria-label="Ảnh trước"
              className="absolute left-3 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-ink opacity-0 shadow-xs backdrop-blur-xs transition-all hover:bg-surface group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={nextImage}
              aria-label="Ảnh tiếp theo"
              className="absolute right-3 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-ink opacity-0 shadow-xs backdrop-blur-xs transition-all hover:bg-surface group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip (like the marketplace galleries): every image, scrolls sideways, arrows when it overflows. */}
      {images.length > 1 && (
        <div className="flex items-center gap-1.5">
          {images.length > 5 && (
            <button
              type="button"
              onClick={() => scrollStrip(-1)}
              aria-label="Xem các ảnh trước"
              className="hidden size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink sm:flex cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          <div
            ref={stripRef}
            role="group"
            aria-label={`Ảnh sản phẩm (${images.length})`}
            className="flex min-w-0 flex-1 snap-x gap-2.5 overflow-x-auto scroll-smooth py-0.5 [scrollbar-width:none]"
          >
            {images.map((src, idx) => {
              const isSelected = safeIdx === idx;
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  aria-label={`Xem ảnh ${idx + 1} trên ${images.length}`}
                  aria-pressed={isSelected}
                  className={`relative size-16 shrink-0 snap-start overflow-hidden rounded-inner transition-all cursor-pointer sm:size-[72px] ${
                    isSelected
                      ? "border-2 border-primary bg-surface"
                      : "border border-line bg-surface-2/50 opacity-75 hover:border-line-strong hover:opacity-100"
                  }`}
                >
                  <span className="absolute inset-1.5 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => markFailed(src)}
                      className="max-h-full max-w-full min-h-0 min-w-0 h-full w-full object-contain"
                    />
                  </span>
                </button>
              );
            })}
          </div>
          {images.length > 5 && (
            <button
              type="button"
              onClick={() => scrollStrip(1)}
              aria-label="Xem các ảnh tiếp theo"
              className="hidden size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink sm:flex cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
