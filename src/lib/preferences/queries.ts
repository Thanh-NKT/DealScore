import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_PREFERENCES, normalizePreferences, type Preferences } from "@/lib/preferences";

type Client = SupabaseClient<Database>;

export interface PreferenceCategory {
  id: string;
  slug: string;
  name: string;
}

/** The user's saved preferences (RLS client), or empty ones when there is no row yet. Throws on DB errors. */
export async function getPreferencesForUser(client: Client, userId: string): Promise<Preferences> {
  const { data, error } = await client
    .from("user_preferences")
    .select("brands, excluded_brands, category_ids, min_price, max_price, marketplaces")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read user preferences: ${error.message}`);
  return data ? normalizePreferences(data) : { ...EMPTY_PREFERENCES };
}

/** Signed-out → null. Identity always comes from the session (`getUser()`). */
export async function getMyPreferences(): Promise<Preferences | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  return getPreferencesForUser(client, user.id);
}

/**
 * Upserts the form's fields for `userId` (which the caller took from the session). `excluded_brands`
 * is not on the form and is left as stored. `updated_at` is set here: the column has no update trigger.
 */
export async function savePreferencesForUser(
  client: Client,
  userId: string,
  p: Preferences,
): Promise<{ error: { message: string } | null }> {
  const { error } = await client.from("user_preferences").upsert(
    {
      user_id: userId,
      brands: p.brands,
      category_ids: p.categoryIds,
      min_price: p.minPrice,
      max_price: p.maxPrice,
      marketplaces: p.marketplaces,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return { error };
}

/** Catalog categories with ids (the form stores ids; intent_vocab only has slugs). Public read. */
export async function getPreferenceCategories(client: Client): Promise<PreferenceCategory[]> {
  const { data, error } = await client
    .from("categories")
    .select("id, slug, name")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to read categories: ${error.message}`);
  return data ?? [];
}
