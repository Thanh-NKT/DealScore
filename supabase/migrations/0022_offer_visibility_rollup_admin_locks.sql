-- 0022 — DB review fixes, catalog side (review-db I1/I2/I3/I5 + minors, review-pricing-ui I1).
--
--   1. Two offer rules.
--      * CURRENT visibility, offer_is_visible(): the listing is active, and the offer is matched
--        ('auto' / 'manual') or is 'pending' on a draft product. Used by refresh_variant_current_price, the
--        draft-cluster band, search_products, filter_availability. Same rule as isOfferVisible() in
--        src/lib/pricing/variant-pricing.ts.
--      * HISTORY, offer_in_history(): the same match rule, but the listing's CURRENT status is ignored — a
--        listing that is gone today was a real price yesterday, and a reactivated listing keeps its past.
--        Only an admin deactivation ("this listing is wrong") takes a listing out of history. Used by the
--        daily rollup and the admin rollup rebuild.
--   2. refresh_variant_daily_prices(p_from, p_to, p_variant_ids default null): sargable observed_at range
--      (index idx_price_obs_observed_at, built CONCURRENTLY by migration 0027), optional variant scope
--      (stale rows of the scoped variants/days are deleted), rows locked in (variant_id, day) order so
--      concurrent refreshes cannot deadlock.
--   3. refresh_variant_current_price: visibility rule; latest observation per offer through a LIMIT 1
--      lateral (idx_price_obs_offer_time) instead of reading every observation of the variant.
--   4. Draft lifecycle lock order: `draft:<key>` advisory lock, then the product row, then offers.
--      ingest_listing v4 locks the chosen draft row and re-checks status = 'draft'; the admin RPCs take
--      the same locks through admin_lock_product() before touching a draft.
--   5. admin_repoint_watches: a re-pointed watch gets fresh engine state (new baseline from the target,
--      config_version + 1); the active watch wins over paused/done duplicates.
--   6. search_products v10: input clamps, gated Deal Score (shown only while price_at_compute equals the
--      card price), visibility rule in the draft gate and the marketplace filter.
--   7. trending_products / price_drop_radar: same score gate; strict UUID check; radar input clamps.
--   8. record_observations: an admin deactivation sticks (listings.deactivated_by).
--   9. Missing FK indexes.
--
--   This migration does NOT rebuild the existing rollups: a full rebuild inside the migration transaction
--   would hold an empty / locked rollup for every reader on a large table. The one-time rebuild under the
--   history rule is batched and resumable — rebuild_variant_rollups() (0028) via `pnpm rollup:rebuild`,
--   see supabase/README.md.

-- 1 ---------------------------------------------------------------------------
-- No SET search_path on purpose: it references no objects (only built-in operators) and must stay
-- inlinable in the large scans below.
create or replace function public.offer_is_visible(p_match_status text, p_listing_status text, p_product_status text)
returns boolean language sql immutable parallel safe as $$
  select p_listing_status = 'active'
     and (p_match_status in ('auto', 'manual')
          or (p_match_status = 'pending' and p_product_status = 'draft'))
$$;

-- History rule: offer_is_visible() without the listing's current status. A wrong match (rejected,
-- pending on a verified product) never counts; an admin-deactivated listing does not either.
create or replace function public.offer_in_history(p_match_status text, p_product_status text, p_deactivated_by text)
returns boolean language sql immutable parallel safe as $$
  select p_deactivated_by is distinct from 'admin'
     and (p_match_status in ('auto', 'manual')
          or (p_match_status = 'pending' and p_product_status = 'draft'))
$$;

-- 2 ---------------------------------------------------------------------------
-- listings.deactivated_by (section 8) is read by the history rule below.
alter table public.listings add column if not exists deactivated_by text
  check (deactivated_by in ('collector', 'admin'));

