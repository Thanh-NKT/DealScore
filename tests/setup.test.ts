import { describe, expect, it } from "vitest";
import { MIN_DAYS_FOR_SCORE, RECOMMENDATION_LABEL } from "@/lib/pricing/deal-score";

/**
 * Smoke test: proves the "@/" alias resolves to src/.
 * If this is red, every other test goes red for reasons unrelated to their code.
 */
describe("vitest configuration", () => {
  it("resolves the @/ alias to src/", () => {
    expect(MIN_DAYS_FOR_SCORE).toBe(14);
  });

  it("imports constants from deal-score", () => {
    expect(RECOMMENDATION_LABEL.buy).toContain("Nên mua");
  });
});
