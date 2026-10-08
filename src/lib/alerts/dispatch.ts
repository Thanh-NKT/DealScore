import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow, resolveChannels, type Channel } from "@/lib/account/notification-settings";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { EmailSendError, sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";
import { listUnsubscribeHeaders, renderAlertEmail, type AlertEmailItem, type DiscoveryEmailBlock } from "@/lib/email/templates/alert";
import {
  discoveryLink,
  discoveryProductUrl,
  discoveryTitle,
  parseEventItems,
  type DiscoveryEventDetail,
} from "@/lib/alerts/discovery";
import { parseSavedParams } from "@/lib/saved-search/params";
import { describeTriggers, isPriceHikeOnly } from "@/lib/alerts/triggers-text";
import { signUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { groupDeliveries, latestPerWatch, mergeDigestTriggers, nextRetryAt, type ClaimedDelivery } from "@/lib/alerts/group";
import type { TriggerType } from "@/lib/watch/types";
import { siteUrl } from "@/lib/site-url";
import { buildPushPayload } from "@/lib/push/payload";
import { shownEffectivePrice } from "@/lib/vouchers/effective";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: "dealscore-alert";
}
export type PushSender = (
  userId: string,
  payload: PushPayload,
) => Promise<{ delivered: number; removed: number; failed: number }>;

/** Replaced by the real sendPushToUser in Task 13. */
const pushNotInstalled: PushSender = async () => {
  throw new Error("Web push is not configured");
};

type Client = SupabaseClient<Database>;
const n = (v: unknown) => (v == null ? null : Number(v));

interface EventDetail {
  id: string;
  createdAt: string;
  watchId: string;
  triggerTypes: TriggerType[];
  price: number;
  offerId: string | null;
  /** The offer's stored effective price + when it was computed / stops being valid (raw; filtered at render time). */
  effective: { price: number | null; at: string | null; until: string | null };
  /** The offer's latest valid observation right now (latest_price_per_offer); null when unknown. */
  current: { price: number; observedAt: string } | null;
  marketplace: string | null;
  baselinePrice: number | null;
  previousAlertPrice: number | null;
  /** price_hike: the prior 60-day median (alert_events.reference_price). */
  referencePrice: number | null;
  dealScore: number | null;
  recommendation: Recommendation | null;
  scoreReasons: string[];
  watch: { status: string; channels: Channel[] | null; targetPrice: number | null; variantId: string };
  product: { name: string; slug: string; categorySlug: string; image: string | null; variantKey: string };
  user: { email: string | null; deletedAt: string | null; settings: ReturnType<typeof fromRow> };
}

/** Watch alerts (alert_events.watch_id set). Same select as before P4. */
async function loadWatchEvents(client: Client, ids: string[]): Promise<Map<string, EventDetail>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client
    .from("alert_events")
    .select(
      `id, created_at, watch_id, trigger_types, price, offer_id, baseline_price, previous_alert_price, reference_price, deal_score, recommendation, score_reasons,
       offers(effective_price, effective_price_at, effective_price_until, listings(marketplace)),
       watches!inner(status, channels, target_price, variant_id,
         product_variants!inner(variant_key, products!inner(slug, canonical_name, image, categories(slug))),
         users!inner(email, deleted_at, notification_settings(*)))`,
    )
    .in("id", ids)
    .not("watch_id", "is", null);
  if (error) throw new Error(`Failed to read alert_events: ${error.message}`);

  const map = new Map<string, EventDetail>();
  for (const r of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = r.watches as any;
    const p = w.product_variants.products;
    map.set(r.id, {
      id: r.id,
      createdAt: r.created_at,
      watchId: r.watch_id!,
      triggerTypes: r.trigger_types as TriggerType[],
      price: Number(r.price),
      offerId: r.offer_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      marketplace: (r.offers as any)?.listings?.marketplace ?? null,
      effective: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        price: n((r.offers as any)?.effective_price),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        at: (r.offers as any)?.effective_price_at ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        until: (r.offers as any)?.effective_price_until ?? null,
      },
      current: null,
      baselinePrice: n(r.baseline_price),
      previousAlertPrice: n(r.previous_alert_price),
      referencePrice: n(r.reference_price),
      dealScore: r.deal_score,
      recommendation: r.recommendation as Recommendation | null,
      scoreReasons: r.score_reasons ?? [],
      watch: { status: w.status, channels: w.channels, targetPrice: n(w.target_price), variantId: w.variant_id },
      product: {
        name: p.canonical_name,
        slug: p.slug ?? "",
        categorySlug: p.categories?.slug ?? "san-pham",
        image: p.image,
        variantKey: w.product_variants.variant_key,
      },
      user: {
        email: w.users.email,
        deletedAt: w.users.deleted_at,
        settings: w.users.notification_settings ? fromRow(w.users.notification_settings) : DEFAULT_NOTIFICATION_SETTINGS,
      },
    });
  }

  // Current observation of each event's offer: the stored effective price is shown only while it
  // was computed from it (see alertEffectivePrice).
  const variantIds = [...new Set([...map.values()].filter((e) => e.offerId).map((e) => e.watch.variantId))];
  const current = new Map<string, { price: number; observedAt: string }>();
  for (const variantId of variantIds) {
    const { data: rows, error: pErr } = await client.rpc("latest_price_per_offer", { p_variant_id: variantId });
    if (pErr) throw new Error(`latest_price_per_offer failed: ${pErr.message}`);
    for (const r of rows ?? []) {
      if (r.price != null && r.observed_at) current.set(r.offer_id, { price: Number(r.price), observedAt: r.observed_at });
    }
  }
  for (const e of map.values()) e.current = e.offerId ? (current.get(e.offerId) ?? null) : null;
  return map;
}

