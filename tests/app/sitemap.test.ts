import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "order"]) q[m] = () => q;
      q.range = async () => ({ data: null, error: { message: "db down" } });
      return q;
    },
  }),
}));

const { default: sitemap } = await import("@/app/sitemap");

afterEach(() => {
  delete process.env.NEXT_PHASE;
});

describe("sitemap", () => {
  it("a DB error at runtime throws, so ISR keeps the last good sitemap", async () => {
    await expect(sitemap()).rejects.toThrow(/db down/);
  });

  it("during the build it falls back to the core routes", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const out = await sitemap();
    expect(out.length).toBeGreaterThan(0);
  });
});
