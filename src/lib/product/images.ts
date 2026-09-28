/**
 * Product images (spec 2026-09-26 §5). Pure. Image URLs come from the marketplace API or from the
 * Chrome extension (untrusted page content), so only https URLs on the marketplace's own CDN pass.
 */
import { isAllowedImageHost } from "@/lib/marketplaces";

/** Matches the `listings_images_max` check constraint. */
export const MAX_LISTING_IMAGES = 12;
export const MAX_GALLERY_IMAGES = 8;
const MAX_URL_LENGTH = 1000;

/** Keep https URLs on the marketplace's CDN allow-list: no credentials, no ports, deduplicated, capped. */
export function sanitizeImageUrls(urls: unknown, marketplace: string, max = MAX_LISTING_IMAGES): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    if (out.length >= max) break;
    if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) continue;
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
    if (!isAllowedImageHost(marketplace, url.hostname)) continue;
    url.hash = "";
    const clean = url.toString();
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/**
 * Gallery for the product page: the product's main image first, then each listing's images in
 * order, without duplicates, at most MAX_GALLERY_IMAGES. Listing images are re-checked against the
 * allow-list; the main image is catalog data and is kept as is.
 */
export function productGallery(
  mainImage: string | null | undefined,
  listings: ReadonlyArray<{ marketplace: string; images: readonly string[] | null | undefined }>,
  max = MAX_GALLERY_IMAGES,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    if (out.length < max && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };
  if (mainImage) add(mainImage);
  for (const l of listings) {
    for (const u of sanitizeImageUrls(l.images ?? [], l.marketplace)) add(u);
  }
  return out;
}