const PRODUCT_ID_CHUNK = 200;

/**
 * Discovery alerts (saved search / demand found, 0061): one alert_events read with their source and user, then
 * one products read for the named items. A product deleted since (P3 merge) is dropped from its block; a block
 * left empty is skipped by the caller (source_inactive).
 */
export async function loadDiscoveryEvents(client: Client, ids: string[]): Promise<Map<string, DiscoveryEventDetail>> {
  const map = new Map<string, DiscoveryEventDetail>();
  if (ids.length === 0) return map;
  const { data, error } = await client
    .from("alert_events")
    .select(
      `id, created_at, user_id, trigger_types, items, items_total, saved_search_id, demand_follow_id,
       saved_searches(name, status, channels, params), demand_follows(keyword, status),
       users!inner(email, deleted_at, notification_settings(*))`,
    )
    .in("id", ids)
    .is("watch_id", null);
  if (error) throw new Error(`Failed to read discovery alert_events: ${error.message}`);

  const parsed = (data ?? []).map((r) => ({ r, items: parseEventItems(r.items) }));
  const productIds = [...new Set(parsed.flatMap((x) => x.items.map((i) => i.productId)))];
  const products = new Map<string, { name: string; slug: string; categorySlug: string; image: string | null }>();
  for (let i = 0; i < productIds.length; i += PRODUCT_ID_CHUNK) {
    const { data: ps, error: pErr } = await client
      .from("products")
      .select("id, slug, canonical_name, image, categories(slug)")
      .in("id", productIds.slice(i, i + PRODUCT_ID_CHUNK));
    if (pErr) throw new Error(`Failed to read discovery products: ${pErr.message}`);
    for (const p of ps ?? []) {
      products.set(p.id, {
        name: p.canonical_name,
        slug: p.slug ?? "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        categorySlug: (p.categories as any)?.slug ?? "san-pham",
        image: p.image,
      });
    }
  }

  for (const { r, items } of parsed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = r.users as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ss = r.saved_searches as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const df = r.demand_follows as any;
    let source: DiscoveryEventDetail["source"] | null = null;
    if (r.saved_search_id && ss) {
      source = {
        kind: "saved_search",
        id: r.saved_search_id,
        name: ss.name,
        status: ss.status,
        channels: ss.channels,
        params: parseSavedParams(ss.params) ?? {},
      };
    } else if (r.demand_follow_id && df) {
      source = { kind: "demand_found", id: r.demand_follow_id, keyword: df.keyword, status: df.status };
    }
    if (!source) continue; // source deleted since (the cascade normally removes the event too)
    map.set(r.id, {
      id: r.id,
      createdAt: r.created_at,
      trigger: source.kind,
      userId: r.user_id,
      source,
      items: items.flatMap((i) => {
        const p = products.get(i.productId);
        return p ? [{ ...i, ...p }] : [];
      }),
      totalNew: Math.max(r.items_total ?? 0, items.length),
      user: {
        email: u.email,
        deletedAt: u.deleted_at,
        settings: u.notification_settings ? fromRow(u.notification_settings) : DEFAULT_NOTIFICATION_SETTINGS,
      },
    });
  }
  return map;
}

