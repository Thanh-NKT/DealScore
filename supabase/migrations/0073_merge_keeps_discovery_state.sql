-- Final roadmap review Minor 1 (P3 × P4): 0050's merge predates the discovery sources (0060). The source's
-- saved_search_hits cascaded away on its delete and demand_follows.known_product_ids kept the deleted id, so the
-- target could "enter" a saved search or be "new" for a demand follow: one alert for an item the user already knew.
-- admin_merge_products redefined from its 0050 body (not redefined since); the only change is step 5b.
-- Same signature, SECURITY DEFINER, grants restated as in 0050 (service_role only). The audit row is unchanged.

create or replace function public.admin_merge_products(p_source_id uuid, p_target_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c_uuid_re    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_note       text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_map        jsonb := p->'variant_map';
  v_pre        text[] := '{}';   -- 'marketplace:external_item_id' of the source's listings, read before the locks
  v_now        text[];
  v_src_status text;
  v_tgt_status text;
  v_src        products%rowtype;
  v_tgt        products%rowtype;
  v_src_vids   uuid[];
  v_offer_ids  uuid[];
  v_m          jsonb := '{}'::jsonb;   -- merged pairs { source variant id: target variant id }
  v_m_src      uuid[] := '{}';
  v_v          uuid[] := '{}';         -- moved whole
  v_targets    uuid[] := '{}';         -- target variants that receive a merged source
  v_touched    uuid[];
  v_dup        text;
  v_before     jsonb;
  v_n          integer;
  v_offers     integer := 0;
  v_w_moved    integer := 0;
  v_w_dropped  integer := 0;
  v_reports    integer := 0;
  v_c_rejected integer := 0;
  v_c_repoint  integer := 0;
  v_gtin       boolean := false;
  v_res        jsonb;
  v_cat_slug   text;
  t            uuid;
  e            jsonb;
  r            record;
begin
  if p_source_id is null or p_target_id is null
     or not exists (select 1 from products where id = p_source_id)
     or not exists (select 1 from products where id = p_target_id) then
    raise exception 'admin_merge_products: không tìm thấy sản phẩm';
  end if;
  if p_source_id = p_target_id then
    raise exception 'admin_merge_products: không thể gộp một sản phẩm với chính nó';
  end if;

  -- (a) The source's listings, read without locks; their ingest advisory locks in (marketplace, item) order.
  for r in
    select distinct l.marketplace, l.external_item_id
    from offers o
    join product_variants pv on pv.id = o.variant_id
    join listings l          on l.id = o.listing_id
    where pv.product_id = p_source_id
    order by l.marketplace, l.external_item_id
  loop
    perform pg_advisory_xact_lock(hashtext('ingest:' || r.marketplace || ':' || r.external_item_id));
    v_pre := v_pre || (r.marketplace || ':' || r.external_item_id);
  end loop;

  -- (b) Both products, in uuid order (draft:<key> advisory, then the row).
  if p_source_id < p_target_id then
    v_src_status := admin_lock_product(p_source_id);
    v_tgt_status := admin_lock_product(p_target_id);
  else
    v_tgt_status := admin_lock_product(p_target_id);
    v_src_status := admin_lock_product(p_source_id);
  end if;
  if v_src_status is null or v_tgt_status is null then
    raise exception 'admin_merge_products: không tìm thấy sản phẩm';
  end if;
  if v_tgt_status <> 'verified' then
    raise exception 'admin_merge_products: chỉ gộp vào sản phẩm đã xác minh';
  end if;
  select * into v_src from products where id = p_source_id;
  select * into v_tgt from products where id = p_target_id;
  select coalesce(array_agg(id order by id), '{}') into v_src_vids from product_variants where product_id = p_source_id;

  -- (c) source offers, (d) variants of both products — from here no new offer can reference a source
  -- variant (the FK check waits on these row locks) — (e) source watches, (f) source reports.
  perform 1 from offers o where o.variant_id = any(v_src_vids) order by o.id for update;
  perform 1 from product_variants where product_id in (p_source_id, p_target_id) order by id for update;
  perform 1 from watches where variant_id = any(v_src_vids) order by id for update;
  perform 1 from data_reports where product_id = p_source_id order by id for update;
  -- Re-check the source's listings against (a): a listing that joined the source meanwhile was not locked —
  -- refuse rather than merge with a partial lock set.
  select coalesce(array_agg(o.id order by o.id), '{}'),
         coalesce(array_agg(distinct l.marketplace || ':' || l.external_item_id), '{}')
    into v_offer_ids, v_now
  from offers o join listings l on l.id = o.listing_id
  where o.variant_id = any(v_src_vids);
  if not (v_now <@ v_pre) then
    raise exception 'admin_merge_products: dữ liệu đang được cập nhật, hãy thử lại';
  end if;

  -- Checks ----------------------------------------------------------------------
  if v_map is null or jsonb_typeof(v_map) <> 'array'
     or exists (select 1 from jsonb_array_elements(v_map) x
                where jsonb_typeof(x) <> 'object'
                   or coalesce(x->>'source_variant_id', '') !~ c_uuid_re
                   or (x->>'target_variant_id' is not null and x->>'target_variant_id' !~ c_uuid_re)) then
    raise exception 'admin_merge_products: danh sách biến thể đã thay đổi, hãy tải lại';
  end if;
  if jsonb_array_length(v_map) <> cardinality(v_src_vids)
     or (select count(distinct (x->>'source_variant_id')::uuid) from jsonb_array_elements(v_map) x) <> cardinality(v_src_vids)
     or exists (select 1 from jsonb_array_elements(v_map) x
                where not ((x->>'source_variant_id')::uuid = any(v_src_vids))) then
    raise exception 'admin_merge_products: danh sách biến thể đã thay đổi, hãy tải lại';
  end if;
  if exists (select 1 from jsonb_array_elements(v_map) x
             where x->>'target_variant_id' is not null
               and not exists (select 1 from product_variants tv
                               where tv.id = (x->>'target_variant_id')::uuid and tv.product_id = p_target_id)) then
    raise exception 'admin_merge_products: biến thể đích không thuộc sản phẩm đích';
  end if;

  for e in select * from jsonb_array_elements(v_map) loop
    if e->>'target_variant_id' is null then
      v_v := v_v || (e->>'source_variant_id')::uuid;
    else
      v_m := v_m || jsonb_build_object(e->>'source_variant_id', e->>'target_variant_id');
      v_m_src := v_m_src || (e->>'source_variant_id')::uuid;
      if not ((e->>'target_variant_id')::uuid = any(v_targets)) then
        v_targets := v_targets || (e->>'target_variant_id')::uuid;
      end if;
    end if;
  end loop;

  -- A variant moved whole must not duplicate a target variant's name, nor another moved one.
  select sv.variant_key into v_dup
  from product_variants sv
  where sv.id = any(v_v)
    and (exists (select 1 from product_variants tv
                 where tv.product_id = p_target_id and lower(btrim(tv.variant_key)) = lower(btrim(sv.variant_key)))
         or exists (select 1 from product_variants ov
                    where ov.id = any(v_v) and ov.id <> sv.id and lower(btrim(ov.variant_key)) = lower(btrim(sv.variant_key))))
  order by sv.variant_key, sv.id
  limit 1;
  if v_dup is not null then
    raise exception 'admin_merge_products: biến thể "%" đã có ở sản phẩm đích, hãy ghép vào biến thể đó', v_dup;
  end if;
  select count(*) into v_n from product_variants where product_id = p_target_id;
  if v_n + cardinality(v_v) > 50 then
    raise exception 'admin_merge_products: sản phẩm đích sẽ vượt 50 biến thể';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'admin_merge_products: ghi chú quá dài';
  end if;

  v_before := jsonb_build_object(
    'source', to_jsonb(v_src) - 'search_text',
    'target', to_jsonb(v_tgt) - 'search_text',
    'source_variants', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'variant_key', pv.variant_key,
                                   'capacity_gb', pv.capacity_gb, 'specs', pv.specs) order by pv.id)
                                 from product_variants pv where pv.product_id = p_source_id), '[]'::jsonb),
    'target_variants', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'variant_key', pv.variant_key,
                                   'capacity_gb', pv.capacity_gb, 'specs', pv.specs) order by pv.id)
                                 from product_variants pv where pv.product_id = p_target_id), '[]'::jsonb));

  -- Writes ----------------------------------------------------------------------
  -- 1. Merged variants: offers to the target variant; no pending offer stays on a verified product.
  update offers o
     set variant_id   = (v_m->>o.variant_id::text)::uuid,
         match_status = case when o.match_status = 'pending' then 'manual' else o.match_status end
   where o.variant_id = any(v_m_src);
  get diagnostics v_n = row_count;
  v_offers := v_n;

  -- 2. Variants moved whole keep their id.
  update product_variants set product_id = p_target_id where id = any(v_v);
  update offers set match_status = 'manual' where variant_id = any(v_v) and match_status = 'pending';
  select v_offers + count(*) into v_offers from offers where variant_id = any(v_v);

  -- 3. Suggestions: the admin just placed every source offer; suggestions elsewhere follow the merged variant.
  update match_candidates set decision = 'rejected', reviewed_at = now()
   where offer_id = any(v_offer_ids) and (decision = 'pending' or decision is null);
  get diagnostics v_c_rejected = row_count;
  update match_candidates mc set suggested_variant_id = (v_m->>mc.suggested_variant_id::text)::uuid
   where mc.suggested_variant_id = any(v_m_src);
  get diagnostics v_c_repoint = row_count;

  -- 4. Watches.
  foreach t in array v_targets loop
    v_res := admin_repoint_variant_watches(
      array(select (x.key)::uuid from jsonb_each_text(v_m) x where x.value::uuid = t), t);
    v_w_moved := v_w_moved + (v_res->>'moved')::integer;
    v_w_dropped := v_w_dropped + (v_res->>'dropped')::integer;
  end loop;
  update watches set product_id = p_target_id where variant_id = any(v_v);
  get diagnostics v_n = row_count;
  v_w_moved := v_w_moved + v_n;

  -- 5. Data reports (status kept).
  update data_reports dr
     set product_id = p_target_id,
         variant_id = coalesce((v_m->>dr.variant_id::text)::uuid, dr.variant_id)
   where dr.product_id = p_source_id;
  get diagnostics v_reports = row_count;

  -- 5b. Discovery state (0073): what a user already knew about the source counts for the target, so the merge
  -- never makes the target "enter" a saved search nor be "new" for a waiting demand follow. Source hits are
  -- copied before the source row goes (they cascade); a hit the target already has wins.
  insert into saved_search_hits (saved_search_id, product_id, in_set, first_seen_at, last_seen_at, alerted_at, alerted_price)
  select h.saved_search_id, p_target_id, h.in_set, h.first_seen_at, h.last_seen_at, h.alerted_at, h.alerted_price
    from saved_search_hits h
   where h.product_id = p_source_id
  on conflict (saved_search_id, product_id) do nothing;
  update demand_follows f
     set known_product_ids = array(select distinct x
                                   from unnest(array_replace(f.known_product_ids, p_source_id, p_target_id)) x)
   where p_source_id = any(f.known_product_ids);

  -- 6. GTIN: an empty target takes the source's, unless a third product uses it.
  if v_tgt.gtin is null and v_src.gtin is not null
     and not exists (select 1 from products where gtin = v_src.gtin and id not in (p_source_id, p_target_id)) then
    update products set gtin = v_src.gtin where id = p_target_id;
    v_gtin := true;
  end if;

  -- 7. Redirects — before the source row goes (its redirect rows cascade on delete). Older redirects to the
  -- source now point at the target in one hop, with their variant map composed through this merge.
  update product_slug_redirects sr
     set product_id  = p_target_id,
         variant_map = coalesce((select jsonb_object_agg(x.key, coalesce(v_m->>x.value, x.value))
                                 from jsonb_each_text(sr.variant_map) x), '{}'::jsonb) || v_m,
         merged_at   = now()
   where sr.product_id = p_source_id;
  if v_src.slug is not null then
    insert into product_slug_redirects (old_slug, product_id, variant_map)
    values (v_src.slug, p_target_id, v_m)
    on conflict (old_slug) do update set product_id = excluded.product_id, variant_map = excluded.variant_map,
                                         merged_at = now();
  end if;

  -- 8. Merged source variants, then the source product.
  delete from product_variants where id = any(v_m_src);
  delete from products where id = p_source_id;

  -- 9. Rollups from every observation (the source's history included).
  v_touched := v_targets || v_v;
  perform admin_rebuild_variant_rollup(v_touched);

  -- 10. Audit.
  select c.slug into v_cat_slug from categories c where c.id = v_tgt.category_id;
  perform admin_log('product.merge', 'product', p_target_id::text, v_before,
    jsonb_build_object(
      'status', 'verified',
      'deleted_product_id', p_source_id,
      'redirect_from', v_src.slug,
      'variant_map', v_map,
      'moved_variant_ids', to_jsonb(v_v),
      'merged_variant_ids', to_jsonb(v_m_src),
      'offers_moved', v_offers,
      'watches_moved', v_w_moved,
      'watches_dropped', v_w_dropped,
      'reports_moved', v_reports,
      'candidates_rejected', v_c_rejected,
      'candidates_repointed', v_c_repoint,
      'gtin_copied', v_gtin),
    v_note);

  return jsonb_build_object(
    'target_id', p_target_id,
    'target_slug', v_tgt.slug,
    'category_slug', v_cat_slug,
    'deleted_product_id', p_source_id,
    'redirect_from', v_src.slug,
    'touched_variant_ids', to_jsonb(v_touched),
    'offers_moved', v_offers,
    'watches_moved', v_w_moved,
    'watches_dropped', v_w_dropped,
    'reports_moved', v_reports);
exception
  when deadlock_detected or lock_not_available then
    raise exception 'admin_merge_products: dữ liệu đang được cập nhật, hãy thử lại';
end $$;

revoke execute on function public.admin_merge_products(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_merge_products(uuid, uuid, jsonb) to service_role;
