import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { admin, SUPABASE_URL } from "./helpers";

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

// Admin RPCs added after privilege_report was written: called as anon they must be refused outright
// (permission denied, not a business error from inside the function).
const SERVICE_ONLY_RPCS: [string, Record<string, unknown>][] = [
  ["admin_list_products", {}],
  ["admin_create_product", { p: {} }],
  ["admin_update_product", { p_product_id: "00000000-0000-4000-8000-000000000000", p: {} }],
];

describe("service-role-only admin RPCs", () => {
  const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  it.each(SERVICE_ONLY_RPCS)("%s refuses anon", async (fn, args) => {
    const { error } = await anon.rpc(fn as never, args as never);
    expect(error?.code).toBe("42501");
  });
});
