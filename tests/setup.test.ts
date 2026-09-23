import { describe, expect, it } from "vitest";
import { MIN_DAYS_FOR_SCORE, RECOMMENDATION_LABEL } from "@/lib/pricing/deal-score";

/**
 * Test khói: chứng minh alias "@/" phân giải được tới src/.
 * Nếu test này đỏ thì mọi test khác sẽ đỏ vì lý do không liên quan tới code của chúng.
 */
describe("cấu hình vitest", () => {
  it("phân giải được alias @/ tới src/", () => {
    expect(MIN_DAYS_FOR_SCORE).toBe(14);
  });

  it("import được hằng số từ deal-score", () => {
    expect(RECOMMENDATION_LABEL.buy).toContain("Nên mua");
  });
});
