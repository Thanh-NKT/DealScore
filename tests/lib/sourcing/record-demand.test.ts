import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async (..._args: unknown[]) => ({ data: 1, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const configured = vi.fn((): string[] => ["shopee", "tiktok"]);
vi.mock("@/lib/marketplaces/sources", () => ({ configuredMarketplaces: () => configured() }));

const { recordSearchDemand } = await import("@/lib/sourcing/record-demand");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("recordSearchDemand", () => {
  it("calls the RPC with the cleaned keyword, marketplaces and cap", async () => {
    await recordSearchDemand({ q: "tai nghe sony", total: 1, page: 1, intent: { text: "", brands: ["Sony"], categoryName: "Tai nghe" } });
    expect(rpc).toHaveBeenCalledWith("request_sourcing_query", { p_value: "sony tai nghe", p_marketplaces: ["shopee", "tiktok"], p_daily_cap: 100 });
  });

  it("does nothing with enough results, junk, no marketplace, or cap 0", async () => {
    await recordSearchDemand({ q: "tai nghe", total: 5, page: 1 });
    await recordSearchDemand({ q: "0912345678", total: 0, page: 1 });
    configured.mockReturnValueOnce([]);
    await recordSearchDemand({ q: "tai nghe", total: 0, page: 1 });
    vi.stubEnv("SOURCING_DEMAND_DAILY_CAP", "0");
    await recordSearchDemand({ q: "tai nghe", total: 0, page: 1 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    rpc.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordSearchDemand({ q: "tai nghe", total: 0, page: 1 })).resolves.toBeUndefined();
  });
});
