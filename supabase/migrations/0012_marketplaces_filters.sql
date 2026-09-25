-- 0012_marketplaces_filters.sql: Phase 2 groups B/C
-- 1. collector_candidates per configured marketplace
-- 2. offers.free_shipping / has_voucher (+ record_observations writes them)
-- 3. search_products v4: seller rating / free shipping / voucher filters; filter_availability()
-- 4. metrics_matching_quality view

-- ============================================================================
-- 1. Collector candidates for the marketplaces the app can refresh
-- ============================================================================
drop function if exists public.collector_candidates(integer);

create or replace function public.collector_candidates(p_limit integer, p_marketplaces text[] default array['shopee'])
returns table (id uuid, marketplace text, external_item_id text, refresh_priority integer,
               last_observed_at timestamptz, watched boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.marketplace, l.external_item_id, l.refresh_priority, l.last_observed_at, w.watched
  from listings l
  cross join lateral (
    select exists (
      select 1 from offers o
      join watches wt on wt.variant_id = o.variant_id and wt.status = 'active'
      where o.listing_id = l.id
    ) as watched
  ) w
  where l.marketplace = any(p_marketplaces) and l.status = 'active'
  order by case
             when l.last_observed_at is null then 1e9
             else extract(epoch from (now() - l.last_observed_at)) / 3600.0
                  / case when w.watched or l.refresh_priority <= 1 then 2
                         when l.refresh_priority = 2 then 6
                         else 24 end
           end desc
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.collector_candidates(integer, text[]) from public, anon, authenticated;
grant execute on function public.collector_candidates(integer, text[]) to service_role;

-- ============================================================================
-- 2. Free shipping / voucher on the offer (null = unknown)
-- ============================================================================
alter table public.offers
  add column if not exists free_shipping boolean,
  add column if not exists has_voucher boolean;

-- Same as 0009, plus: a model may carry free_shipping / has_voucher; null leaves the stored value.
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

    insert into offers as o (listing_id, external_model_id, match_status, free_shipping, has_voucher)
    values (v_listing, m->>'model_id', 'pending',
            (m->>'free_shipping')::boolean, (m->>'has_voucher')::boolean)
    on conflict (listing_id, external_model_id) do update set
      free_shipping = coalesce(excluded.free_shipping, o.free_shipping),
      has_voucher   = coalesce(excluded.has_voucher, o.has_voucher)
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
-- 3. search_products v4 — advanced filters on the representative variant's best offer
-- ============================================================================
drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer);

select public.word_similarity('a', 'a');

create function public.search_products(
  p_q             text    default null,
  p_category_id   uuid    default null,
  p_brands        text[]  default null,
  p_min_price     numeric default null,
  p_max_price     numeric default null,
  p_sort          text    default 'relevance',
  p_limit         integer default 24,
  p_offset        integer default 0,
  p_min_rating    numeric default null,
  p_free_shipping boolean default null,
  p_has_voucher   boolean default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint
) language sql stable
set pg_trgm.word_similarity_threshold = 0.4
as $$
  with norm as (
    select btrim(public.f_unaccent(lower(coalesce(p_q, '')))) as q
  ),
  tsq as (
    select case when (select q from norm) = '' then null
           else to_tsquery('simple',
                  array_to_string(
                    array(select t || ':*'
                          from regexp_split_to_table(
                                 btrim(regexp_replace((select q from norm), '[^a-z0-9]+', ' ', 'g')),
                                 '\s+') t
                          where t <> ''), ' & ')) end as tq
  ),
  matched as (
    select p.*,
           case
             when (select q from norm) = '' then 0::real
             when (select tq from tsq) is not null
                  and to_tsvector('simple', p.search_text) @@ (select tq from tsq)
               then ts_rank(to_tsvector('simple', p.search_text), (select tq from tsq)) + 1.0
             else word_similarity((select q from norm), p.search_text)
           end as rel
    from products p
    where (p_category_id is null or p.category_id = p_category_id)
      and (p_brands is null or lower(p.brand) = any(array(select lower(b) from unnest(p_brands) b)))
      and ((select q from norm) = ''
           or ((select tq from tsq) is not null
               and to_tsvector('simple', p.search_text) @@ (select tq from tsq))
           or p.search_text %> (select q from norm))
  ),
  priced as (
    select m.id, m.slug, m.canonical_name, m.brand, m.image, m.rel,
           c.slug as category_slug,
           rep.price, rep.original_price, rep.observed_at,
           vds.score, vds.recommendation,
           bo.free_shipping, bo.has_voucher, s.rating as seller_rating
    from matched m
    left join categories c on c.id = m.category_id
    left join lateral (
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = m.id and vcp.price is not null
      order by vcp.in_stock desc, vcp.price asc
      limit 1
    ) rep on true
    left join variant_deal_scores vds on vds.variant_id = rep.variant_id
    left join offers bo   on bo.id = rep.best_offer_id
    left join listings bl on bl.id = bo.listing_id
    left join sellers s   on s.id = bl.seller_id
    where (p_min_price is null or rep.price >= p_min_price)
      and (p_max_price is null or rep.price <= p_max_price)
      and (p_min_rating is null or s.rating >= p_min_rating)
      and (p_free_shipping is null or not p_free_shipping or bo.free_shipping is true)
      and (p_has_voucher is null or not p_has_voucher or bo.has_voucher is true)
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count
  from priced
  order by
    case when p_sort = 'price_asc'  then price       end asc  nulls last,
    case when p_sort = 'price_desc' then price       end desc nulls last,
    case when p_sort = 'deal_score' then score       end desc nulls last,
    case when p_sort = 'updated'    then observed_at end desc nulls last,
    case when p_sort = 'relevance'  then rel         end desc nulls last,
    id
  limit p_limit offset p_offset
$$;

-- Which advanced filters have any data behind them (the UI hides empty ones).
create or replace function public.filter_availability()
returns table (rating boolean, free_shipping boolean, voucher boolean)
language sql stable as $$
  select exists (select 1 from sellers where rating is not null),
         exists (select 1 from offers where free_shipping is not null),
         exists (select 1 from offers where has_voucher is not null)
$$;

-- ============================================================================
-- 4. Matching quality (service role; the dashboard belongs to Admin)
-- ============================================================================
create or replace view public.metrics_matching_quality with (security_invoker = true) as
select l.marketplace,
       count(*)::integer                                              as offers,
       count(*) filter (where o.match_status = 'auto')::integer       as auto,
       count(*) filter (where o.match_status = 'manual')::integer     as manual,
       count(*) filter (where o.match_status = 'pending')::integer    as pending,
       count(*) filter (where o.match_status = 'rejected')::integer   as rejected,
       (select count(*) from match_candidates mc join offers o2 on o2.id = mc.offer_id
          join listings l2 on l2.id = o2.listing_id
          where l2.marketplace = l.marketplace and mc.decision = 'accepted')::integer as suggestions_accepted,
       (select count(*) from match_candidates mc join offers o2 on o2.id = mc.offer_id
          join listings l2 on l2.id = o2.listing_id
          where l2.marketplace = l.marketplace and mc.decision in ('accepted', 'rejected'))::integer as suggestions_reviewed
from offers o
join listings l on l.id = o.listing_id
group by l.marketplace;

revoke all on public.metrics_matching_quality from anon, authenticated;
