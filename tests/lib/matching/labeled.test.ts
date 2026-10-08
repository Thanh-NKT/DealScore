import { describe, expect, it } from "vitest";
import { AUTO_MATCH_THRESHOLD, bestMatch } from "@/lib/matching/match";
import { CATALOG, LABELED } from "./fixtures";

/**
 * Hand-labeled listings vs a small catalog. The G2 gate is "matching ≥ 95%": for auto-attach the
 * bar here is stricter — ZERO wrong auto matches on this set. Recall (how many right answers clear
 * the auto threshold) is reported and must not regress below the floor.
 */

const RECALL_FLOOR = 0.8;

describe("matching — labeled set", () => {
  const results = LABELED.map((l) => {
    const m = bestMatch({ title: l.title, modelName: l.model, gtin: l.gtin }, CATALOG);
    const auto = m != null && m.confidence >= AUTO_MATCH_THRESHOLD ? m.variantId : null;
    return { ...l, auto, m };
  });

  it("never auto-matches the wrong variant (precision 100%)", () => {
    const wrong = results.filter((r) => r.auto != null && r.auto !== r.expect);
    expect(wrong.map((r) => `${r.title} [${r.model}] → ${r.auto}`)).toEqual([]);
  });

  it(`auto-matches at least ${RECALL_FLOOR * 100}% of the matchable listings`, () => {
    const matchable = results.filter((r) => r.expect != null);
    const hit = matchable.filter((r) => r.auto === r.expect);
    const recall = hit.length / matchable.length;
    console.info(`matching recall: ${hit.length}/${matchable.length}`);
    const missed = matchable.filter((r) => r.auto !== r.expect).map((r) => `${r.title} [${r.model}] (${r.m?.confidence ?? 0})`);
    expect({ recall: recall >= RECALL_FLOOR, missed }).toMatchObject({ recall: true });
  });
});
