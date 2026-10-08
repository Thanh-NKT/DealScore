-- 0063 — Voucher history + coverage (roadmap P4 item K, spec §7.1).
--
-- A re-seen voucher used to move only last_seen_at, so "this shop has had a 50k code in 3 of the last 3 months"
-- could not be told. Two catalog tables (public read, service-role writes):
-- - voucher_sightings: one row per voucher per Vietnam day it was seen by a TRUSTED source — api / seed, or an
--   extension report with ≥ 2 reporters (the activeVouchers() rule, MIN_EXTENSION_REPORTERS).
-- - voucher_seller_checks: one row per seller per Vietnam day a source answered with a voucher list (possibly
--   empty). Absence of a voucher means nothing unless DealScore looked that day.
-- upsert_vouchers is redefined from 0014 (return value, signature and grants unchanged).

create table if not exists public.voucher_sightings (
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  day        date not null,
  primary key (voucher_id, day)
);
create table if not exists public.voucher_seller_checks (
  seller_id     uuid not null references public.sellers(id) on delete cascade,
  day           date not null,
  vouchers_seen integer not null default 0 check (vouchers_seen >= 0),
  primary key (seller_id, day)
);
create index if not exists idx_voucher_sightings_day on public.voucher_sightings (day);

-- Catalog-derived, like vouchers: public read, no write grant.
alter table public.voucher_sightings enable row level security;
alter table public.voucher_seller_checks enable row level security;
drop policy if exists "voucher_sightings_public_read" on public.voucher_sightings;
create policy "voucher_sightings_public_read" on public.voucher_sightings for select using (true);
drop policy if exists "voucher_seller_checks_public_read" on public.voucher_seller_checks;
create policy "voucher_seller_checks_public_read" on public.voucher_seller_checks for select using (true);
revoke all on public.voucher_sightings, public.voucher_seller_checks from anon, authenticated;
grant select on public.voucher_sightings, public.voucher_seller_checks to anon, authenticated;

-- Same as 0014, plus a sighting row for trusted sightings.
create or replace function public.upsert_vouchers(p_items jsonb, p_source text, p_reporter text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  n integer := 0;
  v_id  uuid;
  v_src text;
  v_rep text[];
begin
  if p_source not in ('api', 'extension', 'seed') then
    raise exception 'invalid source %', p_source;
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into vouchers as t (
      marketplace, kind, seller_id, listing_id, code, discount_type, discount_value,
      max_discount, min_spend, starts_at, expires_at, source, reporters
    ) values (
      v->>'marketplace', v->>'kind', nullif(v->>'sellerId', '')::uuid, nullif(v->>'listingId', '')::uuid,
      nullif(v->>'code', ''), v->>'discountType', (v->>'discountValue')::numeric,
      nullif(v->>'maxDiscount', '')::numeric, coalesce(nullif(v->>'minSpend', '')::numeric, 0),
      nullif(v->>'startsAt', '')::timestamptz, nullif(v->>'expiresAt', '')::timestamptz,
      p_source, case when p_reporter is null then '{}'::text[] else array[p_reporter] end
    )
    on conflict (
      marketplace, kind,
      coalesce(seller_id::text, ''), coalesce(listing_id::text, ''), coalesce(code, ''),
      discount_type, discount_value, min_spend
    ) do update set
      last_seen_at = now(),
      max_discount = coalesce(excluded.max_discount, t.max_discount),
      starts_at    = coalesce(excluded.starts_at, t.starts_at),
      expires_at   = coalesce(excluded.expires_at, t.expires_at),
      -- An API sighting outranks extension reports; never downgrade.
      source       = case when t.source = 'api' or excluded.source = 'api' then 'api' else excluded.source end,
      reporters    = case
                       when p_reporter is null or p_reporter = any(t.reporters) or cardinality(t.reporters) >= 20
                         then t.reporters
                       else t.reporters || p_reporter
                     end
    returning t.id, t.source, t.reporters into v_id, v_src, v_rep;
    -- 0063: history, trusted sightings only (the activeVouchers rule).
    if v_src in ('api', 'seed') or cardinality(v_rep) >= 2 then
      insert into voucher_sightings (voucher_id, day)
      values (v_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date)
      on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.upsert_vouchers(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.upsert_vouchers(jsonb, text, text) to service_role;

-- A source answered for this seller today with p_vouchers_seen shop vouchers (0 counts: we looked).
create or replace function public.record_voucher_check(p_seller_id uuid, p_vouchers_seen integer)
returns void
language sql security definer set search_path = public as $$
  insert into voucher_seller_checks (seller_id, day, vouchers_seen)
  values (p_seller_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, greatest(coalesce(p_vouchers_seen, 0), 0))
  on conflict (seller_id, day) do update
    set vouchers_seen = greatest(voucher_seller_checks.vouchers_seen, excluded.vouchers_seen)
$$;
revoke execute on function public.record_voucher_check(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_voucher_check(uuid, integer) to service_role;

-- Shop voucher history of one seller over the last p_days (clamped 30..180) Vietnam days. Invoker: the tables
-- are public read. A "shape" = (discount_type, discount_value, max_discount, min_spend); codes of one shape merge.
create or replace function public.seller_voucher_history(p_seller_id uuid, p_days integer default 90)
returns jsonb
language sql stable set search_path = public as $$
  with win as (
    select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today,
           least(greatest(coalesce(p_days, 90), 30), 180) as days
  ),
  checks as (
    select c.day from voucher_seller_checks c, win
    where c.seller_id = p_seller_id and c.day > win.today - win.days and c.day <= win.today
  ),
  sights as (
    select v.discount_type, v.discount_value, v.max_discount, v.min_spend,
           bool_or(v.code is not null) as has_code,
           array_agg(distinct s.day order by s.day) as days
    from vouchers v
    join voucher_sightings s on s.voucher_id = v.id
    cross join win
    where v.seller_id = p_seller_id and v.kind = 'shop'
      and s.day > win.today - win.days and s.day <= win.today
    group by v.discount_type, v.discount_value, v.max_discount, v.min_spend
  ),
  ranked as (
    select * from sights order by cardinality(days) desc, discount_value desc limit 20
  )
  select jsonb_build_object(
    'check_days', (select count(*) from checks),
    'first_check_day', (select min(day)::text from checks),
    'check_months', coalesce((select jsonb_agg(m order by m)
                              from (select distinct to_char(day, 'YYYY-MM') as m from checks) x), '[]'::jsonb),
    'shapes', coalesce((select jsonb_agg(jsonb_build_object(
                          'discount_type', r.discount_type,
                          'discount_value', r.discount_value,
                          'max_discount', r.max_discount,
                          'min_spend', r.min_spend,
                          'has_code', r.has_code,
                          'days', (select jsonb_agg(d::text order by d) from unnest(r.days[1:180]) d))
                        order by cardinality(r.days) desc, r.discount_value desc)
                        from ranked r), '[]'::jsonb))
$$;
grant execute on function public.seller_voucher_history(uuid, integer) to anon, authenticated, service_role;
