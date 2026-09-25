-- 0013_extension.sql: Chrome extension contributions (Phase 2)
--
-- Prices read by the extension from pages users are viewing (opt-in). Stored raw here; they only
-- enter price_observations (source 'extension') once corroborated — see
-- src/lib/extension/corroborate.ts (the ONE implementation of the rule).

create table if not exists public.extension_observations (
  id             bigint generated always as identity primary key,
  offer_id       uuid not null references public.offers(id) on delete cascade,
  -- users.id for signed-in contributors, otherwise a salted IP hash. Never an email.
  contributor    text not null,
  observed_at    timestamptz not null,
  price          numeric(14,2) not null check (price > 0),
  original_price numeric(14,2),
  stock          integer,
  free_shipping  boolean,
  has_voucher    boolean,
  promoted_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_ext_obs_offer_time on public.extension_observations (offer_id, observed_at desc);
create index if not exists idx_ext_obs_contributor_time on public.extension_observations (contributor, created_at desc);

alter table public.extension_observations enable row level security;
revoke all on public.extension_observations from anon, authenticated;

-- Quota: 60 contributions / hour / contributor, checked and recorded atomically (same pattern as
-- lookup_begin in 0004 — check-then-write in the app cannot stop concurrent bursts).
create table if not exists public.extension_contributions (
  id          bigint generated always as identity primary key,
  contributor text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ext_contrib on public.extension_contributions (contributor, created_at desc);
alter table public.extension_contributions enable row level security;
revoke all on public.extension_contributions from anon, authenticated;

create or replace function public.extension_contribution_begin(p_contributor text, p_limit integer default 60)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = public as $$
declare v_count integer; v_oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('ext:contrib:' || p_contributor));
  select count(*), min(created_at) into v_count, v_oldest
  from extension_contributions
  where contributor = p_contributor and created_at > now() - interval '1 hour';
  if v_count >= p_limit then
    return query select false, greatest(1, extract(epoch from (v_oldest + interval '1 hour' - now()))::integer);
    return;
  end if;
  insert into extension_contributions (contributor) values (p_contributor);
  return query select true, 0;
end $$;

revoke execute on function public.extension_contribution_begin(text, integer) from public, anon, authenticated;
grant execute on function public.extension_contribution_begin(text, integer) to service_role;
