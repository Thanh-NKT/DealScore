-- 0051 — Price-anomaly queue (roadmap P3 item 10).
--
-- 1. price_anomalies: one row per suspicious observation, with a review state, so a price the admin kept
--    ("Giá đúng — giữ lại") is never queued again. RLS on, nothing granted to anon / authenticated.
-- 2. detect_price_anomalies(): pipeline step (the collector after record_observations, and the admin
--    "Quét lại" through POST /api/admin/price-anomalies/scan). An observation is a spike / drop against the
--    median of the same offer's own trusted, non-flash observations in the window before it. Thresholds are
--    parameters (src/lib/anomalies/constants.ts). Detection never invalidates anything and writes no audit row.
-- 3. admin_price_anomalies / admin_price_anomaly_counts: the admin queue (read-only, no audit).
-- 4. admin_review_price_anomalies: "loại bỏ" = is_valid false with invalid_reason 'admin_anomaly' (never a
--    delete); keep / reopen only restore what the admin invalidated (a 'no_price' observation stays invalid).
--    Every price reader already filters is_valid, so rebuilding the rollups (+ the Deal Score recompute the
--    app triggers with the returned variant_ids) removes the price everywhere. One audit row per change.
-- All functions: security definer, service_role only.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.price_anomalies (
  id             uuid primary key default gen_random_uuid(),
  observation_id bigint not null,
  observed_at    timestamptz not null,
  offer_id       uuid not null references public.offers(id) on delete cascade,
  kind           text not null check (kind in ('spike', 'drop')),
  price          numeric(14,2) not null,
  baseline_price numeric(14,2) not null,
  ratio          numeric(12,6) not null,          -- price / baseline_price
  baseline_obs   integer not null,
  detected_at    timestamptz not null default now(),
  status         text not null default 'open' check (status in ('open', 'invalidated', 'kept')),
  reviewed_at    timestamptz,
  review_note    text check (char_length(review_note) <= 500),
  unique (observation_id, observed_at),
  foreign key (observation_id, observed_at) references public.price_observations(id, observed_at) on delete cascade
);
create index if not exists idx_price_anomalies_status on public.price_anomalies (status, detected_at desc);
create index if not exists idx_price_anomalies_offer on public.price_anomalies (offer_id);
alter table public.price_anomalies enable row level security;
revoke all on public.price_anomalies from anon, authenticated;

