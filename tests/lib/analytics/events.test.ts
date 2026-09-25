import { describe, expect, it } from "vitest";
import { EVENT_NAMES, isEventName, sanitizeProps } from "@/lib/analytics/events";

const UUID = "0b9d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c4";

describe("event names", () => {
  it("match the DB check constraint list", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "login_succeeded",
        "lookup_submitted",
        "product_viewed",
        "push_enabled",
        "search_performed",
        "signup_completed",
        "watch_created",
        "watch_deleted",
        "deal_shared",
        "share_opened",
      ].sort(),
    );
  });
  it("isEventName rejects unknown names", () => {
    expect(isEventName("product_viewed")).toBe(true);
    expect(isEventName("page_view")).toBe(false);
  });
});

describe("sanitizeProps", () => {
  it("keeps allowed keys with the right types", () => {
    expect(
      sanitizeProps("product_viewed", { product_id: UUID, variant_id: UUID, recommendation: "buy", is_draft: false }),
    ).toEqual({ product_id: UUID, variant_id: UUID, recommendation: "buy", is_draft: false });
  });

  it("drops unknown keys — no free text can sneak in", () => {
    expect(sanitizeProps("search_performed", { has_query: true, q: "ssd samsung", email: "a@b.c" })).toEqual({
      has_query: true,
    });
  });

  it("drops values of the wrong type or outside the enum", () => {
    expect(
      sanitizeProps("product_viewed", { product_id: "not-a-uuid", recommendation: "maybe", is_draft: "no" }),
    ).toEqual({});
    expect(sanitizeProps("search_performed", { result_count: Number.NaN, page: 2 })).toEqual({ page: 2 });
  });

  it("returns {} for events without properties", () => {
    expect(sanitizeProps("login_succeeded", { anything: 1 })).toEqual({});
  });
});
