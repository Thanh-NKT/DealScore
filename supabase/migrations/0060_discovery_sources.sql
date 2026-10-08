-- 0060 — Discovery alert sources (roadmap P4 items E and F).
-- Spec: docs/superpowers/specs/2026-10-07-roadmap-p4-site-logic.md §2.1, §3.1, §9.
--
-- 1. saved_searches + saved_search_hits (E): a frozen set of search params that must narrow by price and/or
--    verdict. Alerts only when a product ENTERS the match set; what matched at save time is the baseline.
-- 2. demand_follows (F): opt-in, signed-in only. Stores the user, the CLEANED keyword (demandKeyword()), at most
--    3 product ids already found, status and timestamps. Nothing else (no raw query, IP, filters or session).
-- 3. record_saved_search_evaluation / record_demand_follow_check: service-role engine writes, mirroring
--    record_watch_evaluation. They insert alert_events rows WITHOUT a watch (columns added by 0061; plpgsql
--    binds them at call time) so delivery reuses alert_deliveries + claim_due_deliveries + dispatch.
-- 4. admin_demand_follow_counts (admin spec §1.3): aggregate waiting counts per keyword, never user ids.
-- 5. prune_operational_data redefined from 0028 (+ finished follows, old out-of-set hits).
-- 6. analytics_events_name_check re-created from 0015 (+ 4 events).
-- 7. pg_cron 'dealscore-discovery-alerts' (same Vault / net.http_post pattern as 0029).

-- ============================================================================
-- 1. saved searches
-- ============================================================================
-- Mirrors parseSavedParams() (src/lib/saved-search/params.ts); tests/db/saved-searches.test.ts runs one fixture
-- list through both.
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
  if not ((p ? 'maxPrice') or (p->'onlyBuy') = 'true'::jsonb) then return false; end if;
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

