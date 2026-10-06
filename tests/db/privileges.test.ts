import { describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Catalog-wide privilege guard (review-db M17). privilege_report() lists every public table anon /
// authenticated can write and every SECURITY DEFINER function they can execute. A new entry must be added
// here on purpose, together with its RLS policy or its own access checks.
const AUTHENTICATED_WRITABLE = [
  "notification_settings",
  "push_subscriptions",
  "user_preferences",
  "users",
  "watch_folders",
  "watches",
];
const PUBLIC_DEFINER_FUNCTIONS = ["trending_products(text,integer,uuid)"];

describe("privilege_report", () => {
  it("anon writes nothing; authenticated writes only RLS-protected user tables; definer RPCs are service-only", async () => {
    const { data, error } = await admin.rpc("privilege_report");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows.filter((r) => r.kind === "table_write" && r.grantee === "anon")).toEqual([]);
    expect(rows.filter((r) => r.kind === "table_write" && r.grantee === "authenticated").map((r) => r.object).sort())
      .toEqual(AUTHENTICATED_WRITABLE);
    for (const grantee of ["anon", "authenticated"]) {
      expect(rows.filter((r) => r.kind === "definer_execute" && r.grantee === grantee).map((r) => r.object).sort())
        .toEqual(PUBLIC_DEFINER_FUNCTIONS);
    }
  });
});
