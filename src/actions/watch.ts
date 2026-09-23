"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { saveWatchForUser, type WatchActionResult } from "@/lib/watch/queries";

export type { WatchActionResult } from "@/lib/watch/queries";

export async function saveWatch(
  prev: WatchActionResult,
  form: FormData,
): Promise<WatchActionResult> {
  const rawPath = form.get("path") as string | null;
  const path = safeNextPath(rawPath, "/");

  const user = await requireUser({ path });

  const result = await saveWatchForUser(await createClient(), user.id, form);
  if (result.status !== "saved") return result;

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
    throw new Error(`Lỗi cập nhật trạng thái Watch: ${error.message}`);
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
    throw new Error(`Lỗi xóa Watch: ${error.message}`);
  }

  if (!data || data.length === 0) {
    notFound();
  }

  revalidatePath("/account/watch");
}
