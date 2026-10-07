-- 0030 — search quality (spec 2026-10-07-search-quality-logic §2, §3).
--
-- search_products v12: same columns, filters, ordering and grants as v11 (0026), plus
--   1. p_term_groups jsonb (default null, appended last so every existing caller is unchanged): synonym
--      OR-groups built by the app (src/lib/search/synonyms.ts), e.g. [["tai nghe","headphone","earbuds"],
--      ["sony"]]. The groups are AND-ed, the alternatives of a group OR-ed, the words of one alternative
--      joined with <-> (adjacent), every word a prefix (`word:*`):
--        (tai:* <-> nghe:* | headphone:* | earbuds:*) & (sony:*)
--      The query is assembled here from words that are only [a-z0-9]+ after folding, so user input never
--      reaches to_tsquery as syntax. Caps: 10 groups, 6 alternatives per group, 8 words per alternative.
--      The original text keeps matching (the groups are OR-ed with the plain p_q query), and a row that
--      matches the plain query gets +0.5 relevance over a synonym-only match (exact > synonym).
--      Without p_term_groups (or with an empty / non-array value) the function behaves exactly as v11.
--   2. An index-friendly match path. v11 wrote the keyword test as
--        q = '' OR fts @@ tq OR search_text %> q
--      where `q = ''` is a per-call constant that the planner cannot use as an index condition, so the
--      OR could never become a BitmapOr and every keystroke ran to_tsvector over every products row
--      (Seq Scan). v12 splits "browse" (no keyword) and "keyword" into two UNION ALL arms, each gated by
--      a one-time filter; the keyword arm is `fts @@ tq OR search_text %> q`, which the planner turns
--      into BitmapOr(idx_products_search_fts, idx_products_search_trgm).
--
-- Indexes: both already exist since 0002 (idx_products_search_fts on to_tsvector('simple', search_text),
-- idx_products_search_trgm on search_text gin_trgm_ops), so no new index is built. The expression index is
-- usable: search_text is a STORED generated column (f_unaccent runs once, at write time), and
-- to_tsvector(regconfig, text) is immutable, so the indexed expression matches the WHERE clause as written.
-- A stored tsvector column would only save the to_tsvector call in ts_rank on rows that already matched,
-- at the cost of rewriting products under an ACCESS EXCLUSIVE lock.
--
-- search_index_report(): test-only diagnostics (like privilege_report() in 0023), service_role only.

drop function if exists public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[]);

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
  p_boost_terms   text[]  default null,
  p_term_groups   jsonb   default null
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
  grp as (
    select case when jsonb_typeof(p_term_groups) = 'array' then (
             select string_agg('(' || g.alts || ')', ' & ' order by g.ord)
             from (
               select gi.ord,
                      (select string_agg(a.phrase, ' | ' order by a.ord)
                       from (
                         select ai.ord,
                                (select string_agg(w.word || ':*', ' <-> ' order by w.pos)
                                 from regexp_split_to_table(
                                        btrim(regexp_replace(public.f_unaccent(lower(left(ai.alt, 100))), '[^a-z0-9]+', ' ', 'g')),
                                        '\s+') with ordinality as w(word, pos)
                                 where w.word <> '' and w.pos <= 8) as phrase
                         from jsonb_array_elements_text(
                                case jsonb_typeof(gi.g)
                                  when 'array'  then gi.g
                                  when 'string' then jsonb_build_array(gi.g)
                                  else '[]'::jsonb end) with ordinality as ai(alt, ord)
                         where ai.ord <= 6
                       ) a
                       where a.phrase is not null) as alts
               from jsonb_array_elements(p_term_groups) with ordinality as gi(g, ord)
               where gi.ord <= 10
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

grant execute on function public.search_products(text, uuid, text[], numeric, numeric, text, integer, integer, numeric, boolean, boolean, text[], integer, text[], jsonb)
  to anon, authenticated;

-- Test-only diagnostics for tests/db/search-index.test.ts: runs search_products with seq scans
-- disabled and reports, from this transaction's own counters, how products was read. With seq scans
-- off the planner falls back to a full scan of ANY products index when the keyword test cannot use the
-- search indexes (v11 read the whole of idx_products_category), hence other_index_scans.
create function public.search_index_report(p_q text, p_term_groups jsonb default null)
returns table (products_seq_scans bigint, fts_index_scans bigint, trgm_index_scans bigint,
               other_index_scans bigint, result_rows bigint)
language plpgsql volatile
set enable_seqscan = off
set search_path = public
as $$
declare
  v_fts   oid := 'public.idx_products_search_fts'::regclass;
  v_trgm  oid := 'public.idx_products_search_trgm'::regclass;
  v_other oid[];
  b_seq   bigint;
  b_fts   bigint;
  b_trgm  bigint;
  b_other bigint;
  v_rows  bigint;
begin
  v_other := array(select indexrelid from pg_index
                   where indrelid = 'public.products'::regclass and indexrelid not in (v_fts, v_trgm));
  b_seq   := pg_stat_get_xact_numscans('public.products'::regclass);
  b_fts   := pg_stat_get_xact_numscans(v_fts);
  b_trgm  := pg_stat_get_xact_numscans(v_trgm);
  b_other := (select coalesce(sum(pg_stat_get_xact_numscans(i)), 0) from unnest(v_other) i);
  select count(*) into v_rows from public.search_products(p_q => p_q, p_limit => 60, p_term_groups => p_term_groups);
  return query select pg_stat_get_xact_numscans('public.products'::regclass) - b_seq,
                      pg_stat_get_xact_numscans(v_fts) - b_fts,
                      pg_stat_get_xact_numscans(v_trgm) - b_trgm,
                      (select coalesce(sum(pg_stat_get_xact_numscans(i)), 0) from unnest(v_other) i)::bigint - b_other,
                      v_rows;
end
$$;

revoke execute on function public.search_index_report(text, jsonb) from public, anon, authenticated;
grant execute on function public.search_index_report(text, jsonb) to service_role;
