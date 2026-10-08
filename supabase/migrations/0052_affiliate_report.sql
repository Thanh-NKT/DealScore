-- 0052 — Admin affiliate report (roadmap P3 item 11).
--
-- Aggregates ONLY the affiliate tables (click_events, conversions, affiliate_offers). Catalog tables
-- (offers, listings, product_variants, products, categories) are joined only to LABEL the top-items rows —
-- never to filter or weight. Nothing here is read by Deal Score / search / alerts: these functions are called
-- by the Admin app only (tests/lib/affiliate/report-isolation.test.ts keeps them out of DealScore src/).
-- Days are Vietnam calendar days, both ends included. No user_id / session_id / order_id leaves.
--
-- daily / by_channel use the same definitions as the affiliate_daily view (0007), computed here with the
-- range filter on the base tables (the view aggregates every row before it can be filtered).
-- Both functions: security definer, service_role only.

-- 1 ---------------------------------------------------------------------------
create or replace function public.admin_affiliate_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lo timestamptz;
  v_hi timestamptz;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'admin_affiliate_report: khoảng ngày không hợp lệ';
  end if;
  v_lo := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_hi := (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  return (
    with clicks as (
      select (ce.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day, coalesce(ce.source, 'unknown') as channel
      from click_events ce
      where ce.created_at >= v_lo and ce.created_at < v_hi
    ),
    conv as (
      select (c.purchase_time at time zone 'Asia/Ho_Chi_Minh')::date as day, c.marketplace, c.order_id,
             c.source_channel as channel, c.status, c.click_event_id,
             coalesce(c.order_value, 0) as order_value, coalesce(c.commission, 0) as commission
      from conversions c
      where c.purchase_time >= v_lo and c.purchase_time < v_hi
    ),
    days as (
      select d::date as day from generate_series(p_from, p_to, interval '1 day') d
    )
    select jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'totals', jsonb_build_object(
        'clicks', (select count(*) from clicks),
        'orders', (select count(distinct (marketplace, order_id)) from conv),
        'orders_matched', (select count(distinct (marketplace, order_id)) from conv where click_event_id is not null),
        'unmatched_orders', (select count(distinct (marketplace, order_id)) from conv)
                            - (select count(distinct (marketplace, order_id)) from conv where click_event_id is not null),
        'gmv', jsonb_build_object(
          'completed', (select coalesce(sum(order_value), 0) from conv where status = 'completed'),
          'pending',   (select coalesce(sum(order_value), 0) from conv where status = 'pending'),
          'cancelled', (select coalesce(sum(order_value), 0) from conv where status = 'cancelled')),
        'commission', jsonb_build_object(
          'completed', (select coalesce(sum(commission), 0) from conv where status = 'completed'),
          'pending',   (select coalesce(sum(commission), 0) from conv where status = 'pending'),
          'cancelled', (select coalesce(sum(commission), 0) from conv where status = 'cancelled'))),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'day', d.day,
                 'clicks', (select count(*) from clicks k where k.day = d.day),
                 'orders', (select count(distinct (v.marketplace, v.order_id)) from conv v where v.day = d.day),
                 'gmv_completed', (select coalesce(sum(v.order_value), 0) from conv v where v.day = d.day and v.status = 'completed'),
                 'commission_completed', (select coalesce(sum(v.commission), 0) from conv v where v.day = d.day and v.status = 'completed'),
                 'commission_pending', (select coalesce(sum(v.commission), 0) from conv v where v.day = d.day and v.status = 'pending'))
               order by d.day), '[]'::jsonb)
        from days d),
      'by_channel', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'channel', ch.channel,
                 'clicks', (select count(*) from clicks k where k.channel = ch.channel),
                 'orders', (select count(distinct (v.marketplace, v.order_id)) from conv v where v.channel = ch.channel),
                 'orders_matched', (select count(distinct (v.marketplace, v.order_id)) from conv v
                                    where v.channel = ch.channel and v.click_event_id is not null),
                 'commission_completed', (select coalesce(sum(v.commission), 0) from conv v where v.channel = ch.channel and v.status = 'completed'),
                 'commission_pending', (select coalesce(sum(v.commission), 0) from conv v where v.channel = ch.channel and v.status = 'pending'))
               order by ch.channel), '[]'::jsonb)
        from (select channel from clicks union select channel from conv) ch),
      'by_marketplace', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'marketplace', m.marketplace,
                 'orders', m.orders, 'gmv_completed', m.gmv_completed,
                 'commission_completed', m.commission_completed, 'commission_pending', m.commission_pending)
               order by m.marketplace), '[]'::jsonb)
        from (select v.marketplace,
                     count(distinct v.order_id) as orders,
                     coalesce(sum(v.order_value) filter (where v.status = 'completed'), 0) as gmv_completed,
                     coalesce(sum(v.commission) filter (where v.status = 'completed'), 0) as commission_completed,
                     coalesce(sum(v.commission) filter (where v.status = 'pending'), 0) as commission_pending
              from conv v group by v.marketplace) m),
      'by_status', (
        select jsonb_agg(jsonb_build_object(
                 'status', s.status,
                 'orders', (select count(distinct (v.marketplace, v.order_id)) from conv v where v.status = s.status),
                 'order_value', (select coalesce(sum(v.order_value), 0) from conv v where v.status = s.status),
                 'commission', (select coalesce(sum(v.commission), 0) from conv v where v.status = s.status))
               order by s.ord)
        from (values ('pending', 1), ('completed', 2), ('cancelled', 3), ('unknown', 4)) s(status, ord)),
      -- Not date-scoped: the current state of the affiliate links.
      'links', (
        select jsonb_build_object(
                 'eligible', count(*) filter (where eligible),
                 'ineligible', count(*) filter (where not eligible),
                 'with_short_link', count(*) filter (where nullif(btrim(short_link), '') is not null))
        from affiliate_offers))
  );
