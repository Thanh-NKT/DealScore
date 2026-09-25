-- 0009_collector_backtest.sql: collector (1.10), weekly backtest (1.10)

-- ============================================================================
-- 1. collector_candidates — listings the collector may refresh, most overdue first
-- ============================================================================
-- The app re-applies the same rule (src/lib/collector/schedule.ts); this only narrows the pool.
-- Intervals must match REFRESH_INTERVAL_HOURS: priority 1 = 2h, 2 = 6h, 3 = 24h, watched = 2h.
create or replace function public.collector_candidates(p_limit integer)
returns table (id uuid, external_item_id text, refresh_priority integer,
               last_observed_at timestamptz, watched boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.external_item_id, l.refresh_priority, l.last_observed_at, w.watched
  from listings l
  cross join lateral (
    select exists (
      select 1 from offers o
      join watches wt on wt.variant_id = o.variant_id and wt.status = 'active'
      where o.listing_id = l.id
    ) as watched
  ) w
  where l.marketplace = 'shopee' and l.status = 'active'
  order by case
             when l.last_observed_at is null then 1e9
             else extract(epoch from (now() - l.last_observed_at)) / 3600.0
                  / case when w.watched or l.refresh_priority <= 1 then 2
                         when l.refresh_priority = 2 then 6
                         else 24 end
           end desc
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.collector_candidates(integer) from public, anon, authenticated;
grant execute on function public.collector_candidates(integer) to service_role;

-- ============================================================================
-- 2. record_observations — write one listing's collected prices
-- ============================================================================
-- Payload: { listing_id, run_id, observed_at, source: 'api'|'seed', status: 'active'|'gone',
--            models: [ { model_id, price, original_price, stock, is_flash_sale } ] }
-- observed_at is the REAL observation time (§6 contract), not the write time.
-- A model never seen before becomes a new unmatched offer (variant_id null, 'pending').
-- Returns the variant ids touched (for refresh / Deal Score / Watch evaluation).
create or replace function public.record_observations(p jsonb)
returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  v_listing  uuid := (p->>'listing_id')::uuid;
  v_run      uuid := nullif(p->>'run_id', '')::uuid;
  v_at       timestamptz := coalesce(nullif(p->>'observed_at', '')::timestamptz, now());
  v_source   text := coalesce(p->>'source', 'api');
  v_touched  uuid[] := '{}';
  v_offer    uuid;
  v_variant  uuid;
  v_price    numeric;
  m          jsonb;
begin
  if v_listing is null then
    raise exception 'record_observations: thiếu listing_id';
  end if;

  if p->>'status' = 'gone' then
    update listings set status = 'inactive', last_observed_at = v_at where id = v_listing;
    select coalesce(array_agg(distinct o.variant_id), '{}') into v_touched
    from offers o where o.listing_id = v_listing and o.variant_id is not null;
    perform refresh_variant_current_price(v_touched);
    return v_touched;
  end if;

  if jsonb_typeof(p->'models') <> 'array' then
    raise exception 'record_observations: models phải là mảng';
  end if;

  for m in select * from jsonb_array_elements(p->'models') loop
    if coalesce(m->>'model_id', '') = '' then
      raise exception 'record_observations: model thiếu model_id';
    end if;

    insert into offers as o (listing_id, external_model_id, match_status)
    values (v_listing, m->>'model_id', 'pending')
    on conflict (listing_id, external_model_id) do update set listing_id = excluded.listing_id
    returning o.id, o.variant_id into v_offer, v_variant;

    v_price := nullif(m->>'price', '')::numeric;
    insert into price_observations (offer_id, observed_at, price, original_price, stock,
                                    is_flash_sale, is_valid, invalid_reason, source,
                                    collector_run_id)
    values (v_offer, v_at, v_price, nullif(m->>'original_price', '')::numeric,
            nullif(m->>'stock', '')::integer,
            coalesce((m->>'is_flash_sale')::boolean, false),
            v_price is not null and v_price > 0,
            case when v_price is null or v_price <= 0 then 'no_price' end,
            v_source, v_run);

    if v_variant is not null and not (v_variant = any(v_touched)) then
      v_touched := array_append(v_touched, v_variant);
    end if;
  end loop;

  update listings set last_observed_at = v_at, status = 'active' where id = v_listing;
  perform refresh_variant_current_price(v_touched);
  return v_touched;
end $$;

revoke execute on function public.record_observations(jsonb) from public, anon, authenticated;
grant execute on function public.record_observations(jsonb) to service_role;

-- ============================================================================
-- 3. backtest_runs — weekly Buy/Wait/Avoid accuracy (G2 gate ≥ 80%)
-- ============================================================================
create table if not exists public.backtest_runs (
  id             uuid primary key default gen_random_uuid(),
  ran_at         timestamptz not null default now(),
  horizon_days   integer not null,
  drop_threshold numeric(5,4) not null,
  variants       integer not null,
  samples        integer not null,
  buy_n          integer not null,
  buy_correct    integer not null,
  wait_n         integer not null,
  wait_correct   integer not null,
  avoid_n        integer not null,
  avoid_correct  integer not null,
  accuracy       numeric(5,4)
);
alter table public.backtest_runs enable row level security;
revoke all on public.backtest_runs from anon, authenticated;

-- ============================================================================
-- 4. Schedules (same Vault pattern as 0006)
-- ============================================================================
select cron.schedule('kairo-collector', '17 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kairo_app_url')
               || '/api/cron/collector',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'kairo_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

-- 03:00 Monday, Vietnam time (= 20:00 Sunday UTC).
select cron.schedule('kairo-backtest', '0 20 * * 0', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kairo_app_url')
               || '/api/cron/backtest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'kairo_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
