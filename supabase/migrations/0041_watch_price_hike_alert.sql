-- 0041 — Pre-sale price-hike alert (roadmap P2 item C).
--
-- A separate alert kind with its own edge (hike_active) and its own 7-day cooldown (last_hike_alerted_at),
-- decided in TS by decideHikeAlert() (src/lib/watch/price-hike.ts). It never touches last_alerted_at,
-- last_alert_price, baseline_price or cond_state, so it can neither suppress nor feed a price-drop alert.
-- Opt-in per watch (notify_price_hike, default false), like notify_low / notify_back_in_stock.
--
-- Functions are redefined from their latest bodies: watches_before_insert (0006), watches_before_update
-- (0006, search_path from 0023), record_watch_evaluation (0006, search_path from 0023). Signatures, grants and
-- SET clauses are unchanged.
--
-- alert_events.reference_price: the prior 60-day median a price_hike event was measured against, so the
-- email can say "cao hơn N% so với 60 ngày trước" from the event row itself (watches has moved on by then).
-- Null for every other trigger.

alter table public.watches
  add column if not exists notify_price_hike    boolean not null default false,
  add column if not exists hike_active          boolean,
  add column if not exists last_hike_alerted_at timestamptz;

alter table public.alert_events
  add column if not exists reference_price numeric(14,2);

alter table public.alert_events drop constraint if exists alert_trigger_types_valid;
alter table public.alert_events add constraint alert_trigger_types_valid check (
  cardinality(trigger_types) > 0 and trigger_types <@
  array['target_price','drop_pct','low','deal_score','back_in_stock','deeper_drop','price_hike']::text[]
);

alter table public.watches drop constraint if exists watches_has_condition;
alter table public.watches add constraint watches_has_condition check (
  target_price is not null or drop_pct is not null or notify_low
  or min_deal_score is not null or notify_back_in_stock or notify_price_hike
);

create or replace function public.watches_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select v.product_id into new.product_id from product_variants v where v.id = new.variant_id;
  if new.product_id is null then
    raise exception 'variant không tồn tại' using errcode = 'foreign_key_violation';
  end if;

  select vcp.price into new.baseline_price
  from variant_current_price vcp
  where vcp.variant_id = new.variant_id and vcp.in_stock and vcp.price > 0;

  new.cond_state := '{}'::jsonb;
  new.last_alert_price := null;
  new.last_alerted_at := null;
  new.last_in_stock := null;
  new.last_evaluated_at := null;
  new.config_version := 1;
  -- 0041: the price-hike state is engine-only too.
  new.hike_active := null;
  new.last_hike_alerted_at := null;
  return new;
end $$;

create or replace function public.watches_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  -- updated_at changes only when the USER changes the config — engine state writes don't touch it.
  -- 0041: notify_price_hike is part of the config; a change also forgets the hike edge.
  if (new.target_price, new.drop_pct, new.notify_low, new.min_deal_score, new.notify_back_in_stock,
      new.notify_price_hike)
     is distinct from
     (old.target_price, old.drop_pct, old.notify_low, old.min_deal_score, old.notify_back_in_stock,
      old.notify_price_hike)
  then
    new.cond_state := '{}'::jsonb;
    new.last_alert_price := null;
    new.hike_active := null;
    new.config_version := old.config_version + 1;
    new.updated_at := now();
  elsif (new.channels, new.status) is distinct from (old.channels, old.status) then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.record_watch_evaluation(
  p_watch_id uuid, p_config_version integer, p_now timestamptz, p_state jsonb, p_event jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare v_event_id uuid; v_ch text;
begin
  update watches set
    last_evaluated_at = p_now,
    cond_state        = coalesce(p_state->'cond_state', cond_state),
    last_in_stock     = coalesce((p_state->>'last_in_stock')::boolean, last_in_stock),
    baseline_price    = coalesce((p_state->>'baseline_price')::numeric, baseline_price),
    last_alert_price  = case when p_state ? 'alerted'
                             then (p_state->'alerted'->>'price')::numeric else last_alert_price end,
    last_alerted_at   = case when p_state ? 'alerted'
                             then (p_state->'alerted'->>'at')::timestamptz else last_alerted_at end,
    -- 0041: price-hike edge and its own cooldown clock.
    hike_active          = case when p_state ? 'hike_active'
                                then (p_state->>'hike_active')::boolean else hike_active end,
    last_hike_alerted_at = case when p_state ? 'hike_alerted_at'
                                then (p_state->>'hike_alerted_at')::timestamptz else last_hike_alerted_at end
  where id = p_watch_id and config_version = p_config_version and status = 'active';

  if not found or p_event is null then
    return null;
  end if;

  insert into alert_events (watch_id, trigger_types, price, offer_id, baseline_price,
                            previous_alert_price, deal_score, recommendation, score_reasons,
                            deliver_after, created_at, reference_price)
  values (p_watch_id,
          array(select jsonb_array_elements_text(p_event->'trigger_types')),
          (p_event->>'price')::numeric, (p_event->>'offer_id')::uuid,
          (p_event->>'baseline_price')::numeric, (p_event->>'previous_alert_price')::numeric,
          (p_event->>'deal_score')::smallint,
          p_event->>'recommendation',
          array(select jsonb_array_elements_text(coalesce(p_event->'score_reasons','[]'))),
          (p_event->>'deliver_after')::timestamptz, p_now,
          (p_event->>'reference_price')::numeric)
  returning id into v_event_id;

  for v_ch in select jsonb_array_elements_text(p_event->'channels') loop
    insert into alert_deliveries (alert_event_id, channel, next_attempt_at)
    values (v_event_id, v_ch, (p_event->>'deliver_after')::timestamptz);
  end loop;

  return v_event_id;
end $$;

-- Column grants: the user may set the opt-in; hike_active / last_hike_alerted_at stay service-role only.
grant insert (notify_price_hike) on public.watches to authenticated;
grant update (notify_price_hike) on public.watches to authenticated;
