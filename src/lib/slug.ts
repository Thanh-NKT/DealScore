/**
 * Xử lý tạo slug URL thân thiện với tiếng Việt và chống trùng lặp.
 */

/**
 * Bỏ dấu tiếng Việt, lowercase, thay khoảng trắng/ký tự lạ bằng '-', gộp '-' liền nhau.
 */
export function slugify(input: string, maxLength?: number): string {
  let str = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Bỏ dấu tổ hợp
    .replace(/[đĐ]/g, "d") // đ/Đ -> d
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // Ký tự lạ -> '-'
    .replace(/^-+|-+$/g, ""); // Cắt '-' ở đầu và cuối

  if (maxLength && maxLength > 0 && str.length > maxLength) {
    str = str.slice(0, maxLength).replace(/-+$/, "");
  }

  return str || "san-pham";
}

/**
 * Sinh slug chưa trùng. `exists` trả true nếu slug đã tồn tại trong DB.
 * Trùng thì thêm hậu tố -2, -3, … cho tới khi trống.
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
