-- ============================================================================
-- 0003 — Fix the typo-tolerant branch of search_products
--
-- 0002 used similarity(search_text, q), which compares the WHOLE string. A short query
-- against a long document always scores low, so the fallback branch never
-- fires:
--
--   similarity('samsng', 'ban phim samsung air 100 samsung air 100') = 0.185
--   word_similarity('samsng', 'ban phim samsung air 100 samsung air 100') = 0.571
--
-- word_similarity finds the best-matching word in the document — exactly what
-- typo tolerance needs (section 1.1.b). Measured on the seed catalog:
--
--   samsng 0.571 · keychrn 0.750 · logitec 0.875 · ban phim 1.000
--   macbook pro m3 0.286 (not in the catalog) · xyzabc 0.000
--
-- A 0.4 threshold separates the two groups cleanly.
--
-- Also fixed: a whitespace-only query must be treated as no query
-- (it used to fall into the fallback branch, get filtered out and return 0 results).
-- ============================================================================

create or replace function public.search_products(
  p_q           text    default null,
  p_category_id uuid    default null,
  p_brands      text[]  default null,
  p_min_price   numeric default null,
  p_max_price   numeric default null,
  p_sort        text    default 'relevance',
  p_limit       integer default 24,
  p_offset      integer default 0
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint
) language sql stable as $$
  with norm as (
    -- btrim: '   ' must be equivalent to no query.
    select btrim(public.f_unaccent(lower(coalesce(p_q, '')))) as q
  ),
  tsq as (
    -- Build the tsquery SAFELY: keep only [a-z0-9] tokens, append :* and join with &.
    -- Concatenating user input straight into to_tsquery throws on ! & ( ...
    select case when (select q from norm) = '' then null
           else to_tsquery('simple',
                  array_to_string(
                    array(select t || ':*'
                          from regexp_split_to_table((select q from norm), '\s+') t
                          where t ~ '^[a-z0-9]+$'), ' & ')) end as tq
  ),
  base as (
    select p.id, p.slug, p.canonical_name, p.brand, p.image, p.search_text,
           c.slug as category_slug,
           vcp.price, vcp.original_price, vcp.observed_at,
           vds.score, vds.recommendation
    from products p
    left join categories c on c.id = p.category_id
    left join lateral (
      select vcp.price, vcp.original_price, vcp.observed_at
      from product_variants v
      join variant_current_price vcp on vcp.variant_id = v.id
      where v.product_id = p.id and vcp.price is not null
      order by vcp.price asc limit 1
    ) vcp on true
    left join lateral (
      select vds.score, vds.recommendation
      from product_variants v
      join variant_deal_scores vds on vds.variant_id = v.id
      where v.product_id = p.id
      order by vds.score desc nulls last limit 1
    ) vds on true
    where (p_category_id is null or p.category_id = p_category_id)
      and (p_brands     is null or p.brand = any(p_brands))
      and (p_min_price  is null or vcp.price >= p_min_price)
      and (p_max_price  is null or vcp.price <= p_max_price)
  ),
  scored as (
    select b.*,
           case
             when (select tq from tsq) is null then 0::real
             when to_tsvector('simple', b.search_text) @@ (select tq from tsq)
               then ts_rank(to_tsvector('simple', b.search_text), (select tq from tsq)) + 1.0
             -- Typo-tolerant branch. Argument order matters:
             -- word_similarity(<query>, <document>).
             else word_similarity((select q from norm), b.search_text)
           end as rel
    from base b
  ),
  filtered as (
    select * from scored
    where (select q from norm) = '' or rel > 0.4
  )
  select id, slug, canonical_name, brand, image, category_slug,
         price, original_price, score, recommendation, observed_at,
         rel, count(*) over () as total_count
  from filtered
  order by
    case when p_sort = 'price_asc'  then price       end asc  nulls last,
    case when p_sort = 'price_desc' then price       end desc nulls last,
    case when p_sort = 'deal_score' then score       end desc nulls last,
    case when p_sort = 'updated'    then observed_at end desc nulls last,
    case when p_sort = 'relevance'  then rel         end desc nulls last,
    id
  limit p_limit offset p_offset
$$;
