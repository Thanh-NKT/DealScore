"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseSearchParams, searchProductsWith } from "@/lib/search";
import { resolveSearchParams } from "@/lib/search/resolve-params";
import {
  canSaveSearch,
  defaultSavedSearchName,
  parseSavedParams,
  savedToSearchParams,
  toSavedParams,
  type SavedSearchParams,
} from "@/lib/saved-search/params";
import { SAVED_SEARCH_MATCH_CAP, SAVED_SEARCH_NAME_MAX } from "@/lib/saved-search/constants";
import { evaluateSavedSearches } from "@/lib/saved-search/evaluate";
import { trackAfter } from "@/lib/analytics/track";

export type SavedSearchResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "invalid"
        | "no_scope"
        | "no_condition"
        | "too_broad"
        | "limit"
        | "duplicate"
        | "unavailable";
    };

export type SavedSearchUpdateResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "not_found" | "invalid" | "no_condition" | "too_broad" | "duplicate" | "unavailable";
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanName(raw: unknown): string | null | "invalid" {
  if (raw == null) return null;
  if (typeof raw !== "string") return "invalid";
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return name.length > SAVED_SEARCH_NAME_MAX ? "invalid" : name;
}

function dbError(code: string | undefined): "limit" | "duplicate" | "invalid" | "unavailable" {
  if (code === "23505") return "duplicate";
  // the 10-row trigger raises check_violation; a params check failure is check_violation too, but params were
  // validated with the same rules first, so a 23514 here is the limit.
  if (code === "23514") return "limit";
  if (code === "22P02") return "invalid";
  return "unavailable";
}

/**
 * More than SAVED_SEARCH_MATCH_CAP matches today → "too_broad": the engine reads the whole match set on every
 * evaluation, and a set it cannot read in full could announce products that matched all along (P4 review I2).
 * Catalog data is public-read: the user's own client counts it.
 */
async function breadth(supabase: SupabaseClient<Database>, params: SavedSearchParams): Promise<"ok" | "too_broad" | "unavailable"> {
  try {
    const { total } = await searchProductsWith(supabase, savedToSearchParams(params), { limit: 1 });
    return total > SAVED_SEARCH_MATCH_CAP ? "too_broad" : "ok";
  } catch {
    return "unavailable";
  }
}

/**
 * Baseline at save time (P4 review I2): every product matching now is written as already known, right after
 * the response, instead of waiting for the next discovery run. Scoped to the one id the user's own insert or
 * update returned; failures only log (the cron baselines it on its next pass).
 */
function baselineAfter(id: string): void {
  after(async () => {
    try {
      await evaluateSavedSearches({ now: new Date(), ids: [id] });
    } catch (err) {
      console.error(`saved-search: baseline of ${id} failed:`, err instanceof Error ? err.message : err);
    }
  });
}

/**
 * "Lưu tìm kiếm" (roadmap P4 E). The params are recomputed on the server from the page's query string, with
 * the same intent step as /search (never preferences), and stored with the user's own RLS client.
 * `maxPrice` / `onlyBuy` come from the dialog's two conditions and override the URL's.
 */
export async function saveSearch(input: {
  query: string;
  name?: string;
  maxPrice?: number | null;
  onlyBuy?: boolean;
}): Promise<SavedSearchResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  if (typeof input?.query !== "string" || input.query.length > 2000) return { ok: false, error: "invalid" };

  let params: SavedSearchParams;
  try {
    const { params: searched } = await resolveSearchParams(parseSearchParams(new URLSearchParams(input.query)));
    params = toSavedParams(searched);
  } catch {
    return { ok: false, error: "unavailable" };
  }
  if (input.maxPrice !== undefined) {
    if (input.maxPrice === null) delete params.maxPrice;
    else if (Number.isFinite(input.maxPrice) && input.maxPrice > 0 && input.maxPrice <= 10_000_000_000) params.maxPrice = Math.round(input.maxPrice);
    else return { ok: false, error: "invalid" };
  }
  if (input.onlyBuy !== undefined) {
    if (input.onlyBuy) params.onlyBuy = true;
    else delete params.onlyBuy;
  }
  if (params.minPrice != null && params.maxPrice != null && params.minPrice > params.maxPrice) delete params.minPrice;
  const can = canSaveSearch(params);
  if (!can.ok) return { ok: false, error: can.reason };
  if (!parseSavedParams(params)) return { ok: false, error: "invalid" };

  const name = cleanName(input.name);
  if (name === "invalid") return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const wide = await breadth(supabase, params);
  if (wide !== "ok") return { ok: false, error: wide };
  const { data, error } = await supabase
    .from("saved_searches")
    .insert({ name: name ?? defaultSavedSearchName(params), params: params as never })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbError(error?.code) };
  baselineAfter(data.id);

  trackAfter("saved_search_created", {
    userId: user.id,
    props: { has_max_price: params.maxPrice != null, only_buy: params.onlyBuy === true },
  });
  revalidatePath("/account/searches");
  return { ok: true, id: data.id };
}

/** Rename, pause/resume, or change the two conditions. A params change re-baselines (DB trigger). */
export async function updateSavedSearch(
  id: string,
  patch: { name?: string; status?: "active" | "paused"; maxPrice?: number | null; onlyBuy?: boolean },
): Promise<SavedSearchUpdateResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from("saved_searches")
    .select("id, params")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: "unavailable" };
  if (!row) return { ok: false, error: "not_found" };

  const update: { name?: string; status?: string; params?: never } = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (name === "invalid" || name === null) return { ok: false, error: "invalid" };
    update.name = name;
  }
  if (patch.status !== undefined) {
    if (patch.status !== "active" && patch.status !== "paused") return { ok: false, error: "invalid" };
    update.status = patch.status;
  }
  if (patch.maxPrice !== undefined || patch.onlyBuy !== undefined) {
    const current = parseSavedParams(row.params);
    if (!current) return { ok: false, error: "invalid" };
    const next: SavedSearchParams = { ...current };
    if (patch.maxPrice === null) delete next.maxPrice;
    else if (patch.maxPrice !== undefined) {
      if (!Number.isFinite(patch.maxPrice) || patch.maxPrice <= 0) return { ok: false, error: "invalid" };
      next.maxPrice = Math.round(patch.maxPrice);
    }
    if (patch.onlyBuy === true) next.onlyBuy = true;
    else if (patch.onlyBuy === false) delete next.onlyBuy;
    if (next.minPrice != null && next.maxPrice != null && next.minPrice > next.maxPrice) delete next.minPrice;
    if (!canSaveSearch(next).ok) return { ok: false, error: "no_condition" };
    if (!parseSavedParams(next)) return { ok: false, error: "invalid" };
    const wide = await breadth(supabase, next);
    if (wide !== "ok") return { ok: false, error: wide };
    update.params = next as never;
  }
  if (Object.keys(update).length === 0) return { ok: true };
  const { error } = await supabase.from("saved_searches").update(update).eq("id", id).eq("user_id", user.id);
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate" : "unavailable" };
  // A params change re-baselines (the DB trigger nulls initialized_at and last_evaluated_at, 0070, so the row is
  // due): baseline the new params at once.
  if (update.params) baselineAfter(id);
  revalidatePath("/account/searches");
  return { ok: true };
}

export async function deleteSavedSearch(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser().catch(() => null);
  if (!user || typeof id !== "string" || !UUID_RE.test(id)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("saved_searches").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/account/searches");
  return { ok: !error };
}
