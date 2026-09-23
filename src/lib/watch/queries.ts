import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { parseWatchForm, type WatchField } from "@/lib/watch/form";

type Client = SupabaseClient<Database>;

export type WatchActionResult =
  | { status: "idle" }
  | { status: "saved"; watchId: string }
  | { status: "error"; errors: Partial<Record<WatchField, string>> };
import { fromRow, DEFAULT_NOTIFICATION_SETTINGS, type Channel } from "@/lib/account/notification-settings";
import { describeWatch, type LatestAlert, type WatchView } from "@/lib/watch/describe";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import type { ConditionKey, WatchConfig, WatchState } from "@/lib/watch/types";

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
      last_alerted_at, last_in_stock, created_at,
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

  return { status: "saved", watchId };
}
