"use client";

import { useState } from "react";
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
    <div className="flex flex-col gap-3">
      {/* Main Image Stage: strictly bounded box so tall/large images scale down to fit without cropping */}
      <div className="group relative h-[320px] w-full overflow-hidden rounded-[16px] border border-line/80 bg-surface-2/45 sm:h-[380px]">
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
          <span className="absolute left-3.5 top-3.5 z-10 rounded-full border border-line/80 bg-surface/92 px-3 py-1 text-[12px] font-semibold text-ink-2 backdrop-blur-md shadow-2xs">
            {warranty}
          </span>
        )}

        {images.length > 1 && (
          <span className="num absolute right-3.5 top-3.5 z-10 rounded-full border border-line/80 bg-surface/90 px-2.5 py-1 text-[11px] font-bold text-ink-2 backdrop-blur-md shadow-2xs">
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

      {/* Thumbnails Row */}
      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-6">
          {images.slice(0, 6).map((src, idx) => {
            const isSelected = safeIdx === idx;
            return (
              <button
                key={src}
                type="button"
                onClick={() => setSelectedIdx(idx)}
                aria-label={`Xem ảnh ${idx + 1}`}
                aria-pressed={isSelected}
                className={`relative aspect-square overflow-hidden rounded-[10px] bg-surface-2/50 transition-all cursor-pointer ${
                  isSelected
                    ? "border-2 border-primary bg-surface ring-2 ring-primary/15"
                    : "border border-line opacity-75 hover:border-line-strong hover:opacity-100"
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
      )}
    </div>
  );
}
