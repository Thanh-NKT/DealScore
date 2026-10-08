-- 0067 — saved_search_params_valid (0060): "must narrow" let a params object with neither maxPrice nor onlyBuy
-- through — (p->'onlyBuy') = 'true' is NULL when the key is absent, and `if not (false or null)` does not fire.
-- Same body as 0060 with that test wrapped in coalesce(…, false). Existing rows: none can be affected (the action
-- validates with parseSavedParams first), and the column check is re-evaluated only on write.
create or replace function public.saved_search_params_valid(p jsonb)
returns boolean
language plpgsql immutable
set search_path = public
as $$
declare
  k text;
begin
  -- Step by step (not one boolean expression): jsonb_array_length / casts must never see the wrong type.
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('q','categorySlug','brands','minPrice','maxPrice','marketplaces','capacityGb',
                 'onlyBuy','freeShipping','hasVoucher','minRating') then
      return false;
    end if;
  end loop;
  -- must narrow: a price ceiling or "Nên mua" only
  if not ((p ? 'maxPrice') or coalesce((p->'onlyBuy') = 'true'::jsonb, false)) then return false; end if;
  -- must scope: text, category or brand
  if not ((p ? 'q') or (p ? 'categorySlug') or (p ? 'brands')) then return false; end if;
  if p ? 'q' then
    if jsonb_typeof(p->'q') <> 'string' or char_length(btrim(p->>'q')) not between 1 and 100 then return false; end if;
  end if;
  if p ? 'categorySlug' then
    if jsonb_typeof(p->'categorySlug') <> 'string' or char_length(p->>'categorySlug') not between 1 and 80 then
      return false;
    end if;
  end if;
  if p ? 'brands' then
    if jsonb_typeof(p->'brands') <> 'array' or jsonb_array_length(p->'brands') not between 1 and 10 then return false; end if;
    if exists (select 1 from jsonb_array_elements(p->'brands') b
               where jsonb_typeof(b) <> 'string' or char_length(btrim(b #>> '{}')) not between 1 and 60) then
      return false;
    end if;
  end if;
  if p ? 'marketplaces' then
    if jsonb_typeof(p->'marketplaces') <> 'array' or jsonb_array_length(p->'marketplaces') not between 1 and 3 then
      return false;
    end if;
    if exists (select 1 from jsonb_array_elements(p->'marketplaces') m
               where jsonb_typeof(m) <> 'string' or (m #>> '{}') not in ('shopee','tiktok','lazada')) then
      return false;
    end if;
  end if;
  if p ? 'minPrice' then
    if jsonb_typeof(p->'minPrice') <> 'number' or (p->>'minPrice')::numeric < 0 then return false; end if;
  end if;
  if p ? 'maxPrice' then
    if jsonb_typeof(p->'maxPrice') <> 'number' or (p->>'maxPrice')::numeric <= 0 then return false; end if;
  end if;
  if p ? 'minPrice' and p ? 'maxPrice' then
    if (p->>'minPrice')::numeric > (p->>'maxPrice')::numeric then return false; end if;
  end if;
  if p ? 'capacityGb' then
    if jsonb_typeof(p->'capacityGb') <> 'number' or (p->>'capacityGb')::numeric not between 1 and 65536
       or (p->>'capacityGb')::numeric <> trunc((p->>'capacityGb')::numeric) then
      return false;
    end if;
  end if;
  if p ? 'minRating' then
    if jsonb_typeof(p->'minRating') <> 'number' or (p->>'minRating')::numeric not in (4.5, 4.8) then return false; end if;
  end if;
  if p ? 'onlyBuy' and (p->'onlyBuy') <> 'true'::jsonb then return false; end if;
  if p ? 'freeShipping' and (p->'freeShipping') <> 'true'::jsonb then return false; end if;
  if p ? 'hasVoucher' and (p->'hasVoucher') <> 'true'::jsonb then return false; end if;
  return pg_column_size(p) <= 2048;
end $$;
