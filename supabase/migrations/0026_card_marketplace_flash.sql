-- 0026: product cards name the marketplace of the price they show and flag a flash-sale price
-- (review-pricing-ui I3, I5).
--
-- search_products (v11), price_drop_radar and trending_products return two more columns, taken from the
-- representative variant's variant_current_price row and its best offer:
--   * marketplace   — the marketplace of the offer behind the card price (cards used to say "Shopee"
--                     for every product);
--   * is_flash_sale — the card price is a flash-sale price (the cached Deal Score leads with the
--                     flash-sale reason, the card shows a flash-sale label next to the verdict).
-- Parameters, filters, ordering and the other columns are unchanged (bodies start from 0022). A new
-- return column needs DROP + CREATE; grants are re-applied as in 0022.

drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[]);
drop function if exists public.price_drop_radar(numeric, uuid, integer, integer);
drop function if exists public.trending_products(text, integer, uuid);

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
  p_has_voucher   boolean default null,
  p_marketplaces  text[]  default null,
  p_capacity_gb   integer default null,
  p_boost_terms   text[]  default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint, effective_price numeric, variant_id uuid,
  marketplace text, is_flash_sale boolean
) language sql stable
set pg_trgm.word_similarity_threshold = 0.4
set search_path = public
as $$
  with args as (
    select least(greatest(coalesce(p_limit, 24), 1), 60)       as lim,
           least(greatest(coalesce(p_offset, 0), 0), 5000)     as off,
           array(select lower(b) from unnest(p_brands[1:20]) b) as brands,
           p_marketplaces[1:10]                                 as markets
  ),
  norm as (
    select btrim(public.f_unaccent(lower(left(coalesce(p_q, ''), 200)))) as q
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
  boost as (
    select bt.term
    from (select btrim(lower(public.f_unaccent(t))) as term from unnest(p_boost_terms[1:10]) t) bt
    where bt.term <> ''
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
      and (p_brands is null or (select lower(p.brand) = any(a.brands) from args a))
      and ((select q from norm) = ''
           or ((select tq from tsq) is not null
               and to_tsvector('simple', p.search_text) @@ (select tq from tsq))
           or p.search_text %> (select q from norm))
      and (p_marketplaces is null or cardinality(p_marketplaces) = 0 or exists (
             select 1
             from product_variants v
             join offers o   on o.variant_id = v.id
             join listings l on l.id = o.listing_id
             where v.product_id = p.id
               and offer_is_visible(o.match_status, l.status, p.status)
               and (select l.marketplace = any(a.markets) from args a)))
      -- Drafts only once at least two shops sell them (spec §2.3): a lone draft is noise.
      and (p.status = 'verified' or (
             select count(*) from (
               select distinct l.id
               from product_variants v
               join offers o   on o.variant_id = v.id
               join listings l on l.id = o.listing_id
               where v.product_id = p.id
                 and offer_is_visible(o.match_status, l.status, p.status)
               limit 2) two) >= 2)
  ),
  priced as (
    select m.id, m.slug, m.canonical_name, m.brand, m.image,
           -- Boost: + 0.5 × share of the boost terms found in search_text (already unaccented, lowercase).
           -- strpos, not LIKE: '%' / '_' in a term are plain characters.
           (m.rel + coalesce((
              select 0.5 * (count(*) filter (where strpos(m.search_text, b.term) > 0))::real / nullif(count(*), 0)
              from boost b
            ), 0)
            + case when m.status = 'verified' then 0.25 else 0 end)::real as rel,
           c.slug as category_slug,
           rep.variant_id, rep.price, rep.original_price, rep.observed_at, rep.is_flash_sale,
           bl.marketplace,
           case when vds.price_at_compute = rep.price then vds.score end          as score,
           case when vds.price_at_compute = rep.price then vds.recommendation end as recommendation,
           bo.free_shipping, bo.has_voucher, s.rating as seller_rating,
           -- Shown only when it still describes the current price: lower than it, computed from the
           -- representative's current observation or later (a newer observation = the price changed
           -- since), within 7 days, and before any voucher of the combination expires.
           case when bo.effective_price < rep.price
                 and bo.effective_price_at >= rep.observed_at
                 and bo.effective_price_at > now() - interval '7 days'
                 and (bo.effective_price_until is null or bo.effective_price_until > now())
                then bo.effective_price end as effective_price
    from matched m
    left join categories c on c.id = m.category_id
    left join lateral (
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id, vcp.is_flash_sale
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = m.id and vcp.price is not null
        -- Capacity-aware representative variant: within 3% of the requested capacity.
        and (p_capacity_gb is null
             or (v.capacity_gb is not null
                 and abs(v.capacity_gb - p_capacity_gb)::numeric / greatest(v.capacity_gb, p_capacity_gb) <= 0.03))
      order by vcp.in_stock desc, vcp.price asc
      limit 1
    ) rep on true
    left join variant_deal_scores vds on vds.variant_id = rep.variant_id
    left join offers bo   on bo.id = rep.best_offer_id
    left join listings bl on bl.id = bo.listing_id
    left join sellers s   on s.id = bl.seller_id
    where (p_capacity_gb is null or rep.variant_id is not null)
      and (p_min_price is null or rep.price >= p_min_price)
      and (p_max_price is null or rep.price <= p_max_price)
      and (p_min_rating is null or s.rating >= p_min_rating)
      and (p_free_shipping is null or not p_free_shipping or bo.free_shipping is true)
      and (p_has_voucher is null or not p_has_voucher or bo.has_voucher is true)
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count, effective_price, variant_id,
         marketplace, is_flash_sale
  from priced
  order by
    case when p_sort = 'price_asc'     then price       end asc  nulls last,
    case when p_sort = 'price_desc'    then price       end desc nulls last,
    case when p_sort = 'deal_score'    then score       end desc nulls last,
    case when p_sort = 'updated'       then observed_at end desc nulls last,
    case when p_sort = 'relevance'     then rel         end desc nulls last,
    case when p_sort = 'effective_asc' then coalesce(effective_price, price) end asc nulls last,
    id
  limit (select lim from args) offset (select off from args)
$$;

grant execute on function public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[])
  to anon, authenticated;

