import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { parseSavedParams, type SavedSearchParams } from "@/lib/saved-search/params";

export interface MySavedSearch {
  id: string;
  name: string;
  params: SavedSearchParams;
  status: "active" | "paused";
  lastAlertedAt: string | null;
  createdAt: string;
  /** Newest alert of this search (alert_events.created_at), null when none yet. */
  latestEventAt: string | null;
}

/** The signed-in user's saved searches (≤ 10), newest first, through RLS. */
export async function listMySavedSearches(userId: string, client?: SupabaseClient<Database>): Promise<MySavedSearch[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("saved_searches")
    .select("id, name, params, status, last_alerted_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load saved searches: ${error.message}`);
  const rows = data ?? [];
  const latest = new Map<string, string>();
  if (rows.length > 0) {
    // ≤ 10 searches; alerts are ≤ 1/day each and pruned with the search — newest per id from a bounded read.
    const { data: ev, error: evErr } = await supabase
      .from("alert_events")
      .select("saved_search_id, created_at")
      .in("saved_search_id", rows.map((r) => r.id))
      .order("created_at", { ascending: false })
      .limit(500);
    if (evErr) throw new Error(`Failed to load saved search alerts: ${evErr.message}`);
    for (const e of ev ?? []) if (e.saved_search_id && !latest.has(e.saved_search_id)) latest.set(e.saved_search_id, e.created_at);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    params: parseSavedParams(r.params) ?? {},
    status: r.status === "paused" ? "paused" : "active",
    lastAlertedAt: r.last_alerted_at,
    createdAt: r.created_at,
    latestEventAt: latest.get(r.id) ?? null,
  }));
}
