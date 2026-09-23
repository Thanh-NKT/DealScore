import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_NOTIFICATION_SETTINGS, fromRow, resolveChannels, type Channel } from "@/lib/account/notification-settings";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { sendEmail } from "@/lib/email";
import { listUnsubscribeHeaders, renderAlertEmail, type AlertEmailItem } from "@/lib/email/templates/alert";
import { describeTriggers } from "@/lib/alerts/triggers-text";
import { signUnsubscribeToken } from "@/lib/alerts/unsubscribe-token";
import { groupDeliveries, nextRetryAt, type ClaimedDelivery } from "@/lib/alerts/group";
import type { TriggerType } from "@/lib/watch/types";
import { siteUrl } from "@/lib/site-url";
import { buildPushPayload } from "@/lib/push/payload";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: "kairo-alert";
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
  watchId: string;
  triggerTypes: TriggerType[];
  price: number;
  offerId: string | null;
  marketplace: string | null;
  baselinePrice: number | null;
  previousAlertPrice: number | null;
  dealScore: number | null;
  recommendation: Recommendation | null;
  scoreReasons: string[];
  watch: { status: string; channels: Channel[] | null; targetPrice: number | null; variantId: string };
  product: { name: string; slug: string; categorySlug: string; image: string | null; variantKey: string };
  user: { email: string | null; deletedAt: string | null; settings: ReturnType<typeof fromRow> };
}