create table if not exists public.saved_searches (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.users(id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 60),
  params            jsonb not null check (public.saved_search_params_valid(params)),
  status            text not null default 'active' check (status in ('active','paused')),
  -- null = account default, like watches.channels
  channels          text[] check (channels is null or channels <@ array['email','push']::text[]),
  -- engine state, service role only:
  params_version    integer not null default 1,
  initialized_at    timestamptz,
  last_evaluated_at timestamptz,
  last_alerted_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists saved_searches_user_params on public.saved_searches (user_id, md5(params::text));
create index if not exists idx_saved_searches_due on public.saved_searches (last_evaluated_at nulls first) where status = 'active';

create table if not exists public.saved_search_hits (
  saved_search_id uuid not null references public.saved_searches(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  in_set          boolean not null,
  first_seen_at   timestamptz not null,
  last_seen_at    timestamptz not null,
  alerted_at      timestamptz,
  alerted_price   numeric(14,2),
  primary key (saved_search_id, product_id)
);
-- product deletes (P3 merge) cascade through this index
create index if not exists idx_saved_search_hits_product on public.saved_search_hits (product_id);

alter table public.saved_searches enable row level security;
drop policy if exists "saved_searches_owner_all" on public.saved_searches;
create policy "saved_searches_owner_all" on public.saved_searches
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.saved_searches from anon, authenticated;
grant select, delete on public.saved_searches to authenticated;
grant insert (name, params, status, channels) on public.saved_searches to authenticated;
grant update (name, params, status, channels) on public.saved_searches to authenticated;

-- Engine state: RLS on, no policy, nothing granted.
alter table public.saved_search_hits enable row level security;
revoke all on public.saved_search_hits from anon, authenticated;

create or replace function public.saved_searches_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.params_version := 1;
  new.initialized_at := null;
  new.last_evaluated_at := null;
  new.last_alerted_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists saved_searches_before_insert on public.saved_searches;
create trigger saved_searches_before_insert before insert on public.saved_searches
  for each row execute function public.saved_searches_before_insert();

-- Definer: the re-baseline deletes engine rows the user cannot touch.
create or replace function public.saved_searches_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.params is distinct from old.params then
    -- Re-baseline: whatever matches the new params today is not news.
    new.params_version := old.params_version + 1;
    new.initialized_at := null;
    delete from saved_search_hits where saved_search_id = new.id;
  end if;
  if (new.name, new.params, new.status, new.channels) is distinct from
     (old.name, old.params, old.status, old.channels) then
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists saved_searches_before_update on public.saved_searches;
create trigger saved_searches_before_update before update on public.saved_searches
  for each row execute function public.saved_searches_before_update();

-- 10 = MAX_SAVED_SEARCHES (src/lib/saved-search/constants.ts).
create or replace function public.saved_searches_enforce_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('saved_searches:' || new.user_id::text));
  if (select count(*) from saved_searches where user_id = new.user_id) >= 10 then
    raise exception 'Mỗi tài khoản lưu tối đa 10 tìm kiếm.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists saved_searches_enforce_limit on public.saved_searches;
create trigger saved_searches_enforce_limit before insert on public.saved_searches
  for each row execute function public.saved_searches_enforce_limit();

-- p_hits: [{ product_id, in_set, alerted, price }]; p_event: null or
-- { items: [...≤5], items_total, price, deal_score, recommendation, deliver_after, channels: [...], cooldown_hours }.
create or replace function public.record_saved_search_evaluation(
  p_id uuid, p_params_version integer, p_now timestamptz, p_hits jsonb, p_event jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row      saved_searches%rowtype;
  v_alerting boolean := p_event is not null;
  v_event_id uuid;
  v_ch       text;
begin
  select s.* into v_row from saved_searches s where s.id = p_id for update;
  if not found or v_row.status <> 'active' or v_row.params_version <> p_params_version then
    return null;
  end if;
  if exists (select 1 from users u where u.id = v_row.user_id and u.deleted_at is not null) then
    return null;
  end if;

  -- Cooldown re-checked under the row lock: a concurrent run cannot fire twice. The held-back entering
  -- products are then not written (their edge stays for a later run).
  if v_alerting and v_row.last_alerted_at is not null
     and v_row.last_alerted_at > p_now - make_interval(hours => coalesce((p_event->>'cooldown_hours')::integer, 24)) then
    v_alerting := false;
  end if;

  update saved_searches set
    last_evaluated_at = p_now,
    initialized_at    = coalesce(initialized_at, p_now),
    last_alerted_at   = case when v_alerting then p_now else last_alerted_at end
  where id = p_id;

  insert into saved_search_hits as t (saved_search_id, product_id, in_set, first_seen_at, last_seen_at,
                                      alerted_at, alerted_price)
  select distinct on (h.product_id)
         p_id, h.product_id, h.in_set, p_now, p_now,
         case when h.alerted then p_now end,
         case when h.alerted then h.price end
  from (
    select (x->>'product_id')::uuid as product_id,
           coalesce((x->>'in_set')::boolean, false) as in_set,
           coalesce((x->>'alerted')::boolean, false) as alerted,
           (x->>'price')::numeric as price
    from jsonb_array_elements(coalesce(p_hits, '[]'::jsonb)) x
  ) h
  where h.product_id is not null
    and exists (select 1 from products p where p.id = h.product_id)   -- merged / deleted since: skip
    and (v_alerting or not h.alerted)
  on conflict (saved_search_id, product_id) do update set
    in_set        = excluded.in_set,
    last_seen_at  = case when excluded.in_set then p_now else t.last_seen_at end,
    alerted_at    = coalesce(excluded.alerted_at, t.alerted_at),
    alerted_price = case when excluded.alerted_at is not null then excluded.alerted_price else t.alerted_price end;

  if not v_alerting then
    return null;
  end if;

  insert into alert_events (user_id, saved_search_id, trigger_types, items, items_total, price,
                            deal_score, recommendation, deliver_after, created_at)
  values (v_row.user_id, p_id, array['saved_search'],
          coalesce(p_event->'items', '[]'::jsonb),
          (p_event->>'items_total')::smallint,
          (p_event->>'price')::numeric,
          (p_event->>'deal_score')::smallint,
          p_event->>'recommendation',
          (p_event->>'deliver_after')::timestamptz, p_now)
  returning id into v_event_id;

  for v_ch in select jsonb_array_elements_text(coalesce(p_event->'channels', '[]'::jsonb)) loop
    insert into alert_deliveries (alert_event_id, channel, next_attempt_at)
    values (v_event_id, v_ch, (p_event->>'deliver_after')::timestamptz);
  end loop;
  return v_event_id;
end $$;

-- ============================================================================
-- 2. demand follows
-- ============================================================================
create table if not exists public.demand_follows (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  keyword           text not null check (char_length(keyword) between 3 and 60),
  known_product_ids uuid[] not null default '{}' check (cardinality(known_product_ids) <= 3),
  status            text not null default 'waiting' check (status in ('waiting','found','expired')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  last_checked_at   timestamptz,
  found_at          timestamptz,
  unique (user_id, keyword)
);
create index if not exists idx_demand_follows_due on public.demand_follows (last_checked_at nulls first) where status = 'waiting';
create index if not exists idx_demand_follows_keyword on public.demand_follows (keyword) where status = 'waiting';

-- Owner reads and cancels (delete). No insert / update grant: the keyword must come from the server-side
-- demandKeyword() (admin client in the action / cron).
alter table public.demand_follows enable row level security;
drop policy if exists "demand_follows_owner_select" on public.demand_follows;
create policy "demand_follows_owner_select" on public.demand_follows
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "demand_follows_owner_delete" on public.demand_follows;
create policy "demand_follows_owner_delete" on public.demand_follows
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.demand_follows from anon, authenticated;
grant select, delete on public.demand_follows to authenticated;

-- 10 = MAX_DEMAND_FOLLOWS (src/lib/demand-follow/constants.ts). Counts the OTHER keywords, so an upsert of an
-- existing keyword (re-follow) is not refused by the insert half of ON CONFLICT.
create or replace function public.demand_follows_enforce_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'waiting' and (tg_op = 'INSERT' or old.status <> 'waiting') then
    perform pg_advisory_xact_lock(hashtext('demand_follows:' || new.user_id::text));
    if (select count(*) from demand_follows
        where user_id = new.user_id and status = 'waiting' and keyword <> new.keyword) >= 10 then
      raise exception 'Bạn đang chờ tối đa 10 tìm kiếm.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists demand_follows_enforce_limit on public.demand_follows;
create trigger demand_follows_enforce_limit before insert or update of status on public.demand_follows
  for each row execute function public.demand_follows_enforce_limit();

-- p_event (only with 'found'): { items, items_total, price, deal_score, recommendation, deliver_after, channels,
-- user_cooldown_hours }. A user with a demand_found alert newer than the cooldown → null, follow stays waiting.
create or replace function public.record_demand_follow_check(
  p_id uuid, p_now timestamptz, p_status text, p_event jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row      demand_follows%rowtype;
  v_event_id uuid;
  v_ch       text;
begin
  if p_status is null or p_status not in ('waiting','found','expired') then
    raise exception 'record_demand_follow_check: trạng thái không hợp lệ';
  end if;
  if p_event is not null and p_status <> 'found' then
    raise exception 'record_demand_follow_check: chỉ báo khi đã có sản phẩm';
  end if;

  select f.* into v_row from demand_follows f where f.id = p_id for update;
  if not found or v_row.status <> 'waiting' then
    return null;
  end if;

  if p_event is not null then
    -- One user's follows found in the same run serialize here, so the per-user cooldown holds.
    perform pg_advisory_xact_lock(hashtext('demand_found:' || v_row.user_id::text));
    if exists (select 1 from users u where u.id = v_row.user_id and u.deleted_at is not null)
       or exists (
         select 1 from alert_events e
         where e.user_id = v_row.user_id and e.trigger_types && array['demand_found']::text[]
           and e.created_at > p_now - make_interval(hours => coalesce((p_event->>'user_cooldown_hours')::integer, 24)))
    then
      update demand_follows set last_checked_at = p_now where id = p_id;
      return null;
    end if;
  end if;

  update demand_follows set
    status          = p_status,
    last_checked_at = p_now,
    found_at        = case when p_status = 'found' then p_now else found_at end
  where id = p_id;

  if p_event is null then
    return null;
  end if;

  insert into alert_events (user_id, demand_follow_id, trigger_types, items, items_total, price,
                            deal_score, recommendation, deliver_after, created_at)
  values (v_row.user_id, p_id, array['demand_found'],
          coalesce(p_event->'items', '[]'::jsonb),
          (p_event->>'items_total')::smallint,
          (p_event->>'price')::numeric,
          (p_event->>'deal_score')::smallint,
          p_event->>'recommendation',
          (p_event->>'deliver_after')::timestamptz, p_now)
  returning id into v_event_id;

  for v_ch in select jsonb_array_elements_text(coalesce(p_event->'channels', '[]'::jsonb)) loop
    insert into alert_deliveries (alert_event_id, channel, next_attempt_at)
    values (v_event_id, v_ch, (p_event->>'deliver_after')::timestamptz);
  end loop;
  return v_event_id;
end $$;

-- Admin "Người chờ" column on the Sourcing page: counts only, never a list of people.
create or replace function public.admin_demand_follow_counts(p_keywords text[])
returns table (keyword text, waiting integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_keywords is null or cardinality(p_keywords) < 1 or cardinality(p_keywords) > 200 then
    raise exception 'admin_demand_follow_counts: danh sách từ khóa không hợp lệ';
  end if;
  return query
    select f.keyword, count(*)::integer
    from demand_follows f
    where f.status = 'waiting' and f.expires_at > now() and f.keyword = any(p_keywords)
    group by f.keyword
    order by f.keyword;
end $$;

-- ============================================================================
-- 3. prune_operational_data — same as 0028, plus finished follows and old out-of-set hits.
-- ============================================================================
create or replace function public.prune_operational_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contrib  integer := 0;
  v_cron     integer := 0;
  v_http     integer := 0;
  v_peer     integer := 0;
  v_counters integer := 0;
  v_nonces   integer := 0;
  v_follows  integer := 0;
  v_hits     integer := 0;
begin
  -- The quota window is one hour.
  delete from extension_contributions where created_at < now() - interval '2 days';
  get diagnostics v_contrib = row_count;
  -- Corroboration reads 48h of contributions; older peer keys are never used again.
  update extension_observations set peer_key = null
  where peer_key is not null and created_at < now() - interval '2 days';
  get diagnostics v_peer = row_count;
  delete from rate_counters where expires_at < now() - interval '1 day';
  get diagnostics v_counters = row_count;
  delete from job_locks where name like 'tiktok-oauth:%' and locked_until < now() - interval '1 day';
  get diagnostics v_nonces = row_count;
  -- 0060: DEMAND_FOLLOW_RETENTION_DAYS (30) after a follow was found or expired.
  delete from demand_follows
  where status in ('found','expired') and coalesce(found_at, expires_at) < now() - interval '30 days';
  get diagnostics v_follows = row_count;
  -- 0060: a product out of the set for 90 days is past SAVED_SEARCH_REALERT_DAYS anyway.
  delete from saved_search_hits where not in_set and last_seen_at < now() - interval '90 days';
  get diagnostics v_hits = row_count;
  begin
    delete from cron.job_run_details where end_time < now() - interval '30 days';
    get diagnostics v_cron = row_count;
  exception when undefined_table or insufficient_privilege then
    v_cron := -1;
  end;
  if to_regclass('net._http_response') is not null then
    begin
      execute 'delete from net._http_response where created < now() - interval ''7 days''';
      get diagnostics v_http = row_count;
    exception when insufficient_privilege or undefined_column then
      v_http := -1;
    end;
  end if;
  return jsonb_build_object('extension_contributions', v_contrib, 'cron_runs', v_cron, 'http_responses', v_http,
                            'peer_keys_cleared', v_peer, 'rate_counters', v_counters, 'oauth_nonces', v_nonces,
                            'demand_follows', v_follows, 'saved_search_hits', v_hits);
end $$;

revoke execute on function public.prune_operational_data() from public, anon, authenticated;
grant execute on function public.prune_operational_data() to service_role;
revoke execute on function public.record_saved_search_evaluation(uuid, integer, timestamptz, jsonb, jsonb),
                           public.record_demand_follow_check(uuid, timestamptz, text, jsonb),
                           public.admin_demand_follow_counts(text[])
  from public, anon, authenticated;
grant execute on function public.record_saved_search_evaluation(uuid, integer, timestamptz, jsonb, jsonb),
                          public.record_demand_follow_check(uuid, timestamptz, text, jsonb),
                          public.admin_demand_follow_counts(text[])
  to service_role;
revoke execute on function public.saved_searches_before_insert(), public.saved_searches_before_update(),
                           public.saved_searches_enforce_limit(), public.demand_follows_enforce_limit()
  from public, anon, authenticated;

-- ============================================================================
-- 4. analytics events — 0015 list + 4 (EVENT_NAMES in src/lib/analytics/events.ts)
-- ============================================================================
alter table public.analytics_events drop constraint if exists analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'signup_completed', 'login_succeeded', 'lookup_submitted', 'search_performed',
  'product_viewed', 'watch_created', 'watch_deleted', 'push_enabled',
  'deal_shared', 'share_opened', 'search_intent_applied', 'preferences_saved',
  'saved_search_created', 'demand_followed', 'folder_shared', 'shared_folder_viewed'));

-- ============================================================================
-- 5. cron: evaluate saved searches + check demand follows (dispatch stays in dealscore-alerts)
-- ============================================================================
select cron.schedule('dealscore-discovery-alerts', '7,22,37,52 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/discovery-alerts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
