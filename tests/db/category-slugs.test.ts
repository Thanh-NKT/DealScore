import { describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Final review Minor 7 (0072): top-level route slugs cannot become categories.
describe("categories_slug_reserved", () => {
  it.each(["compare", "radar", "trending", "wishlist", "extension", "dang-nhap", "huy-dang-ky", "shared"])(
    "%s is refused",
    async (slug) => {
      const { error } = await admin.from("categories").insert({ name: `Test ${slug}`, slug });
      expect(error?.code).toBe("23514");
    },
  );
});
