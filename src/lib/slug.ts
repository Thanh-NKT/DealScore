/**
 * Vietnamese-friendly URL slug generation with collision handling.
 */

/**
 * Strip Vietnamese diacritics, lowercase, replace whitespace/odd characters with '-', collapse repeated '-'.
 */
export function slugify(input: string, maxLength?: number): string {
  let str = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .replace(/[đĐ]/g, "d") // đ/Đ -> d
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // odd characters -> '-'
    .replace(/^-+|-+$/g, ""); // trim leading and trailing '-'

  if (maxLength && maxLength > 0 && str.length > maxLength) {
    str = str.slice(0, maxLength).replace(/-+$/, "");
  }

  return str || "san-pham";
}

/**
 * Generate an unused slug. `exists` returns true if the slug already exists in the DB.
 * On collision append -2, -3, … until one is free.
 */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const cleanBase = slugify(base);
  if (!(await exists(cleanBase))) {
    return cleanBase;
  }

  let counter = 2;
  while (counter < 1000) {
    const candidate = `${cleanBase}-${counter}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
    counter++;
  }

  return `${cleanBase}-${Date.now()}`;
}