async function loadEvents(client: Client, ids: string[]): Promise<Map<string, EventDetail>> {
  const { data, error } = await client
    .from("alert_events")
    .select(
      `id, watch_id, trigger_types, price, offer_id, baseline_price, previous_alert_price, deal_score, recommendation, score_reasons,
       offers(listings(marketplace)),
       watches!inner(status, channels, target_price, variant_id,
         product_variants!inner(variant_key, products!inner(slug, canonical_name, image, categories(slug))),
         users!inner(email, deleted_at, notification_settings(*)))`,
    )
    .in("id", ids);
  if (error) throw new Error(`Failed to read alert_events: ${error.message}`);

  const map = new Map<string, EventDetail>();
  for (const r of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = r.watches as any;
    const p = w.product_variants.products;
    map.set(r.id, {
      id: r.id,
      watchId: r.watch_id,
      triggerTypes: r.trigger_types as TriggerType[],
      price: Number(r.price),
      offerId: r.offer_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      marketplace: (r.offers as any)?.listings?.marketplace ?? null,
      baselinePrice: n(r.baseline_price),
      previousAlertPrice: n(r.previous_alert_price),
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
  return map;
}

function productUrl(site: string, e: EventDetail) {
  return `${site}/${e.product.categorySlug}/${e.product.slug}?variant=${e.watch.variantId}`;
}

export async function dispatchDueDeliveries(
  opts: { now: Date; limit?: number; deadline?: number },
  client: Client = createAdminClient(),
  push: PushSender = pushNotInstalled,
): Promise<{ sent: number; failed: number; retried: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  const nowIso = opts.now.toISOString();

  const { data: claimedRaw, error } = await client.rpc("claim_due_deliveries", {
    p_now: nowIso,
    p_limit: Math.min(opts.limit ?? 200, 999),
  });
  if (error) throw new Error(`claim_due_deliveries failed: ${error.message}`);
  const claimed: ClaimedDelivery[] = (claimedRaw ?? []).map((r) => ({
    deliveryId: r.delivery_id,
    channel: r.channel as Channel,
    attempts: r.attempts,
    alertEventId: r.alert_event_id,
    watchId: r.watch_id,
    userId: r.user_id,
  }));
  if (claimed.length === 0) return stats;

  const events = await loadEvents(client, [...new Set(claimed.map((c) => c.alertEventId))]);

  const update = async (ids: string[], patch: Database["public"]["Tables"]["alert_deliveries"]["Update"]) => {
    if (ids.length === 0) return;
    const { error: uErr } = await client.from("alert_deliveries").update(patch).in("id", ids);
    if (uErr) throw new Error(`Failed to update alert_deliveries: ${uErr.message}`);
  };

  // Filter: re-check RIGHT before sending — state may have changed since the alert was created.
  const ready: ClaimedDelivery[] = [];
  const skips = new Map<string, string[]>();
  for (const c of claimed) {
    const e = events.get(c.alertEventId);
    let reason: string | null = null;
    if (!e || e.user.deletedAt) reason = "account_deleted";
    else if (e.watch.status !== "active") reason = "watch_inactive";
    else if (!resolveChannels(e.user.settings, e.watch.channels).includes(c.channel)) reason = "channel_disabled";
    if (reason) skips.set(reason, [...(skips.get(reason) ?? []), c.deliveryId]);
    else ready.push(c);
  }
  for (const [reason, ids] of skips) {
    await update(ids, { status: "skipped", skip_reason: reason });
    stats.skipped += ids.length;
  }

  const site = siteUrl();
  const secret = process.env.UNSUBSCRIBE_SECRET;

  for (const group of groupDeliveries(ready)) {
    if (opts.deadline && Date.now() > opts.deadline) {
      // Return unfinished work to pending so the next run picks it up immediately.
      await update(group.deliveries.map((d) => d.deliveryId), { status: "pending", claimed_at: null });
      continue;
    }
    const ids = group.deliveries.map((d) => d.deliveryId);
    const items = group.deliveries.map((d) => events.get(d.alertEventId)!);

    try {
      let providerId: string | null = null;
      if (group.channel === "email") {
        if (!secret) throw new Error("Missing UNSUBSCRIBE_SECRET");
        const to = items[0].user.email;
        if (!to) {
          await update(ids, { status: "skipped", skip_reason: "no_email" });
          stats.skipped += ids.length;
          continue;
        }
        const allToken = signUnsubscribeToken({ kind: "email", userId: group.userId }, secret);
        const emailItems: AlertEmailItem[] = items.map((e) => ({
          productName: e.product.name,
          variantKey: e.product.variantKey,
          imageUrl: e.product.image,
          price: e.price,
          baselinePrice: e.baselinePrice,
          dealScore: e.dealScore,
          recommendation: e.recommendation,
          triggerTexts: describeTriggers(e.triggerTypes, {
            price: e.price,
            targetPrice: e.watch.targetPrice,
            baselinePrice: e.baselinePrice,
            lastAlertPrice: e.previousAlertPrice,
            dealScore: e.dealScore,
          }),
          scoreReasons: e.scoreReasons.slice(0, 2),
          buyUrl:
            e.offerId && e.marketplace
              ? `${site}/go/${e.marketplace}/${e.offerId}?src=email&watch=${e.watchId}&alert=${e.id}`
              : productUrl(site, e),
          // No /account/watch/[id] detail page yet — point at the list, scrolled to that Watch.
          manageUrl: `${site}/account/watch#${e.watchId}`,
          pauseUrl: `${site}/unsubscribe?t=${signUnsubscribeToken({ kind: "watch", userId: group.userId, watchId: e.watchId }, secret)}`,
        }));
        const mail = renderAlertEmail({
          items: emailItems,
          unsubscribeAllUrl: `${site}/unsubscribe?t=${allToken}`,
          siteUrl: site,
        });
        const res = await sendEmail({
          to,
          ...mail,
          headers: listUnsubscribeHeaders(`${site}/api/unsubscribe?t=${allToken}`, `${site}/unsubscribe?t=${allToken}`),
          tags: [{ name: "type", value: "alert" }],
        });
        providerId = res.id;
      } else {
        const payload = buildPushPayload(
          items.map((e) => ({ productName: e.product.name, price: e.price, url: productUrl(site, e) })),
          site,
        );
        const r = await push(group.userId, payload);
        if (r.delivered === 0 && r.failed === 0) {
          await update(ids, { status: "skipped", skip_reason: "no_device" });
          stats.skipped += ids.length;
          continue;
        }
        if (r.delivered === 0) throw new Error(`Push failed on ${r.failed} device(s)`);
      }

      await update(ids, { status: "sent", sent_at: nowIso, provider_message_id: providerId, attempts: group.deliveries[0].attempts + 1 });
      stats.sent += ids.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const d of group.deliveries) {
        const attempts = d.attempts + 1;
        const retry = nextRetryAt(attempts, opts.now);
        await update([d.deliveryId], retry
          ? { status: "pending", attempts, next_attempt_at: retry.toISOString(), last_error: message }
          : { status: "failed", attempts, last_error: message });
        if (retry) stats.retried++;
        else stats.failed++;
      }
    }
  }
  return stats;
}
