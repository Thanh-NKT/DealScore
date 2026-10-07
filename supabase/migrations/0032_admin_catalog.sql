-- 0032 — admin catalog (Admin spec 2026-10-07-roadmap-p1-admin-logic §A1): list every product with its
-- listing stats, create a verified product by hand, edit a verified product. Service-role only; the writing
-- functions log one admin_audit row in the same transaction.
--
-- "Active listing" below always means listings.status = 'active' joined through product_variants → offers,
-- whatever the offer's match_status (same as admin_drafts / admin_overview_counts in 0021).
-- Failing = last_attempt_at > coalesce(last_observed_at, '-infinity') (failing_listings in 0021).
--
-- Performance: admin_list_products runs its lateral stats over the whole base set (the whole catalog when
-- there is no query). Fine for one admin user and tens of thousands of products; on the dev seed it runs in
-- a few ms. Revisit with a materialised stats table if EXPLAIN ANALYZE on real data exceeds 500 ms.

-- 1 ---------------------------------------------------------------------------
create or replace function public.admin_list_products(
  p_q           text    default null,
  p_tab         text    default 'all',
  p_category_id uuid    default null,
  p_marketplace text    default null,
  p_sort        text    default 'listings',
  p_stale_hours integer default 48,
  p_limit       integer default 50,
  p_offset      integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q      text;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_hours  integer := least(greatest(coalesce(p_stale_hours, 48), 1), 720);
  v_result jsonb;
begin
  if p_tab is null or p_tab not in ('all', 'verified', 'draft', 'stale', 'error')
     or p_sort is null or p_sort not in ('listings', 'newest', 'name') then
    raise exception 'admin_list_products: tham số không hợp lệ';
  end if;
  v_q := nullif(public.f_unaccent(lower(left(btrim(coalesce(p_q, '')), 100))), '');
  -- LIKE wildcards in the query are literal (default escape character is backslash).
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  with base as (
    select pr.id, pr.canonical_name, pr.brand, pr.model, pr.gtin, pr.slug, pr.status, pr.category_id, pr.created_at
    from products pr
    where (v_q is null or pr.search_text like '%' || v_q || '%')
      and (p_category_id is null or pr.category_id = p_category_id)
      and (p_marketplace is null or exists (
             select 1 from product_variants pv
             join offers o on o.variant_id = pv.id
             join listings l on l.id = o.listing_id
             where pv.product_id = pr.id and l.status = 'active' and l.marketplace = p_marketplace))
  ), stats as (
    select b.*, c.slug as category_slug, c.name as category_name,
           vc.n as variant_count, ls.listing_count, ls.marketplaces, ls.last_observed_at, ls.failing_count,
           mp.min_price,
           (ls.listing_count > 0
            and (ls.last_observed_at is null or ls.last_observed_at < now() - v_hours * interval '1 hour')) as is_stale
    from base b
    left join categories c on c.id = b.category_id
    cross join lateral (select count(*)::integer as n from product_variants pv where pv.product_id = b.id) vc
    cross join lateral (
      select count(distinct l.id)::integer as listing_count,
             coalesce(array_agg(distinct l.marketplace order by l.marketplace), '{}') as marketplaces,
             max(l.last_observed_at) as last_observed_at,
             (count(distinct l.id) filter (
                where l.last_attempt_at > coalesce(l.last_observed_at, '-infinity'::timestamptz)))::integer as failing_count
      from product_variants pv
      join offers o on o.variant_id = pv.id
      join listings l on l.id = o.listing_id
      where pv.product_id = b.id and l.status = 'active'
    ) ls
    cross join lateral (
      select min(vcp.price) as min_price
      from product_variants pv join variant_current_price vcp on vcp.variant_id = pv.id
      where pv.product_id = b.id
    ) mp
  ), filtered as (
    select * from stats s
    where case p_tab
            when 'all' then true
            when 'verified' then s.status = 'verified'
            when 'draft' then s.status = 'draft'
            when 'stale' then s.is_stale
            else s.failing_count > 0
          end
  ), page as (
    select f.*, row_number() over (
             order by case when p_sort = 'name' then lower(f.canonical_name) end,
                      case when p_sort = 'listings' then f.listing_count end desc,
                      case when p_sort <> 'name' then f.created_at end desc,
                      f.id) as rn
    from filtered f
    order by rn
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'counts', (select jsonb_build_object(
                 'all', count(*),
                 'verified', count(*) filter (where status = 'verified'),
                 'draft', count(*) filter (where status = 'draft'),
                 'stale', count(*) filter (where is_stale),
                 'error', count(*) filter (where failing_count > 0))
               from stats),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'canonical_name', p.canonical_name, 'brand', p.brand, 'model', p.model, 'gtin', p.gtin,
               'slug', p.slug, 'status', p.status, 'category_id', p.category_id, 'category_slug', p.category_slug,
               'category_name', p.category_name, 'created_at', p.created_at, 'variant_count', p.variant_count,
               'listing_count', p.listing_count, 'marketplaces', to_jsonb(p.marketplaces), 'min_price', p.min_price,
               'last_observed_at', p.last_observed_at, 'is_stale', p.is_stale, 'failing_count', p.failing_count)
             order by p.rn)
      from page p), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- 2 ---------------------------------------------------------------------------
