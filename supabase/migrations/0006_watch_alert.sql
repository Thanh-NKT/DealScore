-- 0006_watch_alert.sql: Watches mới, alert_events, alert_deliveries, push_subscriptions, job_locks, RPCs

alter table public.watches drop column if exists trigger_rules;

alter table public.watches
  alter column variant_id set not null,
  alter column user_id set default auth.uid(),
  add column if not exists drop_pct             smallint check (drop_pct between 1 and 90),
  add column if not exists notify_low           boolean not null default false,
  add column if not exists min_deal_score       smallint check (min_deal_score between 1 and 100),
  add column if not exists notify_back_in_stock boolean not null default false,
  -- Trạng thái engine — chỉ service role ghi.
  add column if not exists baseline_price    numeric(14,2),
  add column if not exists cond_state        jsonb not null default '{}'::jsonb,
  add column if not exists last_alert_price  numeric(14,2),
  add column if not exists last_alerted_at   timestamptz,
  add column if not exists last_in_stock     boolean,
  add column if not exists last_evaluated_at timestamptz,
  add column if not exists config_version    integer not null default 1,
  add column if not exists updated_at        timestamptz not null default now();

alter table public.watches drop constraint if exists watches_target_positive;
alter table public.watches add constraint watches_target_positive
  check (target_price is null or target_price > 0);

alter table public.watches drop constraint if exists watches_has_condition;
alter table public.watches add constraint watches_has_condition check (
  target_price is not null or drop_pct is not null or notify_low
  or min_deal_score is not null or notify_back_in_stock
);

alter table public.watches drop constraint if exists watches_user_variant_unique;
alter table public.watches add constraint watches_user_variant_unique unique (user_id, variant_id);

create index if not exists idx_watches_eval
  on public.watches (last_evaluated_at nulls first) where status = 'active';

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
  return new;
end $$;

create or replace function public.watches_before_update()
returns trigger language plpgsql as $$
begin
  -- updated_at chỉ đổi khi NGƯỜI DÙNG đổi cấu hình — engine ghi trạng thái không làm nó đổi.
  if (new.target_price, new.drop_pct, new.notify_low, new.min_deal_score, new.notify_back_in_stock)
     is distinct from
     (old.target_price, old.drop_pct, old.notify_low, old.min_deal_score, old.notify_back_in_stock)
  then
    new.cond_state := '{}'::jsonb;
    new.last_alert_price := null;
    new.config_version := old.config_version + 1;
    new.updated_at := now();
  elsif (new.channels, new.status) is distinct from (old.channels, old.status) then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.watches_enforce_limit()
returns trigger language plpgsql as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    if (select count(*) from watches
        where user_id = new.user_id and status = 'active' and id <> new.id) >= 50 then
      raise exception 'Đã đạt giới hạn 50 Watch đang hoạt động' using errcode = 'P0050';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists watches_before_insert on public.watches;
create trigger watches_before_insert before insert on public.watches
  for each row execute function public.watches_before_insert();

drop trigger if exists watches_before_update on public.watches;
create trigger watches_before_update before update on public.watches
  for each row execute function public.watches_before_update();

drop trigger if exists watches_enforce_limit on public.watches;
create trigger watches_enforce_limit before insert or update of status on public.watches
  for each row execute function public.watches_enforce_limit();

revoke insert, update on public.watches from anon, authenticated;
grant insert (user_id, variant_id, target_price, drop_pct, notify_low, min_deal_score,
              notify_back_in_stock, channels, status)
  on public.watches to authenticated;
grant update (target_price, drop_pct, notify_low, min_deal_score,
              notify_back_in_stock, channels, status)
  on public.watches to authenticated;

alter table public.alert_events
  drop column if exists trigger_type,
  drop column if exists sent_at,
  drop column if exists channel,
  drop column if exists delivered,
  drop column if exists opened,
  drop column if exists clicked;

alter table public.alert_events
  add column if not exists trigger_types  text[] not null default '{}',
  add column if not exists offer_id       uuid references public.offers(id) on delete set null,
  add column if not exists baseline_price numeric(14,2),
  add column if not exists previous_alert_price numeric(14,2),
  add column if not exists deal_score     smallint,
  add column if not exists recommendation text,
  add column if not exists score_reasons  text[] not null default '{}',
  add column if not exists deliver_after  timestamptz not null default now(),
  add column if not exists created_at     timestamptz not null default now();

alter table public.alert_events drop constraint if exists alert_trigger_types_valid;
alter table public.alert_events add constraint alert_trigger_types_valid check (
  cardinality(trigger_types) > 0 and trigger_types <@
  array['target_price','drop_pct','low','deal_score','back_in_stock','deeper_drop']::text[]
);
create index if not exists idx_alert_events_watch_time on public.alert_events (watch_id, created_at desc);

create table if not exists public.alert_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  alert_event_id      uuid not null references public.alert_events(id) on delete cascade,
  channel             text not null check (channel in ('email','push')),
  status              text not null default 'pending'
                      check (status in ('pending','sending','sent','failed','skipped')),
  attempts            smallint not null default 0,
  next_attempt_at     timestamptz not null,
  claimed_at          timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  skip_reason         text,
  last_error          text,
  unique (alert_event_id, channel)
);
create index if not exists idx_deliveries_due on public.alert_deliveries (next_attempt_at)
  where status in ('pending','sending');

