import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { parseWatchForm, type WatchField } from "@/lib/watch/form";

type Client = SupabaseClient<Database>;

export type WatchActionResult =
  | { status: "idle" }
  | { status: "saved"; watchId: string; created: boolean; variantId: string; conditionCount: number }
  | { status: "error"; errors: Partial<Record<WatchField, string>> };
import { fromRow, DEFAULT_NOTIFICATION_SETTINGS, type Channel } from "@/lib/account/notification-settings";
import { describeWatch, type LatestAlert, type WatchView } from "@/lib/watch/describe";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import type { ConditionKey, WatchConfig, WatchState } from "@/lib/watch/types";
import {
  MAX_FOLDERS,
  nextSortOrder,
  sortFolders,
  validateFolderName,
  type WatchFolder,
} from "@/lib/watch/folders";

export interface MyWatchItem {
  id: string;
  status: "active" | "paused" | "done";
  product: {
    slug: string;
    categorySlug: string;
    name: string;
    image: string | null;
  };
  variant: {
    id: string;
    key: string;
  };
  config: WatchConfig;
  view: WatchView;
  createdAt: string;
  /** null = not filed in any folder. */
  folderId: string | null;
}

/** `client` is injectable so tests can use a real DB; defaults to the server client (RLS). */
export async function listMyWatches(
  userId: string,
  now: Date,
  client?: Client,
): Promise<MyWatchItem[]> {
  const supabase = client ?? (await createClient());

  // 1. Load the user's watches with product_variants, products, categories
  const { data: watchRows, error: watchError } = await supabase
    .from("watches")
    .select(
      `
      id, status, variant_id, target_price, drop_pct, notify_low, min_deal_score,
      notify_back_in_stock, channels, baseline_price, cond_state, last_alert_price,
      last_alerted_at, last_in_stock, created_at, folder_id,
      product_variants!inner (
        id,
        variant_key,
        product:products!inner (
          id,
          slug,
          canonical_name,
          image,
          category:categories (
            slug
          )
        )
      )
    `,
    )
    .eq("user_id", userId);

  if (watchError) {
    throw new Error(`Failed to load Watch list: ${watchError.message}`);
  }

  if (!watchRows || watchRows.length === 0) {
    return [];
  }

  // 2. Load the user's notification settings
  const { data: settingsRow, error: settingsError } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (settingsError) throw new Error(`Failed to load notification settings: ${settingsError.message}`);

  const settings = settingsRow ? fromRow(settingsRow) : DEFAULT_NOTIFICATION_SETTINGS;

  // 3. Load snapshots for the variantIds
  const variantIds = Array.from(new Set(watchRows.map((w) => w.variant_id)));
  const snapshotMap = await loadVariantSnapshots(supabase, variantIds, now);

  // 4. Load the latest alert per watch (with deliveries)
  const watchIds = watchRows.map((w) => w.id);
  const { data: alertRows, error: alertError } = await supabase
    .from("alert_events")
    .select(
      `
      id, watch_id, created_at, deliver_after,
      alert_deliveries (
        channel, status, sent_at
      )
    `,
    )
    .in("watch_id", watchIds)
    .order("created_at", { ascending: false });
  if (alertError) throw new Error(`Failed to load alerts: ${alertError.message}`);

  const latestAlertByWatch = new Map<string, LatestAlert>();
  for (const a of alertRows ?? []) {
    if (!latestAlertByWatch.has(a.watch_id)) {
      latestAlertByWatch.set(a.watch_id, {
        id: a.id,
        createdAt: a.created_at,
        deliverAfter: a.deliver_after,
        deliveries: (a.alert_deliveries ?? []).map((d) => ({
          channel: d.channel as Channel,
          status: d.status,
          sentAt: d.sent_at,
        })),
      });
    }
  }

  // 5. Map to MyWatchItem
  const items: MyWatchItem[] = [];

  for (const row of watchRows) {
    const pv = row.product_variants as unknown as {
      id: string;
      variant_key: string;
      product: {
        id: string;
        slug: string;
        canonical_name: string;
        image: string | null;
        category: { slug: string } | null;
      };
    };

    const config: WatchConfig = {
      targetPrice: row.target_price ? Number(row.target_price) : null,
      dropPct: row.drop_pct,
      notifyLow: Boolean(row.notify_low),
      minDealScore: row.min_deal_score,
      notifyBackInStock: Boolean(row.notify_back_in_stock),
      channels: (row.channels as Channel[]) ?? null,
    };

    const state: WatchState = {
      baselinePrice: row.baseline_price ? Number(row.baseline_price) : null,
      condState: (row.cond_state as Partial<Record<ConditionKey, boolean>>) ?? {},
      lastAlertPrice: row.last_alert_price ? Number(row.last_alert_price) : null,
      lastAlertedAt: row.last_alerted_at,
      lastInStock: row.last_in_stock,
    };

    const snap = snapshotMap.get(row.variant_id) ?? {
      variantId: row.variant_id,
      price: null,
      inStock: false,
      offerId: null,
      observedAt: null,
      isStale: true,
      deal: null,
    };

    const latestAlert = latestAlertByWatch.get(row.id) ?? null;

    const view = describeWatch({
      config,
      state,
      snapshot: snap,
      createdAt: row.created_at,
      latestAlert,
      settings,
    });

    items.push({
      id: row.id,
      status: row.status as "active" | "paused" | "done",
      product: {
        slug: pv.product.slug,
        categorySlug: pv.product.category?.slug ?? "san-pham",
        name: pv.product.canonical_name,
        image: pv.product.image,
      },
      variant: {
        id: pv.id,
        key: pv.variant_key,
      },
      config,
      view,
      createdAt: row.created_at,
      folderId: row.folder_id,
    });
  }

  // 6. Sort:
  // - active first (by view.sortKey ascending)
  // - then paused
  // - then done
  // Within a group: newer createdAt first
  const statusWeight = { active: 1, paused: 2, done: 3 };

  items.sort((a, b) => {
    if (statusWeight[a.status] !== statusWeight[b.status]) {
      return statusWeight[a.status] - statusWeight[b.status];
    }
    if (a.status === "active" && b.status === "active") {
      if (a.view.sortKey !== b.view.sortKey) {
        return a.view.sortKey - b.view.sortKey;
      }
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return items;
}

export async function getMyWatchForVariant(
  userId: string,
  variantId: string,
  client?: Client,
): Promise<{ id: string; config: WatchConfig; status: string } | null> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("watches")
    .select(
      "id, status, target_price, drop_pct, notify_low, min_deal_score, notify_back_in_stock, channels",
    )
    .eq("user_id", userId)
    .eq("variant_id", variantId)
    .maybeSingle();

  // A DB error is NOT "no Watch yet": returning null here makes saveWatch insert a second
  // Watch and hit the unique (user_id, variant_id) constraint.
  if (error) throw new Error(`Failed to load Watch: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    status: data.status,
    config: {
      targetPrice: data.target_price ? Number(data.target_price) : null,
      dropPct: data.drop_pct,
      notifyLow: Boolean(data.notify_low),
      minDealScore: data.min_deal_score,
      notifyBackInStock: Boolean(data.notify_back_in_stock),
      channels: (data.channels as Channel[]) ?? null,
    },
  };
}

/** Core of the saveWatch action. `supabase` is the user's OWN client (RLS). */
export async function saveWatchForUser(
  supabase: Client,
  userId: string,
  form: FormData,
): Promise<WatchActionResult> {
  const parsed = parseWatchForm(form);
  if (!parsed.ok) {
    return {
      status: "error",
      errors: parsed.errors,
    };
  }

  const { variantId, config } = parsed;

  // Check whether a Watch already exists for this variant
  const existing = await getMyWatchForVariant(userId, variantId, supabase);

  let watchId = "";

  if (existing) {
    watchId = existing.id;
    const { error } = await supabase
      .from("watches")
      .update({
        target_price: config.targetPrice,
        drop_pct: config.dropPct,
        notify_low: config.notifyLow,
        min_deal_score: config.minDealScore,
        notify_back_in_stock: config.notifyBackInStock,
        channels: config.channels,
        // If it was paused/done, editing may keep it as is or reactivate it when requested
      })
      .eq("id", existing.id)
      .eq("user_id", userId);

    if (error) {
      if (error.code === "P0050") {
        return {
          status: "error",
          errors: {
            _form:
              "Bạn đang theo dõi tối đa 50 sản phẩm đang hoạt động. Hãy tạm dừng bớt để thêm mới.",
          },
        };
      }
      throw new Error(`Failed to update Watch: ${error.message}`);
    }
  } else {
    const { data, error } = await supabase
      .from("watches")
      .insert({
        user_id: userId,
        variant_id: variantId,
        target_price: config.targetPrice,
        drop_pct: config.dropPct,
        notify_low: config.notifyLow,
        min_deal_score: config.minDealScore,
        notify_back_in_stock: config.notifyBackInStock,
        channels: config.channels,
        status: "active",
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "P0050") {
        return {
          status: "error",
          errors: {
            _form:
              "Bạn đang theo dõi tối đa 50 sản phẩm đang hoạt động. Hãy tạm dừng bớt để thêm mới.",
          },
        };
      }
      if (error.code === "23503") {
        return {
          status: "error",
          errors: {
            variantId: "Không tìm thấy phiên bản sản phẩm này.",
          },
        };
      }
      throw new Error(`Failed to create Watch: ${error.message}`);
    }

    watchId = data.id;
  }

  const conditionCount = [
    config.targetPrice != null,
    config.dropPct != null,
    config.notifyLow,
    config.minDealScore != null,
    config.notifyBackInStock,
  ].filter(Boolean).length;
  return { status: "saved", watchId, created: !existing, variantId, conditionCount };
}

// ─── Folders ────────────────────────────────────────────────────────────────

export type FolderActionResult =
  | { status: "ok"; folder?: WatchFolder }
  | { status: "error"; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLDER_LIMIT_ERROR = `Mỗi tài khoản có tối đa ${MAX_FOLDERS} thư mục.`;
const FOLDER_DUPLICATE_ERROR = "Bạn đã có thư mục với tên này.";
const FOLDER_NOT_FOUND_ERROR = "Không tìm thấy thư mục này.";

type FolderRow = Database["public"]["Tables"]["watch_folders"]["Row"];
const toFolder = (r: Pick<FolderRow, "id" | "name" | "sort_order">): WatchFolder => ({
  id: r.id,
  name: r.name,
  sortOrder: r.sort_order,
});

/** The user's folders in display order. Filtered by user_id on top of RLS. */
export async function listMyFolders(userId: string, client?: Client): Promise<WatchFolder[]> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from("watch_folders")
    .select("id, name, sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load Watch folders: ${error.message}`);
  return sortFolders((data ?? []).map(toFolder));
}

/** Core of createFolder. `supabase` is the user's OWN client (RLS). */
export async function createFolderForUser(
  supabase: Client,
  userId: string,
  rawName: unknown,
): Promise<FolderActionResult> {
  const existing = await listMyFolders(userId, supabase);
  const name = validateFolderName(rawName, existing);
  if (!name.ok) return { status: "error", error: name.error };
  if (existing.length >= MAX_FOLDERS) return { status: "error", error: FOLDER_LIMIT_ERROR };

  const { data, error } = await supabase
    .from("watch_folders")
    .insert({ user_id: userId, name: name.value, sort_order: nextSortOrder(existing) })
    .select("id, name, sort_order")
    .single();
  if (error) {
    if (error.code === "23505") return { status: "error", error: FOLDER_DUPLICATE_ERROR };
    // The name was validated above, so a check violation here is the 20-folder trigger.
    if (error.code === "23514") return { status: "error", error: FOLDER_LIMIT_ERROR };
    throw new Error(`Failed to create Watch folder: ${error.message}`);
  }
  return { status: "ok", folder: toFolder(data) };
}

export async function renameFolderForUser(
  supabase: Client,
  userId: string,
  folderId: string,
  rawName: unknown,
): Promise<FolderActionResult> {
  if (!UUID_RE.test(folderId)) return { status: "error", error: FOLDER_NOT_FOUND_ERROR };
  const existing = await listMyFolders(userId, supabase);
  if (!existing.some((f) => f.id === folderId)) return { status: "error", error: FOLDER_NOT_FOUND_ERROR };
  const name = validateFolderName(rawName, existing, folderId);
  if (!name.ok) return { status: "error", error: name.error };

  const { data, error } = await supabase
    .from("watch_folders")
    .update({ name: name.value })
    .eq("id", folderId)
    .eq("user_id", userId)
    .select("id, name, sort_order");
  if (error) {
    if (error.code === "23505") return { status: "error", error: FOLDER_DUPLICATE_ERROR };
    throw new Error(`Failed to rename Watch folder: ${error.message}`);
  }
  if (!data || data.length === 0) return { status: "error", error: FOLDER_NOT_FOUND_ERROR };
  return { status: "ok", folder: toFolder(data[0]) };
}

/** Deleting a folder keeps its Watches: folder_id goes back to null (FK on delete set null). */
export async function deleteFolderForUser(
  supabase: Client,
  userId: string,
  folderId: string,
): Promise<FolderActionResult> {
  if (!UUID_RE.test(folderId)) return { status: "error", error: FOLDER_NOT_FOUND_ERROR };
  const { data, error } = await supabase
    .from("watch_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(`Failed to delete Watch folder: ${error.message}`);
  if (!data || data.length === 0) return { status: "error", error: FOLDER_NOT_FOUND_ERROR };
  return { status: "ok" };
}

/** File a Watch into one of the user's folders (null = unfiled). The DB trigger rejects others' folders. */
export async function moveWatchForUser(
  supabase: Client,
  userId: string,
  watchId: string,
  folderId: string | null,
): Promise<FolderActionResult> {
  if (!UUID_RE.test(watchId)) return { status: "error", error: "Không tìm thấy theo dõi này." };
  if (folderId !== null && !UUID_RE.test(folderId)) return { status: "error", error: FOLDER_NOT_FOUND_ERROR };

  const { data, error } = await supabase
    .from("watches")
    .update({ folder_id: folderId })
    .eq("id", watchId)
    .eq("user_id", userId)
    .select("id");
  if (error) {
    // watches_check_folder (not the owner's folder) or a folder deleted meanwhile (FK).
    if (error.code === "23514" || error.code === "23503") {
      return { status: "error", error: FOLDER_NOT_FOUND_ERROR };
    }
    throw new Error(`Failed to move Watch to folder: ${error.message}`);
  }
  if (!data || data.length === 0) return { status: "error", error: "Không tìm thấy theo dõi này." };
  return { status: "ok" };
}