-- Audit snapshot of a product: the row without the generated search_text, plus its variants.
create or replace function public.admin_product_snapshot(p_product_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'product', (select to_jsonb(pr) - 'search_text' from products pr where pr.id = p_product_id),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('id', pv.id, 'variant_key', pv.variant_key, 'capacity_gb', pv.capacity_gb,
                                          'specs', pv.specs) order by pv.variant_key, pv.id)
      from product_variants pv where pv.product_id = p_product_id), '[]'::jsonb))
$$;

-- Shared field checks for create / update. p_fn prefixes the error ('admin_create_product: …').
-- p_self = the product being edited (excluded from the GTIN uniqueness check).
create or replace function public.admin_check_product_fields(p_fn text, p jsonb, p_self uuid)
returns void language plpgsql stable set search_path = public as $$
declare
  v_gtin  text := nullif(btrim(p->>'gtin'), '');
  v_image text := nullif(btrim(p->>'image'), '');
  v_cat   text := btrim(p->>'category_id');
begin
  if p ? 'category_id' and v_cat is not null and v_cat <> '' and not exists (
       select 1 from categories c
       where v_cat ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and c.id = v_cat::uuid) then
    raise exception '%: danh mục không tồn tại', p_fn;
  end if;
  if v_gtin is not null and v_gtin !~ '^[0-9]{8,14}$' then
    raise exception '%: GTIN phải gồm 8–14 chữ số', p_fn;
  end if;
  if v_gtin is not null and exists (
       select 1 from products pr where pr.gtin = v_gtin and pr.id is distinct from p_self) then
    raise exception '%: GTIN đã dùng cho sản phẩm khác', p_fn;
  end if;
  if v_image is not null and v_image not like 'https://%' then
    raise exception '%: ảnh phải là đường dẫn https', p_fn;
  end if;
end $$;

-- Variant count and unique variant_key (lower(btrim())) over the whole product, after the writes.
create or replace function public.admin_check_product_variants(p_fn text, p_product_id uuid)
returns void language plpgsql stable set search_path = public as $$
declare
  v_n integer;
begin
  select count(*) into v_n from product_variants where product_id = p_product_id;
  if v_n < 1 or v_n > 50 then
    raise exception '%: cần 1–50 biến thể', p_fn;
  end if;
  if exists (select 1 from product_variants where product_id = p_product_id
             group by lower(btrim(variant_key)) having count(*) > 1)
     or exists (select 1 from product_variants where product_id = p_product_id and btrim(variant_key) = '') then
    raise exception '%: tên biến thể trống hoặc bị trùng', p_fn;
  end if;
