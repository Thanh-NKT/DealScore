-- 0021 — admin P0 (spec 2026-10-05-admin-p0-logic §A1). Every function here is service-role only and
-- writes admin_audit in the same transaction.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  action    text not null,
  entity    text not null,
  entity_id text,
  before    jsonb,
  after     jsonb,
  note      text
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
create index if not exists admin_audit_entity_idx on public.admin_audit (entity, entity_id);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

-- 2 ---------------------------------------------------------------------------
create or replace function public.admin_log(p_action text, p_entity text, p_entity_id text,
                                            p_before jsonb, p_after jsonb, p_note text)
returns void language sql security definer set search_path = public as $$
  insert into admin_audit (action, entity, entity_id, before, after, note)
  values (p_action, p_entity, p_entity_id, p_before, p_after, p_note)
$$;

-- Moving offers leaves stale rollup rows (refresh_variant_daily_prices only upserts): rebuild those variants.
create or replace function public.admin_rebuild_variant_rollup(p_variant_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
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
  join offers o on o.id = po.offer_id
  where o.variant_id = any(p_variant_ids)
    and po.is_valid and po.price is not null and po.price > 0
  group by 1, 2;
  perform refresh_variant_current_price(p_variant_ids);
end $$;

-- Before an emptied draft is deleted (watches cascade on delete), re-point its watches to the variant the
-- offer moved to. watches_user_variant_unique allows one watch per (user, variant): a draft watch whose user
-- already watches the target, or a second draft watch of the same user, is dropped (the user keeps one watch
-- on the target). Returns {moved, dropped}.
create or replace function public.admin_repoint_watches(p_from_product_id uuid, p_to_variant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_to_pid  uuid;
  v_dropped integer;
  v_moved   integer;
begin
  select product_id into v_to_pid from product_variants where id = p_to_variant_id;
  if v_to_pid is null then
    raise exception 'admin_repoint_watches: variant đích không tồn tại';
  end if;
  with ranked as (
    select w.id, w.user_id,
           row_number() over (partition by w.user_id order by w.created_at, w.id) as rn
    from watches w where w.product_id = p_from_product_id
  )
  delete from watches w using ranked r
   where w.id = r.id
     and (r.rn > 1 or exists (select 1 from watches t
                               where t.user_id = r.user_id and t.variant_id = p_to_variant_id));
  get diagnostics v_dropped = row_count;
  update watches set variant_id = p_to_variant_id, product_id = v_to_pid where product_id = p_from_product_id;
  get diagnostics v_moved = row_count;
  return jsonb_build_object('moved', v_moved, 'dropped', v_dropped);
end $$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_promote_draft(p_product_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_status text;
  v_vids   uuid[];
  v        jsonb;
  r        record;
begin
  select to_jsonb(pr) - 'search_text', pr.status into v_before, v_status
  from products pr where pr.id = p_product_id for update;
  if not found then
    raise exception 'admin_promote_draft: không tìm thấy sản phẩm';
  end if;
  if v_status <> 'draft' then
    raise exception 'admin_promote_draft: sản phẩm không ở trạng thái nháp';
  end if;
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

-- 4 ---------------------------------------------------------------------------
create or replace function public.admin_move_offer(p_offer_id uuid, p_target_variant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer    record;
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
  select o.*, l.title as listing_title into v_offer
  from offers o join listings l on l.id = o.listing_id where o.id = p_offer_id for update of o;
  if not found then
    raise exception 'admin_move_offer: không tìm thấy tin bán';
  end if;
  select pv.product_id, pr.status into v_from_pid, v_from_st
  from product_variants pv join products pr on pr.id = pv.product_id where pv.id = v_offer.variant_id;

  if p_target_variant_id is not null then
    select pv.product_id into v_to_pid from product_variants pv where pv.id = p_target_variant_id;
    if v_to_pid is null then
      raise exception 'admin_move_offer: variant đích không tồn tại';
    end if;
    v_to_vid := p_target_variant_id;
    update offers set variant_id = v_to_vid, match_status = 'manual', match_confidence = null where id = p_offer_id;
  else
    -- A new draft with no draft_key: it never attracts other listings.
    v_base := coalesce(nullif(regexp_replace(lower(public.f_unaccent(coalesce(v_offer.listing_title, ''))), '[^a-z0-9]+', '-', 'g'), ''), 'san-pham');
    v_base := left(btrim(v_base, '-'), 80);
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

-- 5 ---------------------------------------------------------------------------
create or replace function public.admin_review_match(p_candidate_id uuid, p_decision text, p_variant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c         record;
  v_from    uuid;
  v_from_p  uuid;
  v_from_st text;
  v_target  uuid;
  v_deleted uuid;
  v_watches jsonb;
  v_snapshot jsonb;
begin
  if p_decision not in ('accept', 'reject', 'reassign') then
    raise exception 'admin_review_match: quyết định không hợp lệ';
  end if;
  select mc.*, o.variant_id as offer_variant into c
  from match_candidates mc join offers o on o.id = mc.offer_id where mc.id = p_candidate_id for update of mc, o;
  if not found then
    raise exception 'admin_review_match: không tìm thấy gợi ý';
  end if;
  if c.decision is not null and c.decision <> 'pending' then
    raise exception 'admin_review_match: gợi ý đã được xử lý';
  end if;
  v_from := c.offer_variant;

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

  select pv.product_id, pr.status into v_from_p, v_from_st
  from product_variants pv join products pr on pr.id = pv.product_id where pv.id = v_from;
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

-- 6 ---------------------------------------------------------------------------
create or replace function public.admin_set_listings_inactive(p_listing_ids uuid[], p_note text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_vids uuid[];
begin
  update listings set status = 'inactive' where id = any(p_listing_ids) and status <> 'inactive';
  get diagnostics v_n = row_count;
  select coalesce(array_agg(distinct o.variant_id) filter (where o.variant_id is not null), '{}') into v_vids
  from offers o where o.listing_id = any(p_listing_ids);
  perform refresh_variant_current_price(v_vids);
  perform admin_log('listing.deactivate', 'listing', null, null, jsonb_build_object('listing_ids', to_jsonb(p_listing_ids)), p_note);
  return v_n;
end $$;

-- 7 ---------------------------------------------------------------------------
create or replace function public.admin_cron_status()
returns table (jobname text, schedule text, active boolean, last_start timestamptz, last_end timestamptz,
               last_status text, last_message text, failures_24h integer)
language sql stable security definer set search_path = public, cron as $$
  select j.jobname::text, j.schedule::text, j.active,
         lr.start_time, lr.end_time, lr.status::text, left(lr.return_message, 500),
         (select count(*)::integer from cron.job_run_details d
           where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours')
  from cron.job j
  left join lateral (
    select d.start_time, d.end_time, d.status, d.return_message
    from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1
  ) lr on true
  where j.jobname like 'kairo-%'
  order by j.jobname
$$;

-- 8 ---------------------------------------------------------------------------
create or replace function public.admin_overview_counts()
returns jsonb language sql stable security definer set search_path = public, cron as $$
  with draft_listings as (
    select pr.id, count(distinct l.id) filter (where l.status = 'active') as n
    from products pr
    left join product_variants pv on pv.product_id = pr.id
    left join offers o on o.variant_id = pv.id
    left join listings l on l.id = o.listing_id
    where pr.status = 'draft'
    group by pr.id
  )
  select jsonb_build_object(
    'drafts_multi_shop', (select count(*) from draft_listings where n >= 2),
    'drafts_single', (select count(*) from draft_listings where n = 1),
    'pending_matches', (select count(*) from match_candidates where decision = 'pending' or decision is null),
    'failing_listings', (select count(*) from listings
                          where status = 'active' and last_attempt_at is not null
                            and last_attempt_at > coalesce(last_observed_at, '-infinity'::timestamptz)),
    'cron_failures_24h', (select coalesce(sum(failures_24h), 0) from admin_cron_status()),
    'last_collector_at', (select max(finished_at) from collector_runs),
    'tiktok_access_expires_at', (select access_expires_at from marketplace_credentials where marketplace = 'tiktok')
  )
$$;

-- 8b --------------------------------------------------------------------------
-- Draft queue for the admin app: sortable by listing count across the whole catalog (a client-side sort
-- would only sort one page).
create or replace view public.admin_drafts with (security_invoker = true) as
select pr.id, pr.canonical_name, pr.slug, pr.draft_key, pr.created_at,
       count(distinct l.id) filter (where l.status = 'active') as listing_count,
       coalesce(array_agg(distinct l.marketplace) filter (where l.marketplace is not null), '{}') as marketplaces,
       min(vcp.price) as min_price,
       max(vcp.price) as max_price
from products pr
left join product_variants pv on pv.product_id = pr.id
left join offers o on o.variant_id = pv.id
left join listings l on l.id = o.listing_id
left join variant_current_price vcp on vcp.variant_id = pv.id
where pr.status = 'draft'
group by pr.id;
revoke all on public.admin_drafts from anon, authenticated;

-- 8c --------------------------------------------------------------------------
-- request_sourcing_query (0019) with one change: a repeat request no longer re-enables a demand keyword
-- (0019 set `active = active or origin = 'demand'`), so the admin's "turn off junk keyword" sticks.
create or replace function public.request_sourcing_query(p_value text, p_marketplaces text[], p_daily_cap integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_m        text;
  v_inserted integer := 0;
  v_count    integer;
  v_day      timestamptz := (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh')) at time zone 'Asia/Ho_Chi_Minh';
begin
  if coalesce(btrim(p_value), '') = '' then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtext('sourcing-demand'));
  foreach v_m in array coalesce(p_marketplaces, '{}'::text[]) loop
    continue when v_m not in ('shopee', 'tiktok');
    update sourcing_queries
       set request_count = request_count + 1,
           last_requested_at = now()
     where marketplace = v_m and kind = 'keyword' and value = p_value;
    continue when found;
    select count(*) into v_count
      from sourcing_queries
     where marketplace = v_m and origin = 'demand' and created_at >= v_day;
    continue when v_count >= greatest(coalesce(p_daily_cap, 0), 0);
    insert into sourcing_queries (marketplace, kind, value, origin, request_count, last_requested_at)
    values (v_m, 'keyword', p_value, 'demand', 1, now())
    on conflict (marketplace, kind, value) do nothing;
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  return v_inserted;
end $$;
revoke execute on function public.request_sourcing_query(text, text[], integer) from public, anon, authenticated;
grant execute on function public.request_sourcing_query(text, text[], integer) to service_role;

-- 9 ---------------------------------------------------------------------------
revoke execute on function public.admin_log(text, text, text, jsonb, jsonb, text),
                           public.admin_rebuild_variant_rollup(uuid[]),
                           public.admin_repoint_watches(uuid, uuid),
                           public.admin_promote_draft(uuid, jsonb),
                           public.admin_move_offer(uuid, uuid),
                           public.admin_review_match(uuid, text, uuid),
                           public.admin_set_listings_inactive(uuid[], text),
                           public.admin_cron_status(),
                           public.admin_overview_counts()
  from public, anon, authenticated;
grant execute on function public.admin_log(text, text, text, jsonb, jsonb, text),
                          public.admin_rebuild_variant_rollup(uuid[]),
                          public.admin_repoint_watches(uuid, uuid),
                          public.admin_promote_draft(uuid, jsonb),
                          public.admin_move_offer(uuid, uuid),
                          public.admin_review_match(uuid, text, uuid),
                          public.admin_set_listings_inactive(uuid[], text),
                          public.admin_cron_status(),
                          public.admin_overview_counts()
  to service_role;
