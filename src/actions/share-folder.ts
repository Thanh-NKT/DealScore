"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { newShareToken, shareFolderUrl } from "@/lib/share-folder/token";
import { shareSettingsRow, validateShareSettings, type ShareSettingsErrors } from "@/lib/share-folder/validate";
import { siteUrl } from "@/lib/site-url";
import { trackAfter } from "@/lib/analytics/track";

export type ShareFolderResult =
  | { ok: true; url?: string }
  | { ok: false; error: "unauthenticated" | "not_found" | "invalid" | "unavailable"; fieldErrors?: ShareSettingsErrors };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The folder exists and is the caller's (read through RLS, filtered by user_id). */
async function ownFolder(folderId: string, userId: string): Promise<boolean | null> {
  if (typeof folderId !== "string" || !UUID_RE.test(folderId)) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.from("watch_folders").select("id").eq("id", folderId).eq("user_id", userId).maybeSingle();
  if (error) return null;
  return data != null;
}

/**
 * Create the public link of a folder (roadmap P4 J). The 256-bit token is made here, never by the browser;
 * the row is written with the admin client (authenticated has no insert grant). Already shared → existing link.
 */
export async function shareFolder(folderId: string, settings: unknown): Promise<ShareFolderResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  const v = validateShareSettings(settings);
  if (!v.ok) return { ok: false, error: "invalid", fieldErrors: v.errors };
  const own = await ownFolder(folderId, user.id);
  if (own === null) return { ok: false, error: "unavailable" };
  if (!own) return { ok: false, error: "not_found" };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("watch_folder_shares").select("token").eq("folder_id", folderId).eq("user_id", user.id).maybeSingle();
  if (existing) return { ok: true, url: shareFolderUrl(siteUrl(), existing.token) };
  const token = newShareToken();
  const { error } = await admin.from("watch_folder_shares").insert({ folder_id: folderId, user_id: user.id, token, ...shareSettingsRow(v.value) });
  if (error) return { ok: false, error: "unavailable" };
  trackAfter("folder_shared", { userId: user.id });
  revalidatePath("/account/watch");
  return { ok: true, url: shareFolderUrl(siteUrl(), token) };
}

/** Change what the public page shows (user's RLS client; the token column is not updatable by them). */
export async function updateFolderShare(folderId: string, settings: unknown): Promise<ShareFolderResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  const v = validateShareSettings(settings);
  if (!v.ok) return { ok: false, error: "invalid", fieldErrors: v.errors };
  if (typeof folderId !== "string" || !UUID_RE.test(folderId)) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("watch_folder_shares")
    .update(shareSettingsRow(v.value))
    .eq("folder_id", folderId)
    .eq("user_id", user.id)
    .select("token");
  if (error) return { ok: false, error: "unavailable" };
  if (!data || data.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/account/watch");
  return { ok: true, url: shareFolderUrl(siteUrl(), data[0].token) };
}

/** New link; the old one stops working immediately. */
export async function rotateFolderShare(folderId: string): Promise<ShareFolderResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  if (typeof folderId !== "string" || !UUID_RE.test(folderId)) return { ok: false, error: "not_found" };
  const token = newShareToken();
  const { data, error } = await createAdminClient()
    .from("watch_folder_shares")
    .update({ token })
    .eq("folder_id", folderId)
    .eq("user_id", user.id)
    .select("id");
  if (error) return { ok: false, error: "unavailable" };
  if (!data || data.length === 0) return { ok: false, error: "not_found" };
  revalidatePath("/account/watch");
  return { ok: true, url: shareFolderUrl(siteUrl(), token) };
}

/** Stop sharing = delete the row (RLS). */
export async function unshareFolder(folderId: string): Promise<ShareFolderResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return { ok: false, error: "unauthenticated" };
  if (typeof folderId !== "string" || !UUID_RE.test(folderId)) return { ok: false, error: "not_found" };
  const supabase = await createClient();
  const { error } = await supabase.from("watch_folder_shares").delete().eq("folder_id", folderId).eq("user_id", user.id);
  if (error) return { ok: false, error: "unavailable" };
  revalidatePath("/account/watch");
  return { ok: true };
}