end $$;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_create_product(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fn    constant text := 'admin_create_product';
  v_vars  jsonb := p->'variants';
  v_base  text;
  v_slug  text;
  v_n     integer := 1;
  v_pid   uuid;
  v_vid   uuid;
  v_vids  uuid[] := '{}';
  v       jsonb;
  r       record;
begin
  if coalesce(btrim(p->>'canonical_name'), '') = '' or coalesce(btrim(p->>'brand'), '') = ''
     or coalesce(btrim(p->>'category_id'), '') = '' then
    raise exception 'admin_create_product: thiếu tên chuẩn, hãng hoặc danh mục';
  end if;
  perform admin_check_product_fields(v_fn, p - 'gtin' - 'image', null);  -- category first (spec order)
  if v_vars is null or jsonb_typeof(v_vars) <> 'array' or jsonb_array_length(v_vars) not between 1 and 50 then
    raise exception 'admin_create_product: cần 1–50 biến thể';
  end if;
  if exists (select 1 from jsonb_array_elements(v_vars) e
             where jsonb_typeof(e) <> 'object' or coalesce(btrim(e->>'variant_key'), '') = '')
     or (select count(distinct lower(btrim(e->>'variant_key'))) from jsonb_array_elements(v_vars) e)
        <> jsonb_array_length(v_vars) then
    raise exception 'admin_create_product: tên biến thể trống hoặc bị trùng';
  end if;
  perform admin_check_product_fields(v_fn, p - 'category_id', null);

  -- Slug exactly like admin_move_offer (0022).
  v_base := left(btrim(regexp_replace(lower(public.f_unaccent(btrim(p->>'canonical_name'))), '[^a-z0-9]+', '-', 'g'), '-'), 80);
  v_base := coalesce(nullif(btrim(v_base, '-'), ''), 'san-pham');
  loop
    v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
    begin
      insert into products (canonical_name, brand, model, category_id, image, gtin, specs, status, slug, draft_key)
      values (btrim(p->>'canonical_name'), btrim(p->>'brand'), nullif(btrim(p->>'model'), ''),
              (p->>'category_id')::uuid, nullif(btrim(p->>'image'), ''), nullif(btrim(p->>'gtin'), ''),
              case when jsonb_typeof(p->'specs') = 'object' then p->'specs' else '{}'::jsonb end,
              'verified', v_slug, null)
      returning id into v_pid;
      exit;
    exception when unique_violation then
      v_n := v_n + 1;
      if v_n > 1000 then
        raise exception 'admin_create_product: không sinh được slug cho %', v_base;
      end if;
    end;
  end loop;

  for v in select * from jsonb_array_elements(v_vars) loop
    -- trg_variant_capacity (0015) derives capacity_gb; an explicit capacity_gb overrides it.
    insert into product_variants (product_id, variant_key, specs)
    values (v_pid, btrim(v->>'variant_key'),
            case when jsonb_typeof(v->'specs') = 'object' then v->'specs' else '{}'::jsonb end)
    returning id into v_vid;
    if v ? 'capacity_gb' then
      update product_variants set capacity_gb = nullif(v->>'capacity_gb', '')::integer where id = v_vid;
    end if;
    v_vids := v_vids || v_vid;
  end loop;

  select pr.slug, c.slug as category_slug into r
  from products pr left join categories c on c.id = pr.category_id where pr.id = v_pid;
  perform admin_log('product.create', 'product', v_pid::text, null, admin_product_snapshot(v_pid), p->>'note');
  return jsonb_build_object('product_id', v_pid, 'slug', r.slug, 'category_slug', r.category_slug,
                            'variant_ids', to_jsonb(v_vids));
end $$;

-- 4 ---------------------------------------------------------------------------
-- Verified products only (drafts change through admin_promote_draft). A product field changes only when its key
-- is present; status / slug / draft_key never change. Variants: with id → edit (must belong to the product),
-- without id → new; variants not in the array stay as they are.
create or replace function public.admin_update_product(p_product_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fn      constant text := 'admin_update_product';
  v_status  text;
  v_before  jsonb;
  v_after   jsonb;
  v_vars    jsonb := p->'variants';
  v_vid     uuid;
  v_created uuid[] := '{}';
  v_vids    uuid[];
  v         jsonb;
  r         record;
begin
  v_status := admin_lock_product(p_product_id);
  if v_status is null then
    raise exception 'admin_update_product: không tìm thấy sản phẩm';
  end if;
  if v_status = 'draft' then
    raise exception 'admin_update_product: sản phẩm nháp, hãy duyệt ở trang Bản nháp';
  end if;
  if (p ? 'canonical_name' and coalesce(btrim(p->>'canonical_name'), '') = '')
     or (p ? 'brand' and coalesce(btrim(p->>'brand'), '') = '')
     or (p ? 'category_id' and coalesce(btrim(p->>'category_id'), '') = '') then
    raise exception 'admin_update_product: thiếu tên chuẩn, hãng hoặc danh mục';
  end if;
  perform admin_check_product_fields(v_fn, p, p_product_id);
  if v_vars is not null and jsonb_typeof(v_vars) <> 'array' then
    raise exception 'admin_update_product: cần 1–50 biến thể';
  end if;

  v_before := admin_product_snapshot(p_product_id);

  update products set
    canonical_name = case when p ? 'canonical_name' then btrim(p->>'canonical_name') else canonical_name end,
    brand          = case when p ? 'brand' then btrim(p->>'brand') else brand end,
    category_id    = case when p ? 'category_id' then btrim(p->>'category_id')::uuid else category_id end,
    model          = case when p ? 'model' then nullif(btrim(p->>'model'), '') else model end,
    image          = case when p ? 'image' then nullif(btrim(p->>'image'), '') else image end,
    gtin           = case when p ? 'gtin' then nullif(btrim(p->>'gtin'), '') else gtin end,
    specs          = case when jsonb_typeof(p->'specs') = 'object' then p->'specs' else specs end
  where id = p_product_id;

  for v in select * from jsonb_array_elements(coalesce(v_vars, '[]'::jsonb)) loop
    if jsonb_typeof(v) <> 'object' then
      raise exception 'admin_update_product: tên biến thể trống hoặc bị trùng';
    end if;
    if nullif(v->>'id', '') is not null then
      if (v->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or not exists (select 1 from product_variants where id = (v->>'id')::uuid and product_id = p_product_id) then
        raise exception 'admin_update_product: variant không thuộc sản phẩm này';
      end if;
      v_vid := (v->>'id')::uuid;
      -- Only write when something differs: trg_variant_capacity fires on any update OF variant_key/specs and would
      -- overwrite a manual capacity_gb.
      update product_variants pv
         set variant_key = coalesce(nullif(btrim(v->>'variant_key'), ''), pv.variant_key),
             specs       = case when jsonb_typeof(v->'specs') = 'object' then v->'specs' else pv.specs end
       where pv.id = v_vid
         and (pv.variant_key is distinct from coalesce(nullif(btrim(v->>'variant_key'), ''), pv.variant_key)
              or pv.specs is distinct from case when jsonb_typeof(v->'specs') = 'object' then v->'specs' else pv.specs end);
    else
      if coalesce(btrim(v->>'variant_key'), '') = '' then
        raise exception 'admin_update_product: tên biến thể trống hoặc bị trùng';
      end if;
      insert into product_variants (product_id, variant_key, specs)
      values (p_product_id, btrim(v->>'variant_key'),
              case when jsonb_typeof(v->'specs') = 'object' then v->'specs' else '{}'::jsonb end)
      returning id into v_vid;
      v_created := v_created || v_vid;
    end if;
    if v ? 'capacity_gb' then
      update product_variants set capacity_gb = nullif(v->>'capacity_gb', '')::integer
       where id = v_vid and capacity_gb is distinct from nullif(v->>'capacity_gb', '')::integer;
    end if;
  end loop;
  perform admin_check_product_variants(v_fn, p_product_id);

  v_after := admin_product_snapshot(p_product_id);
  if v_after is distinct from v_before then
    perform admin_log('product.update', 'product', p_product_id::text, v_before, v_after, p->>'note');
  end if;

  select pr.slug, c.slug as category_slug into r
  from products pr left join categories c on c.id = pr.category_id where pr.id = p_product_id;
  select coalesce(array_agg(id order by id), '{}') into v_vids from product_variants where product_id = p_product_id;
  return jsonb_build_object('product_id', p_product_id, 'slug', r.slug, 'category_slug', r.category_slug,
                            'variant_ids', to_jsonb(v_vids), 'created_variant_ids', to_jsonb(v_created));
end $$;

-- 5 ---------------------------------------------------------------------------
-- The helpers only run inside the definer functions above (as their owner): no role gets them directly.
revoke execute on function public.admin_product_snapshot(uuid),
                           public.admin_check_product_fields(text, jsonb, uuid),
                           public.admin_check_product_variants(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_list_products(text, text, uuid, text, text, integer, integer, integer),
                           public.admin_create_product(jsonb),
                           public.admin_update_product(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_list_products(text, text, uuid, text, text, integer, integer, integer),
                          public.admin_create_product(jsonb),
                          public.admin_update_product(uuid, jsonb)
  to service_role;
