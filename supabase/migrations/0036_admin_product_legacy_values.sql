-- 0036 — fix wave P1 (review I1): an unchanged stored image / GTIN no longer blocks a product edit.
-- The admin form always resends every key, so admin_update_product re-validated legacy values (a seeded http: image,
-- a GTIN shared by two older products, a GTIN with spaces/dashes) as if they were new and refused unrelated edits.
-- Now, when p_self is set (update), a value equal to the stored one after trimming skips its checks; a *changed*
-- value is validated exactly as before (https only, 8–14 digits, unique). Create (p_self null) is unchanged.
-- Redefined from 0032 (its only definition); same signature, still revoked from every role (create or replace keeps it).

create or replace function public.admin_check_product_fields(p_fn text, p jsonb, p_self uuid)
returns void language plpgsql stable set search_path = public as $$
declare
  v_gtin       text := nullif(btrim(p->>'gtin'), '');
  v_image      text := nullif(btrim(p->>'image'), '');
  v_cat        text := btrim(p->>'category_id');
  v_old_gtin   text;
  v_old_image  text;
begin
  if p_self is not null then
    select nullif(btrim(pr.gtin), ''), nullif(btrim(pr.image), '') into v_old_gtin, v_old_image
    from products pr where pr.id = p_self;
    if v_gtin is not distinct from v_old_gtin then
      v_gtin := null;    -- unchanged: grandfathered, not re-validated
    end if;
    if v_image is not distinct from v_old_image then
      v_image := null;
    end if;
  end if;
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

revoke execute on function public.admin_check_product_fields(text, jsonb, uuid)
  from public, anon, authenticated, service_role;