create function public.price_drop_radar(
  p_min_drop    numeric default 0.10,
  p_category_id uuid    default null,
  p_limit       integer default 24,
  p_offset      integer default 0
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  variant_id uuid, variant_key text, median_30d numeric, drop_pct numeric,
  total_count bigint, marketplace text, is_flash_sale boolean
) language sql stable set search_path = public as $$
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
           vcp.price, vcp.original_price, vcp.observed_at, vcp.is_flash_sale, bl.marketplace,
           v.id as variant_id, v.variant_key,
           med.m::numeric as median_30d,
           round(1 - vcp.price / med.m::numeric, 4) as drop_pct
    from variant_current_price vcp
    join med               on med.variant_id = vcp.variant_id
    join product_variants v on v.id = vcp.variant_id
    join products p        on p.id = v.product_id and p.status = 'verified'
    left join categories c on c.id = p.category_id
    left join offers bo    on bo.id = vcp.best_offer_id
    left join listings bl  on bl.id = bo.listing_id
    where vcp.in_stock
      and vcp.price > 0
      and vcp.observed_at > now() - interval '48 hours'
      and (p_category_id is null or p.category_id = p_category_id)
      and 1 - vcp.price / med.m::numeric >= p_min_drop
    order by p.id, 1 - vcp.price / med.m::numeric desc
  )
  select d.product_id, d.slug, d.canonical_name, d.brand, d.image, d.category_slug,
         d.price, d.original_price,
         case when vds.price_at_compute = d.price then vds.score end,
         case when vds.price_at_compute = d.price then vds.recommendation end,
         d.observed_at,
         d.variant_id, d.variant_key, round(d.median_30d, 0), d.drop_pct,
         count(*) over () as total_count,
         d.marketplace, d.is_flash_sale
  from drops d
  left join variant_deal_scores vds on vds.variant_id = d.variant_id
  order by d.drop_pct desc, d.product_id
  limit least(greatest(coalesce(p_limit, 24), 1), 60) offset least(greatest(coalesce(p_offset, 0), 0), 5000)
$$;

grant execute on function public.price_drop_radar(numeric, uuid, integer, integer) to anon, authenticated;

create function public.trending_products(p_mode text, p_limit integer default 24, p_category_id uuid default null)
returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  watch_count integer, views_7d integer, views_prev_7d integer,
  marketplace text, is_flash_sale boolean
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
      and e.props->>'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by 1
    having count(*) filter (where e.created_at > now() - interval '7 days') >= 3
       and count(*) filter (where e.created_at >  now() - interval '7 days')
         > count(*) filter (where e.created_at <= now() - interval '7 days')
  )
  select p.id, p.slug, p.canonical_name, p.brand, p.image, c.slug,
         rep.price, rep.original_price,
         case when vds.price_at_compute = rep.price then vds.score end,
         case when vds.price_at_compute = rep.price then vds.recommendation end,
         rep.observed_at,
         k.watch_count, k.views_7d, k.views_prev_7d,
         bl.marketplace, rep.is_flash_sale
  from counts k
  join products p        on p.id = k.product_id and p.status = 'verified'
  left join categories c on c.id = p.category_id
  left join lateral (
    select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id, vcp.is_flash_sale
    from product_variants v
    join variant_current_price vcp on vcp.variant_id = v.id
    where v.product_id = p.id and vcp.price is not null
    order by vcp.in_stock desc, vcp.price asc
    limit 1
  ) rep on true
  left join variant_deal_scores vds on vds.variant_id = rep.variant_id
  left join offers bo   on bo.id = rep.best_offer_id
  left join listings bl on bl.id = bo.listing_id
  where p_category_id is null or p.category_id = p_category_id
  order by
    case when p_mode = 'watched' then k.watch_count end desc nulls last,
    case when p_mode = 'rising' then k.views_7d - k.views_prev_7d end desc nulls last,
    k.views_7d desc, p.id
  limit least(greatest(coalesce(p_limit, 24), 0), 60);
end $$;

revoke execute on function public.trending_products(text, integer, uuid) from public;
grant execute on function public.trending_products(text, integer, uuid) to anon, authenticated;