/** Why a discovery delivery must not be sent now, or null. */
export function discoverySkipReason(e: DiscoveryEventDetail | undefined, channel: Channel): string | null {
  if (!e || e.user.deletedAt) return "account_deleted";
  if (e.source.kind === "saved_search" ? e.source.status !== "active" : e.source.status !== "found") return "source_inactive";
  if (e.items.length === 0) return "source_inactive";
  const channels = e.source.kind === "saved_search" ? e.source.channels : null;
  if (!resolveChannels(e.user.settings, channels).includes(channel)) return "channel_disabled";
  return null;
}

/** A digest kept the newest event of a source: fold the older events' products in (deduped, ≤ 5 listed). */
export function mergeDiscoveryEvents(keep: DiscoveryEventDetail, older: DiscoveryEventDetail[]): DiscoveryEventDetail {
  if (older.length === 0) return keep;
  const seen = new Set(keep.items.map((i) => i.productId));
  const items = [...keep.items];
  let extra = 0;
  for (const o of older) {
    for (const i of o.items) {
      if (seen.has(i.productId)) continue;
      seen.add(i.productId);
      items.push(i);
    }
    extra += o.totalNew;
  }
  items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { ...keep, items: items.slice(0, 5), totalNew: Math.max(keep.totalNew + extra, items.length) };
}

/** Email block for a discovery event (UI spec §1.4). */
export function discoveryEmailBlock(site: string, e: DiscoveryEventDetail, pauseUrl: string): DiscoveryEmailBlock {
  const listed = e.items.slice(0, e.source.kind === "saved_search" ? 5 : 3);
  const products = listed.map((i) => ({
    name: i.name,
    price: i.price,
    recommendation: i.recommendation,
    url: discoveryProductUrl(site, i),
    imageUrl: i.image,
  }));
  const searchUrl = discoveryLink(site, e);
  if (e.source.kind === "saved_search") {
    return {
      title: `Có sản phẩm mới khớp “${e.source.name}”`,
      lead: `${e.totalNew} sản phẩm vừa khớp điều kiện của bạn${e.source.params.onlyBuy ? " · Nên mua" : ""}`,
      products,
      moreCount: Math.max(0, e.totalNew - listed.length),
      searchUrl,
      searchLabel: "Xem kết quả",
      manageUrl: `${site}/account/searches`,
      pauseUrl,
      pauseLabel: "Tạm dừng tìm kiếm này",
    };
  }
  return {
    title: `DealScore đã có “${e.source.keyword}”`,
    lead: "Lúc bạn tìm chưa có kết quả phù hợp. Giờ đã có:",
    products,
    moreCount: 0,
    searchUrl,
    searchLabel: "Xem tất cả kết quả",
    manageUrl: `${site}/account/searches`,
    pauseUrl,
    pauseLabel: "Không báo nữa",
  };
}

/**
 * The "≈ X sau voucher" figure for an alert email: the offer's stored effective price, only when the
 * alert price is still the offer's current price and the stored value passes shownEffectivePrice()
 * (computed from that observation or later, fresh, no voucher of the combination expired).
 */
export function alertEffectivePrice(
  e: Pick<EventDetail, "price" | "effective" | "current">,
  now: Date,
): number | null {
  if (!e.current || e.current.price !== e.price) return null;
  return shownEffectivePrice(e.effective, { price: e.price, observedAt: e.current.observedAt }, now);
}

/** Stable for a set of deliveries (order-free), ≤ 256 chars as Resend requires. */
export function deliveryIdempotencyKey(deliveryIds: string[]): string {
  const digest = crypto.createHash("sha256").update([...deliveryIds].sort().join(",")).digest("hex");
  return `alert-delivery/${digest}`;
}

/** A send that must not be retried: it cannot succeed with the same idempotency key. */
class NonRetryableDeliveryError extends Error {}

function productUrl(site: string, e: EventDetail) {
  return `${site}/${e.product.categorySlug}/${e.product.slug}?variant=${e.watch.variantId}`;
}

