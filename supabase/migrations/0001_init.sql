-- ============================================================================
-- Personal Shopping Intelligence — Database schema (Backlog v2, section D)
-- Target: Supabase / PostgreSQL
-- Run in Supabase SQL Editor, or via `supabase db push` with this migration.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- products — normalized products
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  brand         text,
  model         text,
  category_id   uuid,
  gtin          text,
  image         text,
  specs         jsonb not null default '{}'::jsonb,
  status        text not null default 'draft' check (status in ('draft','verified')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_products_brand on public.products (brand);
create index if not exists idx_products_category on public.products (category_id);

-- ----------------------------------------------------------------------------
-- product_variants — normalized variants
-- ----------------------------------------------------------------------------
create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  variant_key text not null,                       -- vd: "capacity=2TB, color=black"
  specs       jsonb not null default '{}'::jsonb
);

create index if not exists idx_variants_product on public.product_variants (product_id);

-- ----------------------------------------------------------------------------
-- sellers
-- ----------------------------------------------------------------------------
create table if not exists public.sellers (
  id                 uuid primary key default gen_random_uuid(),
  marketplace        text not null,                -- shopee | tiktok | lazada ...
  external_seller_id text not null,
  name               text,
  rating             numeric(3,2),
  rating_count       integer default 0,
  is_official        boolean not null default false,
  location           text,
  updated_at         timestamptz not null default now(),
  unique (marketplace, external_seller_id)
);

-- ----------------------------------------------------------------------------
-- listings — marketplace listings
-- ----------------------------------------------------------------------------
create table if not exists public.listings (
  id               uuid primary key default gen_random_uuid(),
  marketplace      text not null,
  external_item_id text not null,
  seller_id        uuid references public.sellers(id) on delete set null,
  title            text,
  url              text,
  status           text not null default 'active',
  first_seen_at    timestamptz not null default now(),
  last_observed_at timestamptz,
  refresh_priority integer not null default 3,      -- 1 = highest
  unique (marketplace, external_item_id)
);

create index if not exists idx_listings_refresh on public.listings (refresh_priority, last_observed_at);

-- ----------------------------------------------------------------------------
-- offers — one specific variant within one listing (the unit of price storage)
-- ----------------------------------------------------------------------------
create table if not exists public.offers (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings(id) on delete cascade,
  external_model_id text,
  variant_id        uuid references public.product_variants(id) on delete set null, -- nullable until matched
  match_confidence  numeric(5,4),
  match_status      text not null default 'pending'
                    check (match_status in ('auto','manual','rejected','pending'))
);

create index if not exists idx_offers_listing on public.offers (listing_id);
create index if not exists idx_offers_variant on public.offers (variant_id);
create index if not exists idx_offers_match_status on public.offers (match_status);

-- ----------------------------------------------------------------------------
-- price_observations — time-series data (prices are stored per offer)
-- ----------------------------------------------------------------------------
create table if not exists public.price_observations (
  id             bigint generated always as identity,
  offer_id       uuid not null references public.offers(id) on delete cascade,
  observed_at    timestamptz not null default now(),
  price          numeric(14,2),
  original_price numeric(14,2),
  stock          integer,
  is_flash_sale  boolean not null default false,
  is_valid       boolean not null default true,
  invalid_reason text,
  source         text not null default 'api' check (source in ('api','extension')),
  collector_run_id uuid,
  primary key (id, observed_at)
);
-- Note: partition by month or use TimescaleDB for this table.
create index if not exists idx_price_obs_offer_time
  on public.price_observations (offer_id, observed_at desc);

-- ----------------------------------------------------------------------------
-- match_candidates — matching review queue
-- ----------------------------------------------------------------------------
create table if not exists public.match_candidates (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references public.offers(id) on delete cascade,
  suggested_variant_id uuid references public.product_variants(id) on delete set null,
  confidence          numeric(5,4),
  reason              text,
  reviewed_by         uuid,
  decision            text check (decision in ('accepted','rejected','pending')),
  reviewed_at         timestamptz
);