-- 2 ---------------------------------------------------------------------------
create or replace function public.detect_price_anomalies(
  p_since            timestamptz,
  p_baseline_days    integer,
  p_spike_ratio      numeric,
  p_drop_ratio       numeric,
  p_min_baseline_obs integer,
  p_offer_ids        uuid[] default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if p_since is null or p_since < now() - interval '31 days'
     or p_spike_ratio is null or p_spike_ratio <= 1
     or p_drop_ratio is null or p_drop_ratio <= 0 or p_drop_ratio >= 1
     or p_baseline_days is null or p_baseline_days not between 1 and 365
     or p_min_baseline_obs is null or p_min_baseline_obs < 1 then
    raise exception 'detect_price_anomalies: tham số không hợp lệ';
  end if;

  insert into price_anomalies (observation_id, observed_at, offer_id, kind, price, baseline_price, ratio, baseline_obs)
  select po.id, po.observed_at, po.offer_id,
         case when po.price >= b.median * p_spike_ratio then 'spike' else 'drop' end,
         po.price, round(b.median::numeric, 2), least(round(po.price / b.median::numeric, 6), 999999), b.n
  from price_observations po
  join offers o            on o.id = po.offer_id
  join listings l          on l.id = o.listing_id
  join product_variants pv on pv.id = o.variant_id
  join products pr         on pr.id = pv.product_id
  -- The offer's own trusted baseline (idx_price_obs_offer_time). Extension prices never count: they are
  -- user-browser data, admitted to history only through corroboration.
  cross join lateral (
    select percentile_cont(0.5) within group (order by x.price) as median, count(*)::integer as n
    from price_observations x
    where x.offer_id = po.offer_id
      and x.is_valid and x.price is not null and x.price > 0
      and not x.is_flash_sale
      and x.source <> 'extension'
      and x.observed_at >= po.observed_at - make_interval(days => p_baseline_days)
      and x.observed_at < po.observed_at
  ) b
  where po.observed_at >= p_since
    and po.is_valid and po.price is not null and po.price > 0
    and not po.is_flash_sale
    and po.source <> 'extension'
    and (p_offer_ids is null or po.offer_id = any(p_offer_ids))
    and offer_in_history(o.match_status, pr.status, l.deactivated_by)
    and b.n >= p_min_baseline_obs and b.median > 0
    and (po.price >= b.median * p_spike_ratio or po.price <= b.median * p_drop_ratio)
  order by po.id
  -- Already queued (any status) → nothing: a kept price is never queued again.
  on conflict (observation_id, observed_at) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_price_anomalies(
  p_status      text    default 'open',
  p_kind        text    default null,
  p_marketplace text    default null,
  p_offer_id    uuid    default null,
  p_limit       integer default 50,
  p_offset      integer default 0
) returns table (
  id uuid, kind text, status text, observation_id bigint, observed_at timestamptz, price numeric,
  baseline_price numeric, ratio numeric, baseline_obs integer, observation_valid boolean, detected_at timestamptz,
  reviewed_at timestamptz, review_note text, offer_id uuid, listing_id uuid, marketplace text, listing_title text,
  listing_url text, listing_status text, seller_name text, variant_id uuid, variant_key text, product_id uuid,
  product_name text, product_status text, product_slug text, category_slug text, current_price numeric,
  watched boolean, total_count bigint
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_status is null or p_status not in ('open', 'invalidated', 'kept', 'all')
     or (p_kind is not null and p_kind not in ('spike', 'drop'))
     or (p_marketplace is not null and char_length(p_marketplace) > 20) then
    raise exception 'admin_price_anomalies: bộ lọc không hợp lệ';
  end if;

  return query
  with picked as (
    select a.*, o.listing_id as a_listing_id, o.variant_id as a_variant_id, l.marketplace as a_marketplace,
           exists (select 1 from watches w where w.variant_id = o.variant_id and w.status = 'active') as a_watched,
           greatest(a.ratio, 1 / nullif(a.ratio, 0)) as deviation,
           count(*) over () as total
    from price_anomalies a
    join offers o   on o.id = a.offer_id
    join listings l on l.id = o.listing_id
    where (p_status = 'all' or a.status = p_status)
      and (p_kind is null or a.kind = p_kind)
      and (p_marketplace is null or l.marketplace = p_marketplace)
      and (p_offer_id is null or a.offer_id = p_offer_id)
  ),
  page as (
    select * from picked pk
    order by case when p_status = 'open' then pk.a_watched end desc nulls last,
             case when p_status = 'open' then pk.deviation end desc nulls last,
             case when p_status = 'open' then pk.observed_at end desc nulls last,
             case when p_status <> 'open' then coalesce(pk.reviewed_at, pk.detected_at) end desc nulls last,
             pk.id
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    offset least(greatest(coalesce(p_offset, 0), 0), 100000)
  )
  select pg.id, pg.kind, pg.status, pg.observation_id, pg.observed_at, pg.price, pg.baseline_price, pg.ratio,
         pg.baseline_obs, po.is_valid, pg.detected_at, pg.reviewed_at, pg.review_note,
         pg.offer_id, pg.a_listing_id, pg.a_marketplace, l.title, l.url, l.status, s.name,
         pv.id, pv.variant_key, pr.id, pr.canonical_name, pr.status, pr.slug, c.slug,
         vcp.price, pg.a_watched, pg.total
  from page pg
  join listings l on l.id = pg.a_listing_id
  left join sellers s on s.id = l.seller_id
  left join price_observations po on po.id = pg.observation_id and po.observed_at = pg.observed_at
  left join product_variants pv on pv.id = pg.a_variant_id
  left join products pr on pr.id = pv.product_id
  left join categories c on c.id = pr.category_id
  left join variant_current_price vcp on vcp.variant_id = pg.a_variant_id
  order by case when p_status = 'open' then pg.a_watched end desc nulls last,
           case when p_status = 'open' then pg.deviation end desc nulls last,
           case when p_status = 'open' then pg.observed_at end desc nulls last,
           case when p_status <> 'open' then coalesce(pg.reviewed_at, pg.detected_at) end desc nulls last,
           pg.id;
end $$;

create or replace function public.admin_price_anomaly_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'open_by_kind', jsonb_build_object(
      'spike', count(*) filter (where status = 'open' and kind = 'spike'),
      'drop',  count(*) filter (where status = 'open' and kind = 'drop')),
    'invalidated_7d', count(*) filter (where status = 'invalidated' and reviewed_at > now() - interval '7 days'),
    'kept_7d',        count(*) filter (where status = 'kept' and reviewed_at > now() - interval '7 days'),
    'oldest_open_at', min(detected_at) filter (where status = 'open'))
  from price_anomalies
$$;

-- 4 ---------------------------------------------------------------------------
create or replace function public.admin_review_price_anomalies(p_ids uuid[], p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_target  text;
  v_ids     uuid[];
  v_updated integer := 0;
  v_vids    uuid[] := '{}';
  v_now_ok  boolean;
  v_changed integer;
  a         record;
begin
  if p_decision is null or p_decision not in ('invalidate', 'keep', 'reopen') then
    raise exception 'admin_review_price_anomalies: quyết định không hợp lệ';
  end if;
  if p_ids is null or coalesce(cardinality(p_ids), 0) < 1 or cardinality(p_ids) > 100 then
    raise exception 'admin_review_price_anomalies: chọn từ 1 đến 100 giá bất thường';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'admin_review_price_anomalies: ghi chú dài quá 500 ký tự';
  end if;
  v_target := case p_decision when 'invalidate' then 'invalidated' when 'keep' then 'kept' else 'open' end;
  v_ids := array(select distinct x from unnest(p_ids) x where x is not null);

  -- Locks: anomalies by id, then their observations by id.
  perform 1 from price_anomalies where id = any(v_ids) order by id for update;
  perform 1 from price_observations po
  where (po.id, po.observed_at) in (select pa.observation_id, pa.observed_at from price_anomalies pa where pa.id = any(v_ids))
  order by po.id for update;

  for a in
    select pa.*, po.is_valid as obs_valid, o.variant_id, pv.product_id
    from price_anomalies pa
    join offers o on o.id = pa.offer_id
    left join product_variants pv on pv.id = o.variant_id
    left join price_observations po on po.id = pa.observation_id and po.observed_at = pa.observed_at
    where pa.id = any(v_ids)
    order by pa.id
  loop
    continue when a.status = v_target; -- repeating a decision is a no-op: no write, no audit row

    update price_anomalies
       set status      = v_target,
           reviewed_at = case when v_target = 'open' then null else now() end,
           review_note = coalesce(v_note, review_note)
     where id = a.id;

    if v_target = 'invalidated' then
      update price_observations set is_valid = false, invalid_reason = 'admin_anomaly'
       where id = a.observation_id and observed_at = a.observed_at and is_valid;
    else
      -- Only undo the admin's own invalidation: a 'no_price' observation never becomes valid.
      update price_observations set is_valid = true, invalid_reason = null
       where id = a.observation_id and observed_at = a.observed_at and invalid_reason = 'admin_anomaly';
    end if;
    get diagnostics v_changed = row_count;
    if v_changed > 0 and a.variant_id is not null and not (a.variant_id = any(v_vids)) then
      v_vids := v_vids || a.variant_id;
    end if;
    select po.is_valid into v_now_ok from price_observations po
     where po.id = a.observation_id and po.observed_at = a.observed_at;

    perform admin_log('price_anomaly.' || p_decision, 'price_anomaly', a.id::text,
      jsonb_build_object('status', a.status, 'observation_valid', a.obs_valid, 'offer_id', a.offer_id,
                         'product_id', a.product_id, 'price', a.price, 'kind', a.kind),
      jsonb_build_object('status', v_target, 'observation_valid', v_now_ok, 'offer_id', a.offer_id,
                         'product_id', a.product_id, 'price', a.price, 'kind', a.kind),
      v_note);
    v_updated := v_updated + 1;
  end loop;

  perform admin_rebuild_variant_rollup(v_vids);
  return jsonb_build_object('updated', v_updated, 'skipped', cardinality(v_ids) - v_updated,
                            'variant_ids', to_jsonb(v_vids));
end $$;

-- 5 ---------------------------------------------------------------------------
revoke execute on function public.detect_price_anomalies(timestamptz, integer, numeric, numeric, integer, uuid[]),
                           public.admin_price_anomalies(text, text, text, uuid, integer, integer),
                           public.admin_price_anomaly_counts(),
                           public.admin_review_price_anomalies(uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.detect_price_anomalies(timestamptz, integer, numeric, numeric, integer, uuid[]),
                          public.admin_price_anomalies(text, text, text, uuid, integer, integer),
                          public.admin_price_anomaly_counts(),
                          public.admin_review_price_anomalies(uuid[], text, text)
  to service_role;
