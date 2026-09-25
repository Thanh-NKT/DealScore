-- 0011_phase2_discovery.sql: Phase 2 group A
-- 1. backtest_runs.version (v0 and v1 are backtested side by side)
-- 2. price_drop_radar(): real drops vs the 30-day median
-- 3. trending_products(): most watched / rising views — aggregate counts only
-- 4. analytics events for sharing

-- ============================================================================
-- 1. Backtest per Deal Score version
-- ============================================================================
alter table public.backtest_runs add column if not exists version text not null default 'v0'
  check (version in ('v0', 'v1'));

-- ============================================================================
-- 2. Price Drop Radar
-- ============================================================================
-- Compared with the REAL 30-day median of daily lows, not the marketplace "list price":
-- an inflated list price can never put a product on the radar.
create or replace function public.price_drop_radar(
  p_min_drop    numeric default 0.10,
  p_category_id uuid    default null,
  p_limit       integer default 24,
  p_offset      integer default 0
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  variant_id uuid, variant_key text, median_30d numeric, drop_pct numeric,
  total_count bigint
) language sql stable as $$
  with today as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as d),
  med as (
    select vdp.variant_id,
           percentile_cont(0.5) within group (order by vdp.min_price) as m
    from variant_daily_prices vdp
    where vdp.min_price is not null
      and vdp.day >  (select d from today) - 30
      and vdp.day <= (select d from today)
    group by vdp.variant_id
    having count(*) >= 10
  ),
  drops as (
    select distinct on (p.id)
           p.id as product_id, p.slug, p.canonical_name, p.brand, p.image,
           c.slug as category_slug,
           vcp.price, vcp.original_price, vcp.observed_at,
           v.id as variant_id, v.variant_key,
           med.m::numeric as median_30d,
           round(1 - vcp.price / med.m::numeric, 4) as drop_pct
    from variant_current_price vcp
    join med               on med.variant_id = vcp.variant_id
    join product_variants v on v.id = vcp.variant_id
    join products p        on p.id = v.product_id and p.status = 'verified'
    left join categories c on c.id = p.category_id
    where vcp.in_stock
      and vcp.price > 0
      and vcp.observed_at > now() - interval '48 hours'
      and (p_category_id is null or p.category_id = p_category_id)
      and 1 - vcp.price / med.m::numeric >= p_min_drop
    order by p.id, 1 - vcp.price / med.m::numeric desc
  )
  select d.product_id, d.slug, d.canonical_name, d.brand, d.image, d.category_slug,
         d.price, d.original_price, vds.score, vds.recommendation, d.observed_at,
         d.variant_id, d.variant_key, round(d.median_30d, 0), d.drop_pct,
         count(*) over () as total_count
  from drops d
  left join variant_deal_scores vds on vds.variant_id = d.variant_id
  order by d.drop_pct desc, d.product_id
  limit p_limit offset p_offset
$$;

grant execute on function public.price_drop_radar(numeric, uuid, integer, integer) to anon, authenticated;

-- ============================================================================
-- 3. Trending / Most Watched
-- ============================================================================
-- security definer: reads watches (RLS) and analytics_events (service only), but returns ONLY
-- per-product counts above a minimum, so no single user's behaviour can be inferred.
create or replace function public.trending_products(
  p_mode        text,
  p_limit       integer default 24,
  p_category_id uuid    default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  watch_count integer, views_7d integer, views_prev_7d integer
) language plpgsql stable security definer set search_path = public as $$
begin
  if p_mode not in ('watched', 'rising') then
    raise exception 'trending_products: mode không hợp lệ: %', p_mode;
  end if;

  return query
  with counts as (
    select v.product_id, count(*)::integer as watch_count, 0 as views_7d, 0 as views_prev_7d
    from watches w
    join users u            on u.id = w.user_id and u.deleted_at is null
    join product_variants v on v.id = w.variant_id
    where p_mode = 'watched' and w.status = 'active'
    group by v.product_id
    having count(*) >= 2
    union all
    select (e.props->>'product_id')::uuid, 0,
           (count(*) filter (where e.created_at >  now() - interval '7 days'))::integer,
           (count(*) filter (where e.created_at <= now() - interval '7 days'))::integer
    from analytics_events e
    where p_mode = 'rising'
      and e.name = 'product_viewed'
      and e.created_at > now() - interval '14 days'
      and e.props->>'product_id' ~ '^[0-9a-f-]{36}$'
    group by 1
    having count(*) filter (where e.created_at > now() - interval '7 days') >= 3
       and count(*) filter (where e.created_at >  now() - interval '7 days')
         > count(*) filter (where e.created_at <= now() - interval '7 days')
  )
  select p.id, p.slug, p.canonical_name, p.brand, p.image, c.slug,
         rep.price, rep.original_price, vds.score, vds.recommendation, rep.observed_at,
         k.watch_count, k.views_7d, k.views_prev_7d
  from counts k
  join products p        on p.id = k.product_id and p.status = 'verified'
  left join categories c on c.id = p.category_id
  left join lateral (
    select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at
    from product_variants v
    join variant_current_price vcp on vcp.variant_id = v.id
    where v.product_id = p.id and vcp.price is not null
    order by vcp.in_stock desc, vcp.price asc
    limit 1
  ) rep on true
  left join variant_deal_scores vds on vds.variant_id = rep.variant_id
  where p_category_id is null or p.category_id = p_category_id
  order by
    case when p_mode = 'watched' then k.watch_count end desc nulls last,
    case when p_mode = 'rising' then k.views_7d - k.views_prev_7d end desc nulls last,
    k.views_7d desc, p.id
  limit greatest(p_limit, 0);
end $$;

revoke execute on function public.trending_products(text, integer, uuid) from public;
grant execute on function public.trending_products(text, integer, uuid) to anon, authenticated;

-- ============================================================================
-- 4. Sharing events
-- ============================================================================
alter table public.analytics_events drop constraint if exists analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'signup_completed', 'login_succeeded', 'lookup_submitted', 'search_performed',
  'product_viewed', 'watch_created', 'watch_deleted', 'push_enabled',
  'deal_shared', 'share_opened'));
