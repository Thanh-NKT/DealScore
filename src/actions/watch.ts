"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  createFolderForUser,
  deleteFolderForUser,
  moveWatchForUser,
  renameFolderForUser,
  saveWatchForUser,
  type FolderActionResult,
  type WatchActionResult,
} from "@/lib/watch/queries";
import { trackAfter } from "@/lib/analytics/track";

export type { FolderActionResult, WatchActionResult } from "@/lib/watch/queries";

export async function saveWatch(
  prev: WatchActionResult,
  form: FormData,
): Promise<WatchActionResult> {
  const rawPath = form.get("path") as string | null;
  const path = safeNextPath(rawPath, "/");

  const user = await requireUser({ path });

  const result = await saveWatchForUser(await createClient(), user.id, form);
  if (result.status !== "saved") return result;
  if (result.created) {
    trackAfter("watch_created", {
      userId: user.id,
      props: { variant_id: result.variantId, condition_count: result.conditionCount },
    });
  }

  revalidatePath(path);
  revalidatePath("/account/watch");

  return result;
}

export async function setWatchStatus(
  watchId: string,
  status: "active" | "paused" | "done",
): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("watches")
    .update({ status })
    .eq("id", watchId)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    if (error.code === "P0050") {
      throw new Error(
        "Đã đạt giới hạn 50 Watch đang hoạt động. Vui lòng tạm dừng bớt sản phẩm khác.",
      );
    }
    throw new Error(`Failed to update Watch status: ${error.message}`);
  }

  if (!data || data.length === 0) {
    notFound();
  }

  revalidatePath("/account/watch");
}

export async function deleteWatch(watchId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("watches")
    .delete()
    .eq("id", watchId)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    throw new Error(`Failed to delete Watch: ${error.message}`);
  }

  if (!data || data.length === 0) {
    notFound();
  }

  trackAfter("watch_deleted", { userId: user.id });
  revalidatePath("/account/watch");
}

// Folder actions. Identity always comes from the session (requireUser → getUser), never from arguments;
// every query is also filtered by user.id on top of RLS.

const INVALID_INPUT: FolderActionResult = { status: "error", error: "Dữ liệu không hợp lệ." };

export async function createFolder(name: string): Promise<FolderActionResult> {
  const user = await requireUser({ path: "/account/watch" });
  const result = await createFolderForUser(await createClient(), user.id, name);
  if (result.status === "ok") revalidatePath("/account/watch");
  return result;
}

export async function renameFolder(folderId: string, name: string): Promise<FolderActionResult> {
  const user = await requireUser({ path: "/account/watch" });
  if (typeof folderId !== "string") return INVALID_INPUT;
  const result = await renameFolderForUser(await createClient(), user.id, folderId, name);
  if (result.status === "ok") revalidatePath("/account/watch");
  return result;
}

export async function deleteFolder(folderId: string): Promise<FolderActionResult> {
  const user = await requireUser({ path: "/account/watch" });
  if (typeof folderId !== "string") return INVALID_INPUT;
  const result = await deleteFolderForUser(await createClient(), user.id, folderId);
  if (result.status === "ok") revalidatePath("/account/watch");
  return result;
}

export async function moveWatchToFolder(
  watchId: string,
  folderId: string | null,
): Promise<FolderActionResult> {
  const user = await requireUser({ path: "/account/watch" });
  if (typeof watchId !== "string" || (folderId !== null && typeof folderId !== "string")) return INVALID_INPUT;
  const result = await moveWatchForUser(await createClient(), user.id, watchId, folderId);
  if (result.status === "ok") revalidatePath("/account/watch");
  return result;
}