export async function dispatchDueDeliveries(
  /** `userIds`: claim only those users' deliveries (claim_due_deliveries_for_users, 0068) — tests, targeted re-sends. */
  opts: { now: Date; limit?: number; deadline?: number; userIds?: string[] },
  client: Client = createAdminClient(),
  push: PushSender = pushNotInstalled,
): Promise<{ sent: number; failed: number; retried: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  const nowIso = opts.now.toISOString();
  if (opts.userIds && opts.userIds.length === 0) return stats;

  const p_limit = Math.min(opts.limit ?? 200, 999);
  const { data: claimedRaw, error } = opts.userIds
    ? await client.rpc("claim_due_deliveries_for_users", { p_now: nowIso, p_limit, p_user_ids: opts.userIds })
    : await client.rpc("claim_due_deliveries", { p_now: nowIso, p_limit });
  if (error) throw new Error(`claim_due_deliveries failed: ${error.message}`);
  const claimed: ClaimedDelivery[] = (claimedRaw ?? []).map((r) => ({
    deliveryId: r.delivery_id,
    channel: r.channel as Channel,
    attempts: r.attempts,
    alertEventId: r.alert_event_id,
    watchId: r.watch_id ?? null,
    userId: r.user_id,
  }));
  if (claimed.length === 0) return stats;

  const events = await loadWatchEvents(client, [...new Set(claimed.filter((c) => c.watchId).map((c) => c.alertEventId))]);
  const discoveries = await loadDiscoveryEvents(client, [...new Set(claimed.filter((c) => !c.watchId).map((c) => c.alertEventId))]);
  for (const c of claimed) {
    if (c.watchId) c.sourceKey = `w:${c.watchId}`;
    else {
      const d = discoveries.get(c.alertEventId);
      c.sourceKey = d ? `${d.source.kind === "saved_search" ? "s" : "d"}:${d.source.id}` : `e:${c.alertEventId}`;
    }
  }
  const createdAt = (id: string) => events.get(id)?.createdAt ?? discoveries.get(id)?.createdAt ?? "";

  const update = async (ids: string[], patch: Database["public"]["Tables"]["alert_deliveries"]["Update"]) => {
    if (ids.length === 0) return;
    const { error: uErr } = await client.from("alert_deliveries").update(patch).in("id", ids);
    if (uErr) throw new Error(`Failed to update alert_deliveries: ${uErr.message}`);
  };

  // Filter: re-check RIGHT before sending — state may have changed since the alert was created.
  const ready: ClaimedDelivery[] = [];
  const skips = new Map<string, string[]>();
  for (const c of claimed) {
    if (!c.watchId) {
      const reason = discoverySkipReason(discoveries.get(c.alertEventId), c.channel);
      if (reason) skips.set(reason, [...(skips.get(reason) ?? []), c.deliveryId]);
      else ready.push(c);
      continue;
    }
    const e = events.get(c.alertEventId);
    let reason: string | null = null;
    if (!e || e.user.deletedAt) reason = "account_deleted";
    else if (e.watch.status !== "active") reason = "watch_inactive";
    else if (!resolveChannels(e.user.settings, e.watch.channels).includes(c.channel)) reason = "channel_disabled";
    if (reason) skips.set(reason, [...(skips.get(reason) ?? []), c.deliveryId]);
    else ready.push(c);
  }
  // Digests (weekly especially) can hold several alerts for one Watch: send only the newest,
  // carrying the triggers of the older ones of the same kind (mergeDigestTriggers), and mark those as superseded.
  const mergedTriggers = new Map<string, TriggerType[]>();
  const mergedDiscoveries = new Map<string, DiscoveryEventDetail>();
  /**
   * Discovery only (P4 review m1): the older deliveries folded into a kept one. They follow the kept delivery's
   * outcome — superseded once it is sent, back to pending with it on a retry — so a failed send never loses
   * the folded products (their hits are already marked alerted).
   */
  const folded = new Map<string, string[]>();
  const latest: ClaimedDelivery[] = [];
  for (const { keep, older } of latestPerWatch(ready, createdAt)) {
    latest.push(keep);
    if (older.length === 0) continue;
    if (!keep.watchId) {
      folded.set(keep.deliveryId, older.map((d) => d.deliveryId));
      // Same source in one digest: one block, with the older events' products folded in.
      mergedDiscoveries.set(
        keep.alertEventId,
        mergeDiscoveryEvents(discoveries.get(keep.alertEventId)!, older.map((d) => discoveries.get(d.alertEventId)!)),
      );
      continue;
    }
    skips.set("superseded", [...(skips.get("superseded") ?? []), ...older.map((d) => d.deliveryId)]);
    mergedTriggers.set(
      keep.alertEventId,
      mergeDigestTriggers(events.get(keep.alertEventId)!.triggerTypes, older.map((d) => events.get(d.alertEventId)!.triggerTypes)),
    );
  }

  for (const [reason, ids] of skips) {
    await update(ids, { status: "skipped", skip_reason: reason });
    stats.skipped += ids.length;
  }

  const site = siteUrl();
  const secret = process.env.UNSUBSCRIBE_SECRET;

  for (const group of groupDeliveries(latest)) {
    const held = group.deliveries.flatMap((d) => folded.get(d.deliveryId) ?? []);
    if (opts.deadline && Date.now() > opts.deadline) {
      // Return unfinished work to pending so the next run picks it up immediately.
      await update([...group.deliveries.map((d) => d.deliveryId), ...held], { status: "pending", claimed_at: null });
      continue;
    }
    const ids = group.deliveries.map((d) => d.deliveryId);
    const items = group.deliveries.filter((d) => d.watchId).map((d) => events.get(d.alertEventId)!);
    const discs = group.deliveries
      .filter((d) => !d.watchId)
      .map((d) => mergedDiscoveries.get(d.alertEventId) ?? discoveries.get(d.alertEventId)!);

    let providerId: string | null = null;
    try {
      if (group.channel === "email") {
        if (!secret) throw new Error("Missing UNSUBSCRIBE_SECRET");
        const to = items[0]?.user.email ?? discs[0]?.user.email ?? null;
        if (!to) {
          await update([...ids, ...held], { status: "skipped", skip_reason: "no_email" });
          stats.skipped += ids.length + held.length;
          continue;
        }
        const allToken = signUnsubscribeToken({ kind: "email", userId: group.userId }, secret);
        const emailItems: AlertEmailItem[] = items.map((e) => {
          const triggers = mergedTriggers.get(e.id) ?? e.triggerTypes;
          // "Chưa nên mua lúc này": no marketplace button, the CTA opens DealScore (UI spec §3).
          const hikeOnly = isPriceHikeOnly(triggers);
          return {
          productName: e.product.name,
          variantKey: e.product.variantKey,
          imageUrl: e.product.image,
          price: e.price,
          effectivePrice: alertEffectivePrice(e, opts.now),
          baselinePrice: e.baselinePrice,
          dealScore: e.dealScore,
          recommendation: e.recommendation,
          triggerTexts: describeTriggers(triggers, {
            price: e.price,
            targetPrice: e.watch.targetPrice,
            baselinePrice: e.baselinePrice,
            lastAlertPrice: e.previousAlertPrice,
            dealScore: e.dealScore,
            referencePrice: e.referencePrice,
          }),
          priceHikeOnly: hikeOnly,
          scoreReasons: e.scoreReasons.slice(0, 2),
          buyUrl:
            !hikeOnly && e.offerId && e.marketplace
              ? `${site}/go/${e.marketplace}/${e.offerId}?src=email&watch=${e.watchId}&alert=${e.id}`
              : productUrl(site, e),
          // No /account/watch/[id] detail page yet — point at the list, scrolled to that Watch.
          manageUrl: `${site}/account/watch#${e.watchId}`,
          pauseUrl: `${site}/unsubscribe?t=${signUnsubscribeToken({ kind: "watch", userId: group.userId, watchId: e.watchId }, secret)}`,
          };
        });
        const discoveryBlocks: DiscoveryEmailBlock[] = discs.map((d) =>
          discoveryEmailBlock(
            site,
            d,
            `${site}/unsubscribe?t=${signUnsubscribeToken(
              d.source.kind === "saved_search"
                ? { kind: "saved_search", userId: group.userId, savedSearchId: d.source.id }
                : { kind: "demand_follow", userId: group.userId, followId: d.source.id },
              secret,
            )}`,
          ),
        );
        const mail = renderAlertEmail({
          items: emailItems,
          // Watch-only groups pass no discoveries: byte-identical to the pre-P4 email.
          ...(discoveryBlocks.length > 0 ? { discoveries: discoveryBlocks } : {}),
          unsubscribeAllUrl: `${site}/unsubscribe?t=${allToken}`,
          siteUrl: site,
        });
        try {
          const res = await sendEmail({
            to,
            ...mail,
            headers: listUnsubscribeHeaders(`${site}/api/unsubscribe?t=${allToken}`, `${site}/unsubscribe?t=${allToken}`),
            tags: [{ name: "type", value: "alert" }],
            // Delivery is at-least-once: a send whose bookkeeping was lost is claimed again later.
            // Same delivery set → same key, so Resend (24h window) does not send that email twice.
            idempotencyKey: deliveryIdempotencyKey(ids),
          });
          providerId = res.id;
        } catch (err) {
          // The key was already used with another body (prices re-rendered on a later run). That does
          // NOT prove the first request was delivered: Resend's SDK docs (node_modules/resend) do not
          // say a key is kept only for accepted requests. A retry cannot succeed either (same key, new
          // body): stop as failed and report it — never mark it sent on a guess.
          if (err instanceof EmailSendError && err.code === "invalid_idempotent_request") {
            throw new NonRetryableDeliveryError(`invalid_idempotent_request: ${err.message}`);
          }
          throw err;
        }
      } else {
        // Push has no idempotency key: a reclaimed delivery may notify a device twice.
        const payload = buildPushPayload(
          items.map((e) => ({
            productName: e.product.name,
            price: e.price,
            url: productUrl(site, e),
            priceHikeOnly: isPriceHikeOnly(mergedTriggers.get(e.id) ?? e.triggerTypes),
          })),
          site,
          discs.length > 0 ? discs.map((d) => ({ title: discoveryTitle(d), url: discoveryLink(site, d) })) : undefined,
        );
        const r = await push(group.userId, payload);
        if (r.delivered === 0 && r.failed === 0) {
          await update([...ids, ...held], { status: "skipped", skip_reason: "no_device" });
          stats.skipped += ids.length + held.length;
          continue;
        }
        if (r.delivered === 0) throw new Error(`Push failed on ${r.failed} device(s)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof NonRetryableDeliveryError) {
        reportError(err, { where: "alert_dispatch_non_retryable", channel: group.channel, deliveries: ids.length });
        for (const d of group.deliveries) {
          await update([d.deliveryId], { status: "failed", attempts: d.attempts + 1, last_error: message });
        }
        await update(held, { status: "failed", last_error: message });
        stats.failed += ids.length + held.length;
        continue;
      }
      for (const d of group.deliveries) {
        const attempts = d.attempts + 1;
        const retry = nextRetryAt(attempts, opts.now);
        await update([d.deliveryId], retry
          ? { status: "pending", attempts, next_attempt_at: retry.toISOString(), last_error: message }
          : { status: "failed", attempts, last_error: message });
        if (retry) stats.retried++;
        else stats.failed++;
        // Folded deliveries were not attempted: they wait with their kept delivery and are folded in again.
        const mine = folded.get(d.deliveryId) ?? [];
        await update(mine, retry
          ? { status: "pending", claimed_at: null, next_attempt_at: retry.toISOString() }
          : { status: "failed", last_error: message });
      }
      continue;
    }

    // Sent. The bookkeeping stays OUT of the retry path above: putting a sent delivery back to
    // pending would send it again. One retry; if the row is still 'sending', the claim RPC
    // reclaims it after 15 min, counting an attempt (0025), and the email key dedupes the resend.
    const sentPatch = { status: "sent", sent_at: nowIso, provider_message_id: providerId, attempts: group.deliveries[0].attempts + 1 };
    try {
      await update(ids, sentPatch).catch(() => update(ids, sentPatch));
    } catch (err) {
      reportError(err, { where: "alert_dispatch_mark_sent", channel: group.channel, deliveries: ids.length });
    }
    stats.sent += ids.length;
    if (held.length > 0) {
      try {
        await update(held, { status: "skipped", skip_reason: "superseded" });
        stats.skipped += held.length;
      } catch (err) {
        // Still 'sending': reclaimed after 15 min and folded into nothing new — at worst re-announced once.
        reportError(err, { where: "alert_dispatch_mark_superseded", channel: group.channel, deliveries: held.length });
      }
    }
  }
  return stats;
}