alter table public.alert_deliveries enable row level security;
drop policy if exists "deliveries_owner_select" on public.alert_deliveries;
create policy "deliveries_owner_select" on public.alert_deliveries for select using (
  exists (select 1 from alert_events e join watches w on w.id = e.watch_id
          where e.id = alert_deliveries.alert_event_id and w.user_id = auth.uid())
);
grant select on public.alert_deliveries to authenticated;

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  failure_count smallint not null default 0,
  created_at    timestamptz not null default now(),
  last_success_at timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_owner_all" on public.push_subscriptions;
create policy "push_owner_all" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, delete on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent) on public.push_subscriptions to authenticated;

alter table public.click_events
  add column if not exists alert_event_id uuid references public.alert_events(id) on delete set null;

create or replace view public.alert_click_rate_daily
with (security_invoker = true) as
select (e.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
       count(*)                                              as alerts_sent,
       count(*) filter (where exists (select 1 from click_events c
                                      where c.alert_event_id = e.id)) as alerts_clicked
from alert_events e
where exists (select 1 from alert_deliveries d where d.alert_event_id = e.id and d.status = 'sent')
group by 1;
revoke all on public.alert_click_rate_daily from anon, authenticated;

create table if not exists public.job_locks (
  name         text primary key,
  owner        text,
  locked_until timestamptz not null default '-infinity'
);
alter table public.job_locks enable row level security;

create or replace function public.try_acquire_job_lock(p_name text, p_owner text, p_ttl_seconds integer)
returns boolean language sql as $$
  insert into job_locks as j (name, owner, locked_until)
  values (p_name, p_owner, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set owner = excluded.owner, locked_until = excluded.locked_until
    where j.locked_until < now()
  returning true
$$;

create or replace function public.release_job_lock(p_name text, p_owner text)
returns void language sql as $$
  update job_locks set locked_until = '-infinity' where name = p_name and owner = p_owner
$$;

create or replace function public.record_watch_evaluation(
  p_watch_id uuid, p_config_version integer, p_now timestamptz,
  p_state jsonb, p_event jsonb
) returns uuid language plpgsql as $$
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
                             then (p_state->'alerted'->>'at')::timestamptz else last_alerted_at end
  where id = p_watch_id and config_version = p_config_version and status = 'active';

  if not found or p_event is null then
    return null;
  end if;

  insert into alert_events (watch_id, trigger_types, price, offer_id, baseline_price,
                            previous_alert_price, deal_score, recommendation, score_reasons,
                            deliver_after, created_at)
  values (p_watch_id,
          array(select jsonb_array_elements_text(p_event->'trigger_types')),
          (p_event->>'price')::numeric, (p_event->>'offer_id')::uuid,
          (p_event->>'baseline_price')::numeric, (p_event->>'previous_alert_price')::numeric,
          (p_event->>'deal_score')::smallint,
          p_event->>'recommendation',
          array(select jsonb_array_elements_text(coalesce(p_event->'score_reasons','[]'))),
          (p_event->>'deliver_after')::timestamptz, p_now)
  returning id into v_event_id;

  for v_ch in select jsonb_array_elements_text(p_event->'channels') loop
    insert into alert_deliveries (alert_event_id, channel, next_attempt_at)
    values (v_event_id, v_ch, (p_event->>'deliver_after')::timestamptz);
  end loop;

  return v_event_id;
end $$;

create or replace function public.claim_due_deliveries(p_now timestamptz, p_limit integer)
returns table (delivery_id uuid, channel text, attempts smallint,
               alert_event_id uuid, watch_id uuid, user_id uuid)
language sql as $$
  with due as (
    select d.id from alert_deliveries d
    where (d.status = 'pending' and d.next_attempt_at <= p_now)
       or (d.status = 'sending' and d.claimed_at < p_now - interval '15 minutes')
    order by d.next_attempt_at
    limit p_limit
    for update skip locked
  )
  update alert_deliveries d set status = 'sending', claimed_at = p_now
  from due, alert_events e, watches w
  where d.id = due.id and e.id = d.alert_event_id and w.id = e.watch_id
  returning d.id, d.channel, d.attempts, e.id, w.id, w.user_id
$$;

revoke execute on function public.record_watch_evaluation(uuid, integer, timestamptz, jsonb, jsonb),
                           public.claim_due_deliveries(timestamptz, integer),
                           public.try_acquire_job_lock(text, text, integer),
                           public.release_job_lock(text, text)
  from public, anon, authenticated;
grant execute on function public.record_watch_evaluation(uuid, integer, timestamptz, jsonb, jsonb),
                          public.claim_due_deliveries(timestamptz, integer),
                          public.try_acquire_job_lock(text, text, integer),
                          public.release_job_lock(text, text)
  to service_role;

-- ---------------------------------------------------------- pg_cron + pg_net
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- Alert Engine mỗi 15 phút.
-- URL và secret đọc từ Vault LÚC CHẠY: mỗi môi trường tự đặt, không nằm trong repo.
-- Thiếu secret → http_post lỗi, job ghi lỗi vào cron.job_run_details, không ảnh hưởng gì khác.
select cron.schedule('kairo-alerts', '*/15 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kairo_app_url')
               || '/api/cron/alerts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'kairo_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
