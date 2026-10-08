import { describe, expect, it } from "vitest";
import { isStrictLocalUrl } from "../../scripts/guard-env";

describe("isStrictLocalUrl (seed:p4 guard, same rule as tests/db/helpers.ts)", () => {
  it.each([
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321/", true],
    ["https://abc.supabase.co", false],
    ["http://host.docker.internal:54321", false],
    ["http://127.0.0.1.evil.com", false],
    ["", false],
  ])("%s → %s", (url, ok) => {
    expect(isStrictLocalUrl(url)).toBe(ok);
  });
});
