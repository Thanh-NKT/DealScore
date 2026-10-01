-- 0017 — real marketplace data sources (spec 2026-10-01-nguon-du-lieu-that-logic).
--   1. ingest_listing(p): marketplace-generic ingest; ingest_shopee_item becomes a wrapper.
--   2. marketplace_credentials: TikTok Shop OAuth tokens (service role only).
--   3. sourcing_queries / sourcing_runs: automatic product sourcing.
--   4. collector_runs.per_marketplace.
--   5. pg_cron 'kairo-sourcing'.

-- ============================================================================
-- 1. ingest_listing
-- ============================================================================
-- Payload: as ingest_shopee_item (0008) plus
--   marketplace       text, required, one of shopee | tiktok | lazada
--   refresh_priority  integer 1..3, default 1 — only for new listings; never lowers an existing one.
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
      if v_product_id is null then
        v_n := 1;
        loop
          v_slug := case when v_n = 1 then v_base else v_base || '-' || v_n end;
          begin
            insert into products (canonical_name, status, slug, specs)
            values (p->>'title', 'draft', v_slug, '{}'::jsonb)
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
  perform refresh_variant_daily_prices(v_today, v_today);

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

-- The old entry point keeps working (seed scripts, tests) and is always Shopee.
create or replace function public.ingest_shopee_item(p jsonb)
returns jsonb
language sql security definer set search_path = public as $$
  select public.ingest_listing(p || jsonb_build_object('marketplace', 'shopee'))
$$;
revoke execute on function public.ingest_shopee_item(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_shopee_item(jsonb) to service_role;

-- ============================================================================
-- 2. marketplace_credentials — OAuth tokens (TikTok Shop). Service role only.
-- ============================================================================
create table if not exists public.marketplace_credentials (
  marketplace        text primary key check (marketplace in ('tiktok')),
  access_token       text not null,
  access_expires_at  timestamptz not null,
  refresh_token      text not null,
  refresh_expires_at timestamptz not null,
  updated_at         timestamptz not null default now()
);
alter table public.marketplace_credentials enable row level security;
revoke all on public.marketplace_credentials from anon, authenticated;

-- ============================================================================
-- 3. Sourcing — which searches feed the catalog, and what each run did.
-- ============================================================================
create table if not exists public.sourcing_queries (
  id          uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('shopee', 'tiktok')),
  kind        text not null check (kind in ('keyword', 'category')),
  value       text not null,
  active      boolean not null default true,
  next_page   text,
  last_run_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (marketplace, kind, value)
);
alter table public.sourcing_queries enable row level security;
revoke all on public.sourcing_queries from anon, authenticated;

-- Start with one keyword query per Kairo category on each marketplace (edit in Supabase Studio).
insert into public.sourcing_queries (marketplace, kind, value)
select mk.m, 'keyword', c.name
from public.categories c
cross join (values ('shopee'), ('tiktok')) as mk(m)
on conflict (marketplace, kind, value) do nothing;

create table if not exists public.sourcing_runs (
  id               uuid primary key default gen_random_uuid(),
  marketplace      text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  queries          integer not null default 0,
  seen             integer not null default 0,
  ingested         integer not null default 0,
  skipped_existing integer not null default 0,
  failed           integer not null default 0,
  error_summary    text
);
create index if not exists sourcing_runs_marketplace_started_idx on public.sourcing_runs (marketplace, started_at desc);
alter table public.sourcing_runs enable row level security;
revoke all on public.sourcing_runs from anon, authenticated;

-- ============================================================================
-- 4. collector_runs — per-marketplace counters { "shopee": { ok, failed, aborted }, … }
-- ============================================================================
alter table public.collector_runs add column if not exists per_marketplace jsonb;

-- ============================================================================
-- 5. Schedule — 02:41 Vietnam time (= 19:41 UTC), same Vault pattern as 0006 / 0009.
-- ============================================================================
select cron.schedule('kairo-sourcing', '41 19 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kairo_app_url')
               || '/api/cron/sourcing',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'kairo_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