create index if not exists idx_match_candidates_pending
  on public.match_candidates (decision) where decision = 'pending' or decision is null;

-- ----------------------------------------------------------------------------
-- affiliate_offers
-- ----------------------------------------------------------------------------
create table if not exists public.affiliate_offers (
  offer_id        uuid primary key references public.offers(id) on delete cascade,
  affiliate_url   text,
  short_link      text,
  commission_rate numeric(6,4),
  campaign        text,
  eligible        boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- users — application profile (complements Supabase's auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  auth_provider    text,
  created_at       timestamptz not null default now(),
  marketing_opt_in boolean not null default false,
  consent_version  text,
  deleted_at       timestamptz
);

-- ----------------------------------------------------------------------------
-- watches — Wishlist + Target Price + Alert combined
-- ----------------------------------------------------------------------------
create table if not exists public.watches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  product_id    uuid references public.products(id) on delete cascade,
  variant_id    uuid references public.product_variants(id) on delete cascade,
  target_price  numeric(14,2),
  trigger_rules jsonb not null default '{}'::jsonb,
  channels      text[] not null default array['email']::text[],
  folder        text,
  note          text,
  status        text not null default 'active' check (status in ('active','paused','done')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_watches_user on public.watches (user_id);
create index if not exists idx_watches_variant on public.watches (variant_id);

-- ----------------------------------------------------------------------------
-- alert_events
-- ----------------------------------------------------------------------------
create table if not exists public.alert_events (
  id           uuid primary key default gen_random_uuid(),
  watch_id     uuid not null references public.watches(id) on delete cascade,
  trigger_type text,
  price        numeric(14,2),
  sent_at      timestamptz not null default now(),
  channel      text,
  delivered    boolean,
  opened       boolean,
  clicked      boolean
);

create index if not exists idx_alert_events_watch on public.alert_events (watch_id);

-- ----------------------------------------------------------------------------
-- click_events
-- ----------------------------------------------------------------------------
create table if not exists public.click_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete set null,
  offer_id   uuid references public.offers(id) on delete set null,
  source     text check (source in ('web','extension','email','push')),
  watch_id   uuid references public.watches(id) on delete set null,
  created_at timestamptz not null default now(),
  session_id text
);

create index if not exists idx_click_events_offer on public.click_events (offer_id);

-- ----------------------------------------------------------------------------
-- conversions — reconciliation from the conversion report
-- ----------------------------------------------------------------------------
create table if not exists public.conversions (
  id          uuid primary key default gen_random_uuid(),
  click_ref   text,                                -- click_ref / sub_id
  order_value numeric(14,2),
  commission  numeric(14,2),
  status      text,
  reported_at timestamptz
);

create index if not exists idx_conversions_click_ref on public.conversions (click_ref);

-- ----------------------------------------------------------------------------
-- collector_runs
-- ----------------------------------------------------------------------------
create table if not exists public.collector_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  items_ok      integer not null default 0,
  items_failed  integer not null default 0,
  error_summary text
);

-- ============================================================================
-- Row Level Security — enabled only for data that belongs to users.
-- Catalog & price data are publicly readable; writes go through the service role (bypasses RLS).
-- ============================================================================

alter table public.users        enable row level security;
alter table public.watches      enable row level security;
alter table public.alert_events enable row level security;
alter table public.click_events enable row level security;

-- users: each user sees/edits only their own profile
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);
create policy "users_update_own" on public.users
  for update using (auth.uid() = id);
create policy "users_insert_self" on public.users
  for insert with check (auth.uid() = id);

-- watches: full access for the owner
create policy "watches_owner_all" on public.watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- alert_events: read only alerts of watches you own
create policy "alerts_owner_select" on public.alert_events
  for select using (
    exists (select 1 from public.watches w
            where w.id = alert_events.watch_id and w.user_id = auth.uid())
  );

-- click_events: users can read their own clicks (writes normally go through the service role)
create policy "clicks_owner_select" on public.click_events
  for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Auto-create a public.users profile for every new auth.users row
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, auth_provider)
  values (new.id, new.email, new.raw_app_meta_data->>'provider')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