end $$;

-- 2 ---------------------------------------------------------------------------
create or replace function public.admin_affiliate_top_items(
  p_from  date,
  p_to    date,
  p_sort  text    default 'orders',
  p_limit integer default 20
) returns table (
  marketplace text, external_item_id text, listing_id uuid, listing_title text, product_id uuid,
  product_name text, product_slug text, category_slug text, clicks bigint, orders bigint,
  gmv_completed numeric, commission_completed numeric
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_lo timestamptz;
  v_hi timestamptz;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'admin_affiliate_top_items: khoảng ngày không hợp lệ';
  end if;
  if p_sort is null or p_sort not in ('orders', 'clicks', 'commission') then
    raise exception 'admin_affiliate_top_items: cách sắp xếp không hợp lệ';
  end if;
  v_lo := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_hi := (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  return query
  with k as (
    select l.marketplace as mk, l.external_item_id as item, count(*) as clicks
    from click_events ce
    join offers o   on o.id = ce.offer_id
    join listings l on l.id = o.listing_id
    where ce.created_at >= v_lo and ce.created_at < v_hi
    group by 1, 2
  ),
  v as (
    select c.marketplace as mk, c.item_id as item,
           count(distinct c.order_id) as orders,
           coalesce(sum(c.order_value) filter (where c.status = 'completed'), 0) as gmv_completed,
           coalesce(sum(c.commission) filter (where c.status = 'completed'), 0) as commission_completed
    from conversions c
    where c.purchase_time >= v_lo and c.purchase_time < v_hi
    group by 1, 2
  ),
  j as (
    select coalesce(k.mk, v.mk) as mk, coalesce(k.item, v.item) as item,
           coalesce(k.clicks, 0) as clicks, coalesce(v.orders, 0) as orders,
           coalesce(v.gmv_completed, 0) as gmv_completed, coalesce(v.commission_completed, 0) as commission_completed
    from k full join v on v.mk = k.mk and v.item = k.item
  ),
  top as (
    select * from j
    order by case p_sort when 'orders' then j.orders when 'clicks' then j.clicks end desc nulls last,
             case when p_sort = 'commission' then j.commission_completed end desc nulls last,
             j.mk, j.item
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  -- Labels only.
  select t.mk, t.item, l.id, l.title, pr.id, pr.canonical_name, pr.slug, cat.slug,
         t.clicks, t.orders, t.gmv_completed, t.commission_completed
  from top t
  left join listings l on l.marketplace = t.mk and l.external_item_id = t.item
  left join lateral (
    select o.variant_id from offers o
    where o.listing_id = l.id and o.variant_id is not null
    order by o.variant_id limit 1
  ) fo on true
  left join product_variants pv on pv.id = fo.variant_id
  left join products pr on pr.id = pv.product_id
  left join categories cat on cat.id = pr.category_id
  order by case p_sort when 'orders' then t.orders when 'clicks' then t.clicks end desc nulls last,
           case when p_sort = 'commission' then t.commission_completed end desc nulls last,
           t.mk, t.item;
end $$;

-- 3 ---------------------------------------------------------------------------
revoke execute on function public.admin_affiliate_report(date, date),
                           public.admin_affiliate_top_items(date, date, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_affiliate_report(date, date),
                          public.admin_affiliate_top_items(date, date, text, integer)
  to service_role;
