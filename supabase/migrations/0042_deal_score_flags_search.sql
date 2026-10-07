-- 0042 — Card flags (roadmap P2 items 1, 2, 3).
--
-- 1. variant_deal_scores.fake_sale: the fake-sale kind of the variant's best offer (price + list price),
--    written by recomputeDealScores() from TS (fakeSaleForPrice — the same function the product page uses
--    per offer). No heuristic lives in SQL (Đ5). null = no sign, or the history check could not run.
-- 2. search_products v14, from the 0031 body: new trailing parameter p_only_buy ("Chỉ hiện Nên mua") and two
--    new columns at the end, offer_count (the representative's variant_current_price.offer_count) and
--    fake_sale (shown only while price_at_compute = the card's price, like score). The return type changes,
--    so the old signature is dropped and the function re-created with the same SET clauses and grants.
--    Everything else (both arms, term groups by index, draft ≥ 2 shops, visibility, capacity
--    representative, ordering) is the 0031 body unchanged.
--    price_drop_radar / trending_products are not changed (their cards carry no shop count / fake-sale flag).

alter table public.variant_deal_scores
  add column if not exists fake_sale text
  check (fake_sale in ('list_inflated', 'pre_sale_hike'));

select public.word_similarity('a', 'a');

drop function public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[], jsonb);

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
  p_boost_terms   text[]  default null,
  p_term_groups   jsonb   default null,
  p_only_buy      boolean default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint, effective_price numeric, variant_id uuid,
  marketplace text, is_flash_sale boolean, offer_count integer, fake_sale text
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
  -- The plain query, exactly as v11: every word of p_q a prefix, AND-ed.
  exact as (
    select case when (select q from norm) = '' then null
           else to_tsquery('simple',
                  array_to_string(
                    array(select t || ':*'
                          from regexp_split_to_table(
                                 btrim(regexp_replace((select q from norm), '[^a-z0-9]+', ' ', 'g')),
                                 '\s+') t
                          where t <> ''), ' & ')) end as tq
  ),
  -- Synonym groups → "(a:* <-> b:* | c:*) & (d:*)". Each alternative is folded and split on
  -- [^a-z0-9]+ like p_q, so the string handed to to_tsquery only ever holds those words and the
  -- operators written here. A group element may be an array of strings or a single string.
  -- 0031: only the first 10 groups / 6 alternatives are ever read. They are fetched by index
  -- (generate_series + ->), so the rest of an oversized p_term_groups is never expanded into rows.
  tg as (
    select case when jsonb_typeof(p_term_groups) = 'array' then p_term_groups end as j
  ),
  grp as (
    select case when (select j from tg) is not null then (
             select string_agg('(' || g.alts || ')', ' & ' order by g.ord)
             from (
               select gi.i + 1 as ord,
                      (select string_agg(a.phrase, ' | ' order by a.ord)
                       from (
                         select ai.i + 1 as ord,
                                (select string_agg(w.word || ':*', ' <-> ' order by w.pos)
                                 from regexp_split_to_table(
                                        btrim(regexp_replace(public.f_unaccent(lower(left(ga.arr ->> ai.i, 100))), '[^a-z0-9]+', ' ', 'g')),
                                        '\s+') with ordinality as w(word, pos)
                                 where w.word <> '' and w.pos <= 8) as phrase
                         from generate_series(0, least(jsonb_array_length(ga.arr), 6) - 1) as ai(i)
                       ) a
                       where a.phrase is not null) as alts
               from generate_series(0, least(jsonb_array_length((select j from tg)), 10) - 1) as gi(i)
               cross join lateral (
                 select case jsonb_typeof((select j from tg) -> gi.i)
                          when 'array'  then (select j from tg) -> gi.i
                          when 'string' then jsonb_build_array((select j from tg) -> gi.i)
                          else '[]'::jsonb end as arr
               ) ga
             ) g
             where g.alts is not null)
           end as src
  ),
  tsq as (
    select e.tq as exact_tq,
           gq.tq is not null as has_groups,
           case when gq.tq is null then e.tq
                when e.tq is null  then gq.tq
                else gq.tq || e.tq end as match_tq
    from exact e
    cross join (select case when src is null then null else to_tsquery('simple', src) end as tq from grp) gq
  ),
  mode as (
    select (select q from norm) = '' and (select match_tq from tsq) is null as browse
  ),
  -- Two arms, each behind a one-time filter, so the keyword arm can use the FTS / trigram indexes
  -- (see the header). Exactly one arm runs.
  matched as (
    select p.*, 0::real as rel
    from products p
    where (select browse from mode)
    union all
    select p.*,
           case
             when (select match_tq from tsq) is not null
                  and to_tsvector('simple', p.search_text) @@ (select match_tq from tsq)
               then ts_rank(to_tsvector('simple', p.search_text), (select match_tq from tsq)) + 1.0
                    -- exact > synonym: only when groups were sent, so v11 relevance is unchanged otherwise.
                    + case when (select has_groups from tsq)
                                and (select exact_tq from tsq) is not null
                                and to_tsvector('simple', p.search_text) @@ (select exact_tq from tsq)
                           then 0.5 else 0 end
             else word_similarity((select q from norm), p.search_text)
           end::real as rel
    from products p
    where not (select browse from mode)
      and (to_tsvector('simple', p.search_text) @@ (select match_tq from tsq)
           or p.search_text %> (select q from norm))
  ),
  kept as (
    select m.*
    from matched m
    where (p_category_id is null or m.category_id = p_category_id)
      and (p_brands is null or (select lower(m.brand) = any(a.brands) from args a))
      and (p_marketplaces is null or cardinality(p_marketplaces) = 0 or exists (
             select 1
             from product_variants v
             join offers o   on o.variant_id = v.id
             join listings l on l.id = o.listing_id
             where v.product_id = m.id
               and offer_is_visible(o.match_status, l.status, m.status)
               and (select l.marketplace = any(a.markets) from args a)))
      -- Drafts only once at least two shops sell them (spec §2.3): a lone draft is noise.
      and (m.status = 'verified' or (
             select count(*) from (
               select distinct l.id
               from product_variants v
               join offers o   on o.variant_id = v.id
               join listings l on l.id = o.listing_id
               where v.product_id = m.id
                 and offer_is_visible(o.match_status, l.status, m.status)
               limit 2) two) >= 2)
  ),
  boost as (
    select bt.term
    from (select btrim(lower(public.f_unaccent(t))) as term from unnest(p_boost_terms[1:10]) t) bt
    where bt.term <> ''
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
           -- 0042: shop count of the representative variant and the cached fake-sale kind (same price guard).
           rep.offer_count,
           case when vds.price_at_compute = rep.price then vds.fake_sale end      as fake_sale,
           bo.free_shipping, bo.has_voucher, s.rating as seller_rating,
           -- Shown only when it still describes the current price: lower than it, computed from the
           -- representative's current observation or later (a newer observation = the price changed
           -- since), within 7 days, and before any voucher of the combination expires.
           case when bo.effective_price < rep.price
                 and bo.effective_price_at >= rep.observed_at
                 and bo.effective_price_at > now() - interval '7 days'
                 and (bo.effective_price_until is null or bo.effective_price_until > now())
                then bo.effective_price end as effective_price
    from kept m
    left join categories c on c.id = m.category_id
    left join lateral (
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id, vcp.is_flash_sale,
             vcp.offer_count
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
      -- 0042 "Chỉ hiện Nên mua": only a cached buy verdict that still describes the card's price.
      and (p_only_buy is not true or (vds.price_at_compute = rep.price and vds.recommendation = 'buy'))
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count, effective_price, variant_id,
         marketplace, is_flash_sale, offer_count, fake_sale
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

grant execute on function public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[], jsonb, boolean)
  to anon, authenticated;
