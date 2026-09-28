/**
 * Sample product images for dev seed data (served from public/samples/).
 * Real photos from Unsplash (Unsplash License: free to use, no attribution required), 800px wide,
 * generic per category — seed products are fictional, so no photo matches a specific model.
 * Aspect ratios differ (landscape keyboards, portrait mouse) to exercise the `object-contain`
 * square frame, and a few products get no image or a dead URL to exercise the ProductImage
 * fallback icon.
 *
 * Sources (images.unsplash.com/photo-<id>):
 *   ssd-1 1756836857608-16c9213c1d3c · ssd-2 1518547606470-00ac2ae882af · ssd-3 1756836857559-4c8161fe07f3
 *   ban-phim-1 1618384887929-16ec33fab9ef · ban-phim-2 1595044426077-d36d9236d54a · ban-phim-3 1589578228447-e1a4e481c6c8
 *   chuot-1 1527864550417-7fd91fc51a46 · chuot-2 1615663245857-ac93bb7c39e7 · chuot-3 1527814050087-3793815479db
 *   man-hinh-1 1547658718-1cdaa0852790 · man-hinh-2 1666771410140-0573b232426e · man-hinh-3 1570485071395-29b575ea3b4e
 *   tai-nghe-1 1505740420928-5e560c06d30e · tai-nghe-2 1618366712010-f4ae9c647dcb · tai-nghe-3 1583394838336-acd977736f90
 *   ram-1 1541029071515-84cc54f84dc5 · ram-2 1676554565685-3aeb5d7ad1b7 · ram-3 1704026437278-77f1db74859c
 *   sac-du-phong-1 1566554738544-d962991c3fee
 *   webcam-1 1760348213920-d2a90ed705fd · webcam-2 1629429407756-446d66f5b24e
 */

/** Number of photos per category: public/samples/{slug}-1.jpg … {slug}-{n}.jpg. */
const CATEGORY_IMAGE_COUNT: Record<string, number> = {
  ssd: 3,
  "ban-phim": 3,
  chuot: 3,
  "man-hinh": 3,
  "tai-nghe": 3,
  ram: 3,
  "sac-du-phong": 1,
  webcam: 2,
};

/** Deliberately broken — must render the fallback icon, never a broken-image glyph. */
const DEAD_IMAGE = "/samples/does-not-exist.png";

/** Image for the product at `index` in category `categorySlug`. */
export function sampleImageFor(categorySlug: string, index: number): string | null {
  if (index % 12 === 5) return null;
  if (index % 12 === 11) return DEAD_IMAGE;
  const count = CATEGORY_IMAGE_COUNT[categorySlug];
  if (!count) return null;
  return `/samples/${categorySlug}-${(index % count) + 1}.jpg`;
}