drop function if exists public.refresh_variant_daily_prices(date, date);
create function public.refresh_variant_daily_prices(p_from date, p_to date, p_variant_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_rows integer;
  -- Vietnam calendar days as a timestamptz range: sargable on idx_price_obs_observed_at, and independent
  -- of the session TimeZone.
  v_lo   timestamptz := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_hi   timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
begin
  if p_variant_ids is not null and cardinality(p_variant_ids) = 0 then
    return 0;
  end if;

  -- Scoped call: lock the existing rows of the range in (variant_id, day) order first, so the upsert and
  -- the stale-row delete below never take row locks out of order (two overlapping refreshes cannot deadlock).
  if p_variant_ids is not null then
    perform 1 from variant_daily_prices t
    where t.variant_id = any(p_variant_ids) and t.day between p_from and p_to
    order by t.variant_id, t.day
    for update;
  end if;

  insert into variant_daily_prices as t (
    variant_id, day, min_price, median_price, max_price,
    obs_count, offer_count, has_flash_sale, flash_min_price
  )
  select
    o.variant_id,
    (po.observed_at at time zone 'Asia/Ho_Chi_Minh')::date,
    min(po.price)               filter (where not po.is_flash_sale),
    percentile_cont(0.5) within group (order by po.price)
                                filter (where not po.is_flash_sale),
    max(po.price)               filter (where not po.is_flash_sale),
    count(*)                    filter (where not po.is_flash_sale),
    count(distinct po.offer_id) filter (where not po.is_flash_sale),
    bool_or(po.is_flash_sale),
    min(po.price)               filter (where po.is_flash_sale)
  from price_observations po
  join offers o            on o.id = po.offer_id
  join listings l          on l.id = o.listing_id
  join product_variants pv on pv.id = o.variant_id
  join products pr         on pr.id = pv.product_id
  where po.observed_at >= v_lo and po.observed_at < v_hi
    and po.is_valid
    and po.price is not null and po.price > 0
    and (p_variant_ids is null or o.variant_id = any(p_variant_ids))
    and offer_in_history(o.match_status, pr.status, l.deactivated_by)
  group by 1, 2
  -- Deterministic row-lock order: two concurrent refreshes cannot deadlock on variant_daily_prices.
  order by 1, 2
  on conflict (variant_id, day) do update set
    min_price       = excluded.min_price,
    median_price    = excluded.median_price,
    max_price       = excluded.max_price,
    obs_count       = excluded.obs_count,
    offer_count     = excluded.offer_count,
    has_flash_sale  = excluded.has_flash_sale,
    flash_min_price = excluded.flash_min_price;
  get diagnostics v_rows = row_count;

  -- Scoped call: a day whose history offers are all gone (rejected, moved away, admin-deactivated) loses
  -- its row. Unscoped calls only upsert (rows inserted outside this function are never touched).
  if p_variant_ids is not null then
    delete from variant_daily_prices t
    where t.variant_id = any(p_variant_ids)
      and t.day between p_from and p_to
      and not exists (
        select 1
        from offers o
        join listings l            on l.id = o.listing_id
        join product_variants pv   on pv.id = o.variant_id
        join products pr           on pr.id = pv.product_id
        join price_observations po on po.offer_id = o.id
        where o.variant_id = t.variant_id
          and offer_in_history(o.match_status, pr.status, l.deactivated_by)
          and po.is_valid and po.price is not null and po.price > 0
          and po.observed_at >= t.day::timestamp at time zone 'Asia/Ho_Chi_Minh'
          and po.observed_at <  (t.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  end if;
  return v_rows;
end $$;
revoke execute on function public.refresh_variant_daily_prices(date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_variant_daily_prices(date, date, uuid[]) to service_role;

-- Full rebuild of some variants' history (admin moves / deactivations, the batched one-time rebuild).
-- One transaction per call: readers see the old rows or the new ones, never an empty history.
create or replace function public.admin_rebuild_variant_rollup(p_variant_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    return;
  end if;
  -- Same row-lock order as refresh_variant_daily_prices.
  perform 1 from variant_daily_prices where variant_id = any(p_variant_ids) order by variant_id, day for update;
  delete from variant_daily_prices where variant_id = any(p_variant_ids);
  insert into variant_daily_prices (variant_id, day, min_price, median_price, max_price,
                                    obs_count, offer_count, has_flash_sale, flash_min_price)
  select o.variant_id,
         (po.observed_at at time zone 'Asia/Ho_Chi_Minh')::date,
         min(po.price) filter (where not po.is_flash_sale),
         percentile_cont(0.5) within group (order by po.price) filter (where not po.is_flash_sale),
         max(po.price) filter (where not po.is_flash_sale),
         count(*) filter (where not po.is_flash_sale),
         count(distinct po.offer_id) filter (where not po.is_flash_sale),
         bool_or(po.is_flash_sale),
         min(po.price) filter (where po.is_flash_sale)
  from price_observations po
  join offers o            on o.id = po.offer_id
  join listings l          on l.id = o.listing_id
  join product_variants pv on pv.id = o.variant_id
  join products pr         on pr.id = pv.product_id
  where o.variant_id = any(p_variant_ids)
    and offer_in_history(o.match_status, pr.status, l.deactivated_by)
    and po.is_valid and po.price is not null and po.price > 0
  group by 1, 2
  order by 1, 2;
  perform refresh_variant_current_price(p_variant_ids);
end $$;

-- 3 ---------------------------------------------------------------------------
-- The latest VALID observation of each visible offer. An invalid newest observation (collector could not
-- read a price) does not hide the offer: it keeps its last known price, and observed_at ages it — the
-- product page flags it stale after 48h, the radar and alerts skip it (review-db M2: intended).
create or replace function public.refresh_variant_current_price(p_variant_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    return;
  end if;

  with visible as (
    select o.id as offer_id, o.variant_id
    from offers o
    join listings l          on l.id = o.listing_id
    join product_variants pv on pv.id = o.variant_id
    join products pr         on pr.id = pv.product_id
    where o.variant_id = any(p_variant_ids)
      and offer_is_visible(o.match_status, l.status, pr.status)
  ),
  latest as (
    select vis.variant_id, vis.offer_id, lt.price, lt.original_price, lt.stock, lt.is_flash_sale, lt.observed_at
    from visible vis
    join lateral (
      select po.price, po.original_price, po.stock, po.is_flash_sale, po.observed_at
      from price_observations po
      where po.offer_id = vis.offer_id and po.is_valid and po.price is not null and po.price > 0
      order by po.observed_at desc
      limit 1
    ) lt on true
  ),
  ranked as (
    select latest.*,
           count(*) over (partition by variant_id) as n_offers,
           row_number() over (
             partition by variant_id
             order by (coalesce(stock, 1) > 0) desc,
                      case when coalesce(stock, 1) > 0 then price end asc nulls last,
                      observed_at desc
           ) as rn
    from latest
  ),
  upserted as (
    insert into variant_current_price as t (variant_id, best_offer_id, price, original_price,
                                            is_flash_sale, in_stock, offer_count, observed_at)
    select variant_id, offer_id, price, original_price, is_flash_sale,
           coalesce(stock, 1) > 0, n_offers, observed_at
    from ranked
    where rn = 1
    order by variant_id
    on conflict (variant_id) do update set
      best_offer_id  = excluded.best_offer_id,
      price          = excluded.price,
      original_price = excluded.original_price,
      is_flash_sale  = excluded.is_flash_sale,
      in_stock       = excluded.in_stock,
      offer_count    = excluded.offer_count,
      observed_at    = excluded.observed_at
    returning t.variant_id
  )
  -- No visible offer with an observation left → no current price.
  delete from variant_current_price vcp
  where vcp.variant_id = any(p_variant_ids)
    and not exists (select 1 from upserted u where u.variant_id = vcp.variant_id);
end $$;

-- 4 ---------------------------------------------------------------------------
-- Lock a product for a draft-lifecycle change: the `draft:<key>` advisory lock that ingest_listing's
-- clustering takes, then the product row. Returns the status (null = no such product).
create or replace function public.admin_lock_product(p_product_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_key    text;
  v_status text;
begin
  select draft_key into v_key from products where id = p_product_id;
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtext('draft:' || v_key));
  end if;
  select status into v_status from products where id = p_product_id for update;
  return v_status;
end $$;

-- ingest_listing v4: same as v3 (0020), except
--   * the chosen draft is row-locked and must still be a draft (an admin may have promoted or deleted it
--     while we waited for the advisory lock);
--   * the cluster band reads one latest observation per offer (LIMIT 1 lateral);
--   * the daily rollup is scoped to the touched variants.
create or replace function public.ingest_listing(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_auto       constant numeric := 0.95;
  c_suggest    constant numeric := 0.5;
  v_market     text := p->>'marketplace';
  v_ext        text := p->>'ext_item_id';
  v_source     text := coalesce(p->>'source', 'api');
  v_base       text := coalesce(nullif(p->>'slug_base', ''), 'san-pham');
  v_priority   integer := coalesce(nullif(p->>'refresh_priority', '')::integer, 1);
  v_draft_key  text := nullif(p->>'draft_key', '');
  v_price0     numeric := nullif(p->'models'->0->>'price', '')::numeric;
  v_cluster    boolean;
  v_now        timestamptz := now();
  v_today      date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_seller_id  uuid;
  v_listing_id uuid;
  v_product_id uuid;          -- draft product, created lazily
  v_slug       text;
  v_n          integer;
  v_variant_id uuid;
  v_first_variant uuid;
  v_offer_id   uuid;
  v_price      numeric;
  v_stock      integer;
  v_status     text;
  v_conf       numeric;
  v_suggested  uuid;
  v_touched    uuid[] := '{}';
  m            jsonb;
  r            record;
begin
  -- Clustering only for a single priced model: several models = a listing with variants, unsafe to merge.
  v_cluster := v_draft_key is not null
               and jsonb_typeof(p->'models') = 'array'
               and jsonb_array_length(p->'models') = 1
               and v_price0 is not null and v_price0 > 0;

  if v_market is null or v_market not in ('shopee', 'tiktok', 'lazada') then
    raise exception 'ingest_listing: marketplace không hợp lệ (%)', coalesce(v_market, 'null');
  end if;
  if v_priority not between 1 and 3 then
    raise exception 'ingest_listing: refresh_priority phải từ 1 đến 3';
  end if;
  if v_ext is null or coalesce(p->>'title', '') = ''
     or jsonb_typeof(p->'models') <> 'array'
     or jsonb_array_length(p->'models') = 0 then
    raise exception 'ingest_listing: payload thiếu ext_item_id, title hoặc models';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'models') x
             where coalesce(x->>'model_id', '') = '') then
    raise exception 'ingest_listing: model thiếu model_id';
  end if;

  perform pg_advisory_xact_lock(hashtext('ingest:' || v_market || ':' || v_ext));

  select o.variant_id, pr.slug as product_slug, c.slug as category_slug
    into r
  from listings l
  join offers o            on o.listing_id = l.id and o.variant_id is not null
  join product_variants v  on v.id = o.variant_id
  join products pr         on pr.id = v.product_id
  left join categories c   on c.id = pr.category_id
  where l.marketplace = v_market and l.external_item_id = v_ext
  limit 1;

  if found then
    -- A paste of an item found by sourcing upgrades its refresh rate.
    update listings set refresh_priority = least(refresh_priority, v_priority)
    where marketplace = v_market and external_item_id = v_ext;
    return jsonb_build_object('status', 'resolved', 'product_slug', r.product_slug,
                              'category_slug', r.category_slug, 'variant_id', r.variant_id);
  end if;

  insert into sellers as s (marketplace, external_seller_id, name, rating,
                            rating_count, is_official, updated_at)
  values (v_market, p->'seller'->>'external_id', p->'seller'->>'name',
          (p->'seller'->>'rating')::numeric, (p->'seller'->>'rating_count')::integer,
          coalesce((p->'seller'->>'is_official')::boolean, false), v_now)
  on conflict (marketplace, external_seller_id) do update set
    name         = excluded.name,
    rating       = excluded.rating,
    rating_count = excluded.rating_count,
    is_official  = excluded.is_official,
    updated_at   = excluded.updated_at
  returning s.id into v_seller_id;

  insert into listings as l (marketplace, external_item_id, seller_id, title, url,
                             status, refresh_priority, last_observed_at)
  values (v_market, v_ext, v_seller_id, p->>'title', p->>'url', 'active', v_priority, v_now)
  on conflict (marketplace, external_item_id) do update set
    seller_id        = excluded.seller_id,
    title            = excluded.title,
    url              = excluded.url,
    refresh_priority = least(l.refresh_priority, excluded.refresh_priority),
    last_observed_at = excluded.last_observed_at
  returning l.id into v_listing_id;

  for m in select * from jsonb_array_elements(p->'models') loop
    v_variant_id := null;
    v_conf := nullif(m->'match'->>'confidence', '')::numeric;
    v_suggested := null;

    -- The suggested variant must exist and belong to a VERIFIED product — never trust
    -- the payload to attach an offer to a draft.
    if m->'match'->>'variant_id' is not null then
      select pv.id into v_suggested
      from product_variants pv
      join products pr on pr.id = pv.product_id and pr.status = 'verified'
      where pv.id = (m->'match'->>'variant_id')::uuid;
    end if;

    if v_suggested is not null and v_conf >= c_auto then
      v_variant_id := v_suggested;
      v_status := 'auto';
    else
      -- Same unverified product sold by another shop: reuse its draft (spec §2.2).
      if v_product_id is null and v_cluster then
        perform pg_advisory_xact_lock(hashtext('draft:' || v_draft_key));
        select pr.id, fv.id
          into v_product_id, v_variant_id
        from products pr
        join lateral (
          select pv.id from product_variants pv where pv.product_id = pr.id order by pv.id limit 1
        ) fv on true
        -- Lowest / highest latest valid price per visible offer (same rule as refresh_variant_current_price).
        join lateral (
          select min(lt.price) as min_price, max(lt.price) as max_price
          from offers o
          join listings l on l.id = o.listing_id
          join lateral (
            select po.price
            from price_observations po
            where po.offer_id = o.id and po.is_valid and po.price is not null and po.price > 0
            order by po.observed_at desc
            limit 1
          ) lt on true
          where o.variant_id = fv.id
            and offer_is_visible(o.match_status, l.status, 'draft')
        ) band on band.min_price is not null
        where pr.status = 'draft'
          and pr.draft_key = v_draft_key
          and v_price0 between band.max_price * 0.5 and band.min_price * 2
        order by (select count(distinct o2.listing_id)
                  from product_variants pv2 join offers o2 on o2.variant_id = pv2.id
                  where pv2.product_id = pr.id) desc,
                 pr.created_at
        limit 1;

        -- Lock order draft:<key> → product row (same as admin_lock_product). Re-check under the row lock.
        if v_product_id is not null then
          perform 1 from products where id = v_product_id and status = 'draft' for update;
          if not found then
            v_product_id := null;
            v_variant_id := null;
          end if;
        end if;
      end if;

      if v_variant_id is null then
        if v_product_id is null then
          v_n := 1;
          loop
            v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
            begin
              insert into products (canonical_name, status, slug, specs, draft_key)
              values (p->>'title', 'draft', v_slug, '{}'::jsonb, case when v_cluster then v_draft_key end)
              returning id into v_product_id;
              exit;
            exception when unique_violation then
              v_n := v_n + 1;
              if v_n > 1000 then
                raise exception 'ingest_listing: không sinh được slug cho %', v_base;
              end if;
            end;
          end loop;
        end if;

        insert into product_variants (product_id, variant_key, specs)
        values (v_product_id, coalesce(nullif(m->>'name', ''), 'Tiêu chuẩn'), '{}'::jsonb)
        returning id into v_variant_id;
      end if;
      v_status := 'pending';
    end if;

    v_first_variant := coalesce(v_first_variant, v_variant_id);
    v_touched := array_append(v_touched, v_variant_id);

    insert into offers as o (listing_id, external_model_id, variant_id, match_status, match_confidence)
    values (v_listing_id, m->>'model_id', v_variant_id, v_status,
            case when v_status = 'auto' then v_conf end)
    on conflict (listing_id, external_model_id) do update set
      variant_id       = excluded.variant_id,
      match_status     = excluded.match_status,
      match_confidence = excluded.match_confidence
    returning o.id into v_offer_id;

    if v_status = 'pending' and v_suggested is not null and v_conf >= c_suggest
       and not exists (select 1 from match_candidates mc
                       where mc.offer_id = v_offer_id
                         and (mc.decision = 'pending' or mc.decision is null)) then
      insert into match_candidates (offer_id, suggested_variant_id, confidence, reason, decision)
      values (v_offer_id, v_suggested, least(v_conf, 0.9999), m->'match'->>'reason', 'pending');
    end if;

    v_price := (m->>'price')::numeric;
    v_stock := (m->>'stock')::integer;

    if v_price is not null and v_price > 0 then
      insert into price_observations (offer_id, observed_at, price, original_price,
                                      stock, is_flash_sale, is_valid, source)
      values (v_offer_id, v_now, v_price, (m->>'original_price')::numeric, v_stock,
              coalesce((m->>'is_flash_sale')::boolean, false), true, v_source);
    end if;
  end loop;

  perform refresh_variant_current_price(v_touched);
  perform refresh_variant_daily_prices(v_today, v_today, v_touched);

  select pr.slug as product_slug, c.slug as category_slug
    into r
  from product_variants v
  join products pr       on pr.id = v.product_id
  left join categories c on c.id = pr.category_id
  where v.id = v_first_variant;

  return jsonb_build_object('status', 'ingested', 'product_slug', r.product_slug,
                            'category_slug', r.category_slug, 'variant_id', v_first_variant);
end $$;

revoke execute on function public.ingest_listing(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_listing(jsonb) to service_role;

-- 5 ---------------------------------------------------------------------------
-- Re-pointing is a config change for the alert engine: the watch now follows a different offer set.
--   * baseline_price = the target's current in-stock price (as on insert), last_alert_price / last_in_stock
--     cleared, config_version + 1 (an in-flight evaluation of the old variant is discarded).
--   * cond_state keeps only conditions already reported true (except drop_pct, whose baseline moved), so
--     the re-point itself never re-sends an alert for something the user was already told.
-- One watch per (user, variant): the user's existing target watch wins, then an active draft watch over a
-- paused/done one, then the oldest.
create or replace function public.admin_repoint_watches(p_from_product_id uuid, p_to_variant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_to_pid   uuid;
  v_baseline numeric;
  v_dropped  integer;
  v_moved    integer;
begin
  select product_id into v_to_pid from product_variants where id = p_to_variant_id;
  if v_to_pid is null then
    raise exception 'admin_repoint_watches: variant đích không tồn tại';
  end if;
  with ranked as (
    select w.id, w.user_id,
           row_number() over (partition by w.user_id
                              order by (w.status = 'active') desc, w.created_at, w.id) as rn
    from watches w where w.product_id = p_from_product_id
  )
  delete from watches w using ranked r
   where w.id = r.id
     and (r.rn > 1 or exists (select 1 from watches t
                               where t.user_id = r.user_id and t.variant_id = p_to_variant_id));
  get diagnostics v_dropped = row_count;

  select vcp.price into v_baseline
  from variant_current_price vcp
  where vcp.variant_id = p_to_variant_id and vcp.in_stock and vcp.price > 0;

  update watches w
     set variant_id       = p_to_variant_id,
         product_id       = v_to_pid,
         baseline_price   = v_baseline,
         cond_state       = coalesce((select jsonb_object_agg(e.key, e.value)
                                      from jsonb_each(w.cond_state) e
                                      where e.value = 'true'::jsonb and e.key <> 'drop_pct'), '{}'::jsonb),
         last_alert_price = null,
         last_in_stock    = null,
         config_version   = w.config_version + 1
   where w.product_id = p_from_product_id;
  get diagnostics v_moved = row_count;
  return jsonb_build_object('moved', v_moved, 'dropped', v_dropped);
end $$;

-- Same as 0021, but under admin_lock_product (an ingest can no longer join the draft mid-promotion).
create or replace function public.admin_promote_draft(p_product_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_status text;
  v_vids   uuid[];
  v        jsonb;
  r        record;
begin
  v_status := admin_lock_product(p_product_id);
  if v_status is null then
    raise exception 'admin_promote_draft: không tìm thấy sản phẩm';
  end if;
  if v_status <> 'draft' then
    raise exception 'admin_promote_draft: sản phẩm không ở trạng thái nháp';
  end if;
  select to_jsonb(pr) - 'search_text' into v_before from products pr where pr.id = p_product_id;
  if coalesce(btrim(p->>'canonical_name'), '') = '' or coalesce(btrim(p->>'brand'), '') = ''
     or nullif(p->>'category_id', '') is null then
    raise exception 'admin_promote_draft: thiếu tên chuẩn, hãng hoặc danh mục';
  end if;

  for v in select * from jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) loop
    if not exists (select 1 from product_variants where id = (v->>'id')::uuid and product_id = p_product_id) then
      raise exception 'admin_promote_draft: variant không thuộc sản phẩm này';
    end if;
    update product_variants
       set variant_key = coalesce(nullif(btrim(v->>'variant_key'), ''), variant_key),
           specs       = coalesce(v->'specs', specs)
     where id = (v->>'id')::uuid;
    -- trg_variant_capacity (0015) re-derives capacity_gb from variant_key/specs on the update above; an explicit
    -- capacity_gb from the admin overrides it (an update of capacity_gb alone does not fire that trigger).
    if v ? 'capacity_gb' then
      update product_variants set capacity_gb = nullif(v->>'capacity_gb', '')::integer where id = (v->>'id')::uuid;
    end if;
  end loop;

  update products
     set status = 'verified',
         canonical_name = btrim(p->>'canonical_name'),
         brand = btrim(p->>'brand'),
         model = nullif(btrim(p->>'model'), ''),
         category_id = (p->>'category_id')::uuid,
         image = coalesce(nullif(p->>'image', ''), image),
         gtin = coalesce(nullif(p->>'gtin', ''), gtin),
         specs = coalesce(p->'specs', specs),
         draft_key = null
   where id = p_product_id;

  select coalesce(array_agg(id), '{}') into v_vids from product_variants where product_id = p_product_id;
  -- No pending offer may stay on a verified product (offer_is_visible would hide it).
  update offers set match_status = 'manual' where variant_id = any(v_vids) and match_status = 'pending';
  -- The admin chose this product over any suggested verified variant (plan ruling).
  update match_candidates mc set decision = 'rejected', reviewed_at = now()
    from offers o
   where mc.offer_id = o.id and o.variant_id = any(v_vids) and (mc.decision = 'pending' or mc.decision is null);
  perform refresh_variant_current_price(v_vids);

  select pr.slug, c.slug as category_slug, to_jsonb(pr) - 'search_text' as after_row into r
  from products pr left join categories c on c.id = pr.category_id where pr.id = p_product_id;
  perform admin_log('draft.promote', 'product', p_product_id::text, v_before, r.after_row, p->>'note');
  return jsonb_build_object('product_id', p_product_id, 'slug', r.slug, 'category_slug', r.category_slug,
                            'variant_ids', to_jsonb(v_vids));
end $$;

-- Same as 0021, plus: the source product is locked (admin_lock_product) BEFORE the offer row, then the offer
-- is re-checked; the fallback slug is applied after trimming.
create or replace function public.admin_move_offer(p_offer_id uuid, p_target_variant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer    record;
  v_from_vid uuid;
  v_from_pid uuid;
  v_from_st  text;
  v_to_vid   uuid;
  v_to_pid   uuid;
  v_deleted  uuid;
  v_base     text;
  v_slug     text;
  v_n        integer := 1;
  v_watches  jsonb;
  v_snapshot jsonb;
begin
  select o.variant_id into v_from_vid from offers o where o.id = p_offer_id;
  if not found then
    raise exception 'admin_move_offer: không tìm thấy tin bán';
  end if;
  select pv.product_id into v_from_pid from product_variants pv where pv.id = v_from_vid;
  if v_from_pid is not null then
    v_from_st := admin_lock_product(v_from_pid);
  end if;

  select o.*, l.title as listing_title into v_offer
  from offers o join listings l on l.id = o.listing_id where o.id = p_offer_id for update of o;
  if not found then
    raise exception 'admin_move_offer: không tìm thấy tin bán';
  end if;
  if v_offer.variant_id is distinct from v_from_vid then
    raise exception 'admin_move_offer: tin bán vừa thay đổi, hãy thử lại';
  end if;

  if p_target_variant_id is not null then
    select pv.product_id into v_to_pid from product_variants pv where pv.id = p_target_variant_id;
    if v_to_pid is null then
      raise exception 'admin_move_offer: variant đích không tồn tại';
    end if;
    v_to_vid := p_target_variant_id;
    update offers set variant_id = v_to_vid, match_status = 'manual', match_confidence = null where id = p_offer_id;
  else
    -- A new draft with no draft_key: it never attracts other listings.
    v_base := left(btrim(regexp_replace(lower(public.f_unaccent(coalesce(v_offer.listing_title, ''))), '[^a-z0-9]+', '-', 'g'), '-'), 80);
    v_base := coalesce(nullif(btrim(v_base, '-'), ''), 'san-pham');
    loop
      v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
      begin
        insert into products (canonical_name, status, slug, specs)
        values (coalesce(v_offer.listing_title, 'Sản phẩm'), 'draft', v_slug, '{}'::jsonb)
        returning id into v_to_pid;
        exit;
      exception when unique_violation then
        v_n := v_n + 1;
        if v_n > 1000 then
          raise exception 'admin_move_offer: không sinh được slug cho %', v_base;
        end if;
      end;
    end loop;
    insert into product_variants (product_id, variant_key, specs)
    values (v_to_pid, coalesce((select variant_key from product_variants where id = v_offer.variant_id), 'Tiêu chuẩn'), '{}'::jsonb)
    returning id into v_to_vid;
    update offers set variant_id = v_to_vid, match_status = 'pending', match_confidence = null where id = p_offer_id;
  end if;
  -- The admin placed the offer by hand: its open suggestions are moot.
  update match_candidates set decision = 'rejected', reviewed_at = now()
   where offer_id = p_offer_id and (decision = 'pending' or decision is null);

  if v_from_st = 'draft' and not exists (
       select 1 from offers o join product_variants pv on pv.id = o.variant_id where pv.product_id = v_from_pid) then
    v_watches := admin_repoint_watches(v_from_pid, v_to_vid);
    select to_jsonb(pr) - 'search_text' into v_snapshot from products pr where pr.id = v_from_pid;
    delete from products where id = v_from_pid;
    v_deleted := v_from_pid;
  end if;

  perform admin_rebuild_variant_rollup(array_remove(array[v_offer.variant_id, v_to_vid], null));
  perform admin_log('offer.move', 'offer', p_offer_id::text,
                    jsonb_build_object('variant_id', v_offer.variant_id, 'product_id', v_from_pid)
                      || case when v_snapshot is null then '{}'::jsonb
                              else jsonb_build_object('deleted_product', v_snapshot) end,
                    jsonb_build_object('variant_id', v_to_vid, 'product_id', v_to_pid, 'deleted_product_id', v_deleted,
                                       'moved_watches', coalesce((v_watches->>'moved')::integer, 0),
                                       'dropped_watches', coalesce((v_watches->>'dropped')::integer, 0)), null);
  return jsonb_build_object('from_variant_id', v_offer.variant_id, 'to_variant_id', v_to_vid,
                            'to_product_id', v_to_pid, 'deleted_product_id', v_deleted);
end $$;

-- Same as 0021, plus the admin_move_offer lock order (source product, then candidate + offer, re-checked).
create or replace function public.admin_review_match(p_candidate_id uuid, p_decision text, p_variant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c          record;
  v_from     uuid;
  v_from_p   uuid;
  v_from_st  text;
  v_target   uuid;
  v_deleted  uuid;
  v_watches  jsonb;
  v_snapshot jsonb;
begin
  if p_decision not in ('accept', 'reject', 'reassign') then
    raise exception 'admin_review_match: quyết định không hợp lệ';
  end if;
  select o.variant_id into v_from
  from match_candidates mc join offers o on o.id = mc.offer_id where mc.id = p_candidate_id;
  if not found then
    raise exception 'admin_review_match: không tìm thấy gợi ý';
  end if;
  select pv.product_id into v_from_p from product_variants pv where pv.id = v_from;
  if v_from_p is not null then
    v_from_st := admin_lock_product(v_from_p);
  end if;

  select mc.*, o.variant_id as offer_variant into c
  from match_candidates mc join offers o on o.id = mc.offer_id where mc.id = p_candidate_id for update of mc, o;
  if not found then
    raise exception 'admin_review_match: không tìm thấy gợi ý';
  end if;
  if c.offer_variant is distinct from v_from then
    raise exception 'admin_review_match: tin bán vừa thay đổi, hãy thử lại';
  end if;
  if c.decision is not null and c.decision <> 'pending' then
    raise exception 'admin_review_match: gợi ý đã được xử lý';
  end if;

  if p_decision = 'reject' then
    update match_candidates set decision = 'rejected', reviewed_at = now() where id = p_candidate_id;
    perform admin_log('match.review', 'match_candidate', p_candidate_id::text, null,
                      jsonb_build_object('decision', 'reject', 'offer_id', c.offer_id), null);
    return jsonb_build_object('offer_id', c.offer_id, 'variant_id', v_from, 'touched_variant_ids', '[]'::jsonb);
  end if;

  v_target := case when p_decision = 'accept' then c.suggested_variant_id else p_variant_id end;
  if v_target is null or not exists (
       select 1 from product_variants pv join products pr on pr.id = pv.product_id
       where pv.id = v_target and pr.status = 'verified') then
    raise exception 'admin_review_match: phải gán vào sản phẩm đã xác minh';
  end if;

  update offers set variant_id = v_target, match_status = 'manual', match_confidence = null where id = c.offer_id;
  update match_candidates set decision = 'accepted', reviewed_at = now(), suggested_variant_id = v_target where id = p_candidate_id;
  -- The offer is placed: its other open suggestions are moot.
  update match_candidates set decision = 'rejected', reviewed_at = now()
   where offer_id = c.offer_id and id <> p_candidate_id and (decision = 'pending' or decision is null);

  if v_from_st = 'draft' and not exists (
       select 1 from offers o join product_variants pv on pv.id = o.variant_id where pv.product_id = v_from_p) then
    v_watches := admin_repoint_watches(v_from_p, v_target);
    select to_jsonb(pr) - 'search_text' into v_snapshot from products pr where pr.id = v_from_p;
    delete from products where id = v_from_p;
    v_deleted := v_from_p;
  end if;
  perform admin_rebuild_variant_rollup(array_remove(array[v_from, v_target], null));
  perform admin_log('match.review', 'match_candidate', p_candidate_id::text,
                    jsonb_build_object('variant_id', v_from)
                      || case when v_snapshot is null then '{}'::jsonb
                              else jsonb_build_object('deleted_product', v_snapshot) end,
                    jsonb_build_object('decision', p_decision, 'variant_id', v_target, 'deleted_product_id', v_deleted,
                                       'moved_watches', coalesce((v_watches->>'moved')::integer, 0),
                                       'dropped_watches', coalesce((v_watches->>'dropped')::integer, 0)), null);
  return jsonb_build_object('offer_id', c.offer_id, 'variant_id', v_target,
                            'touched_variant_ids', to_jsonb(array_remove(array[v_from, v_target], null)));
end $$;

-- 8 ---------------------------------------------------------------------------
-- Who deactivated a listing: 'collector' (marketplace said gone; a later observation reactivates it) or
-- 'admin' (sticks — record_observations no longer undoes it). The column is added in section 2.

-- Same as 0021, plus: marks the deactivation as the admin's, rebuilds the variants' history (offer_in_history():
-- an admin-deactivated listing's prices leave the rollup), logs only when something changed.
create or replace function public.admin_set_listings_inactive(p_listing_ids uuid[], p_note text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_vids uuid[];
begin
  update listings set status = 'inactive', deactivated_by = 'admin'
   where id = any(p_listing_ids) and (status <> 'inactive' or deactivated_by is distinct from 'admin');
  get diagnostics v_n = row_count;
  select coalesce(array_agg(distinct o.variant_id) filter (where o.variant_id is not null), '{}') into v_vids
  from offers o where o.listing_id = any(p_listing_ids);
  perform admin_rebuild_variant_rollup(v_vids);
  if v_n > 0 then
    perform admin_log('listing.deactivate', 'listing', null, null, jsonb_build_object('listing_ids', to_jsonb(p_listing_ids)), p_note);
  end if;
  return v_n;
end $$;

-- Same as 0012, plus deactivated_by: 'gone' marks a collector deactivation; an observation reactivates
-- the listing unless the admin deactivated it.
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
    update listings
       set status = 'inactive',
           deactivated_by = case when deactivated_by = 'admin' then 'admin' else 'collector' end,
           last_observed_at = v_at
     where id = v_listing;
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

  update listings
     set last_observed_at = v_at,
         status         = case when deactivated_by = 'admin' then status else 'active' end,
         deactivated_by = case when deactivated_by = 'admin' then 'admin' end
   where id = v_listing;
  perform refresh_variant_current_price(v_touched);
  return v_touched;
end $$;
revoke execute on function public.record_observations(jsonb) from public, anon, authenticated;
grant execute on function public.record_observations(jsonb) to service_role;

-- 6 ---------------------------------------------------------------------------
-- search_products v10: same parameters and result as v9 (0020), plus
--   * clamps: limit 1–60, offset ≤ 5000, query ≤ 200 chars, ≤ 20 brands / 10 marketplaces / 10 boost terms;
--   * boost terms are normalised once, not per row;
--   * the draft gate counts only listings of visible offers, the marketplace filter uses the visibility rule
--     (drafts with ≥ 2 shops are no longer dropped by a marketplace filter);
--   * score / recommendation only while variant_deal_scores.price_at_compute equals the card price — after a
--     price change and before the next recompute the card shows no verdict rather than a stale one.
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
  p_boost_terms   text[]  default null
) returns table (
  product_id uuid, slug text, canonical_name text, brand text, image text,
  category_slug text, best_price numeric, original_price numeric,
  score smallint, recommendation text, last_observed_at timestamptz,
  relevance real, total_count bigint, effective_price numeric, variant_id uuid
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
           rep.variant_id, rep.price, rep.original_price, rep.observed_at,
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
      select v.id as variant_id, vcp.price, vcp.original_price, vcp.observed_at, vcp.best_offer_id
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
         rel, count(*) over () as total_count, effective_price, variant_id
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

-- Marketplaces offered by the filter = marketplaces of visible offers (same rule as the filter itself).
create or replace function public.filter_availability()
returns table (rating boolean, free_shipping boolean, voucher boolean, marketplaces text[])
language sql stable set search_path = public as $$
  select exists (select 1 from sellers where rating is not null),
         exists (select 1 from offers where free_shipping is not null),
         exists (select 1 from offers where has_voucher is not null),
         coalesce((select array_agg(distinct l.marketplace order by l.marketplace)
                   from offers o
                   join listings l          on l.id = o.listing_id
                   join product_variants pv on pv.id = o.variant_id
                   join products pr         on pr.id = pv.product_id
                   where offer_is_visible(o.match_status, l.status, pr.status)), '{}'::text[])
$$;

-- 7 ---------------------------------------------------------------------------
-- Same as 0011, plus the price_at_compute score gate and input clamps.
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
         d.price, d.original_price,
         case when vds.price_at_compute = d.price then vds.score end,
         case when vds.price_at_compute = d.price then vds.recommendation end,
         d.observed_at,
         d.variant_id, d.variant_key, round(d.median_30d, 0), d.drop_pct,
         count(*) over () as total_count
  from drops d
  left join variant_deal_scores vds on vds.variant_id = d.variant_id
  order by d.drop_pct desc, d.product_id
  limit least(greatest(coalesce(p_limit, 24), 1), 60) offset least(greatest(coalesce(p_offset, 0), 0), 5000)
$$;

-- Same as 0011, plus: strict UUID check on analytics props (one malformed row used to break the list),
-- the score gate, and a limit clamp.
create or replace function public.trending_products(p_mode text, p_limit integer default 24, p_category_id uuid default null)
returns table (
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
  limit least(greatest(coalesce(p_limit, 24), 0), 60);
end $$;

-- 9 ---------------------------------------------------------------------------
-- FK columns hit by cascades / set-null on offer, variant, watch and alert deletes (review-db M1).
create index if not exists idx_match_candidates_offer     on public.match_candidates (offer_id);
create index if not exists idx_match_candidates_suggested on public.match_candidates (suggested_variant_id);
create index if not exists idx_watches_product            on public.watches (product_id);
create index if not exists idx_alert_events_offer         on public.alert_events (offer_id);
create index if not exists idx_click_events_watch         on public.click_events (watch_id);
create index if not exists idx_click_events_alert_event   on public.click_events (alert_event_id);
create index if not exists idx_vcp_best_offer             on public.variant_current_price (best_offer_id);

-- Grants -----------------------------------------------------------------------
revoke execute on function public.admin_lock_product(uuid),
                           public.admin_rebuild_variant_rollup(uuid[]),
                           public.admin_repoint_watches(uuid, uuid),
                           public.admin_promote_draft(uuid, jsonb),
                           public.admin_move_offer(uuid, uuid),
                           public.admin_review_match(uuid, text, uuid),
                           public.admin_set_listings_inactive(uuid[], text),
                           public.refresh_variant_current_price(uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_lock_product(uuid),
                          public.admin_rebuild_variant_rollup(uuid[]),
                          public.admin_repoint_watches(uuid, uuid),
                          public.admin_promote_draft(uuid, jsonb),
                          public.admin_move_offer(uuid, uuid),
                          public.admin_review_match(uuid, text, uuid),
                          public.admin_set_listings_inactive(uuid[], text),
                          public.refresh_variant_current_price(uuid[])
  to service_role;
grant execute on function public.price_drop_radar(numeric, uuid, integer, integer) to anon, authenticated;
revoke execute on function public.trending_products(text, integer, uuid) from public;
grant execute on function public.trending_products(text, integer, uuid) to anon, authenticated;

-- No rollup rebuild here: see the header (rebuild_variant_rollups(), 0028).
