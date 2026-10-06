-- 0023 — DB review fixes, user-data side (review-db I4 + minors, review-user I3 / M2 / M8).
--
--   1. extension_observations / extension_contributions get user_id → users(id) ON DELETE CASCADE, derived
--      from contributor 'u:<id>' by a trigger: erasing the account erases the user's contributions.
--   2. public.users.email follows auth.users.email (alerts and the deletion notice went to the old address).
--   3. latest_alerts_for_watches(): one latest alert per watch (the account watch list read every alert and
--      hit PostgREST's silent 1,000-row cap).
--   4. Per-user advisory lock in the 50-watch / 20-folder limit triggers (count-then-insert raced).
--   5. Operational retention job (kairo-retention).
--   6. Pinned search_path on the remaining non-definer functions.
--   7. Privileges: no TRUNCATE (it bypasses RLS) and no writes for anon anywhere in public; no direct writes to
--      alert_events / click_events for authenticated (RLS already denied them); privilege_report() for tests.

-- 1 ---------------------------------------------------------------------------
alter table public.extension_observations
  add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.extension_contributions
  add column if not exists user_id uuid references public.users(id) on delete cascade;
create index if not exists idx_ext_obs_user on public.extension_observations (user_id) where user_id is not null;
create index if not exists idx_ext_contrib_user on public.extension_contributions (user_id) where user_id is not null;

create or replace function public.extension_contributor_user()
returns trigger language plpgsql set search_path = public as $$
begin
  new.user_id := case
    when new.contributor ~* '^u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (select u.id from users u where u.id = substr(new.contributor, 3)::uuid)
  end;
  return new;
end $$;

drop trigger if exists extension_observations_user on public.extension_observations;
create trigger extension_observations_user before insert or update of contributor on public.extension_observations
  for each row execute function public.extension_contributor_user();
drop trigger if exists extension_contributions_user on public.extension_contributions;
create trigger extension_contributions_user before insert or update of contributor on public.extension_contributions
  for each row execute function public.extension_contributor_user();

update public.extension_observations e set user_id = u.id
  from public.users u where e.user_id is null and e.contributor = 'u:' || u.id::text;
update public.extension_contributions e set user_id = u.id
  from public.users u where e.user_id is null and e.contributor = 'u:' || u.id::text;
-- Rows of accounts already purged: the user id is all that links them to a person.
delete from public.extension_observations where user_id is null and contributor like 'u:%';
delete from public.extension_contributions where user_id is null and contributor like 'u:%';

-- 2 ---------------------------------------------------------------------------
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end $$;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

update public.users pu set email = au.email
  from auth.users au where au.id = pu.id and pu.email is distinct from au.email;

-- 3 ---------------------------------------------------------------------------
-- SECURITY INVOKER: RLS on alert_events / alert_deliveries keeps it to the caller's own watches.
create or replace function public.latest_alerts_for_watches(p_watch_ids uuid[])
returns table (id uuid, watch_id uuid, created_at timestamptz, deliver_after timestamptz, deliveries jsonb)
language sql stable set search_path = public as $$
  select e.id, e.watch_id, e.created_at, e.deliver_after,
         coalesce((select jsonb_agg(jsonb_build_object('channel', d.channel, 'status', d.status, 'sent_at', d.sent_at)
                                    order by d.channel)
                   from alert_deliveries d where d.alert_event_id = e.id), '[]'::jsonb)
  from unnest(p_watch_ids[1:1000]) w(id)
  cross join lateral (
    select a.id, a.watch_id, a.created_at, a.deliver_after
    from alert_events a
    where a.watch_id = w.id
    order by a.created_at desc, a.id desc
    limit 1
  ) e
$$;
revoke execute on function public.latest_alerts_for_watches(uuid[]) from public, anon;
grant execute on function public.latest_alerts_for_watches(uuid[]) to authenticated, service_role;

-- 4 ---------------------------------------------------------------------------
create or replace function public.watches_enforce_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    -- Serialize this user's activations: two concurrent inserts must not both see 49.
    perform pg_advisory_xact_lock(hashtext('watches:' || new.user_id::text));
    if (select count(*) from watches
        where user_id = new.user_id and status = 'active' and id <> new.id) >= 50 then
      raise exception 'Đã đạt giới hạn 50 Watch đang hoạt động' using errcode = 'P0050';
    end if;
  end if;
  return new;
end $$;

create or replace function public.watch_folders_enforce_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('watch_folders:' || new.user_id::text));
  if (select count(*) from watch_folders where user_id = new.user_id) >= 20 then
    raise exception 'Mỗi tài khoản có tối đa 20 thư mục.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 5 ---------------------------------------------------------------------------
-- Operational rows only. User-facing history (lookup_requests is in the data export, analytics_events
-- feeds metrics_*, alert_deliveries backs the alert history) keeps its own lifetime.
create or replace function public.prune_operational_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contrib integer := 0;
  v_cron    integer := 0;
  v_http    integer := 0;
begin
  -- The quota window is one hour.
  delete from extension_contributions where created_at < now() - interval '2 days';
  get diagnostics v_contrib = row_count;
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
  return jsonb_build_object('extension_contributions', v_contrib, 'cron_runs', v_cron, 'http_responses', v_http);
end $$;
revoke execute on function public.prune_operational_data() from public, anon, authenticated;
grant execute on function public.prune_operational_data() to service_role;

-- 03:23 Vietnam time (= 20:23 UTC).
select cron.schedule('kairo-retention', '23 20 * * *', $job$ select public.prune_operational_data() $job$);

-- 6 ---------------------------------------------------------------------------
-- f_unaccent is left alone: it backs products.search_text and the search indexes, and a SET clause would
-- stop it from being inlined.
alter function public.latest_price_per_offer(uuid) set search_path = public;
alter function public.variant_tracking_since(uuid) set search_path = public;
alter function public.product_brands() set search_path = public;
alter function public.watches_before_update() set search_path = public;
alter function public.try_acquire_job_lock(text, text, integer) set search_path = public;
alter function public.release_job_lock(text, text) set search_path = public;
alter function public.record_watch_evaluation(uuid, integer, timestamptz, jsonb, jsonb) set search_path = public;
alter function public.claim_due_deliveries(timestamptz, integer) set search_path = public;
alter function public.upsert_conversions(jsonb) set search_path = public;
alter function public.watches_check_folder() set search_path = public;
alter function public.f_capacity_gb(text) set search_path = public;
alter function public.trg_variant_capacity() set search_path = public;
alter function public.intent_vocab() set search_path = public;

-- 7 ---------------------------------------------------------------------------
-- TRUNCATE ignores RLS; anon never writes (every anonymous write goes through a definer RPC or the service
-- role); alert_events / click_events are written only by the service role.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke insert, update, delete on all tables in schema public from anon;
revoke insert, update, delete on public.alert_events, public.click_events from authenticated;

-- Which public tables anon / authenticated can write, and which SECURITY DEFINER functions they can call.
-- tests/db/privileges.test.ts compares this with an allow-list, so a new grant has to be deliberate.
create or replace function public.privilege_report()
returns table (kind text, object text, grantee text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select 'table_write', c.relname::text, r.rolname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    and (has_any_column_privilege(r.rolname, c.oid, 'INSERT')
         or has_any_column_privilege(r.rolname, c.oid, 'UPDATE')
         or has_table_privilege(r.rolname, c.oid, 'DELETE')
         or has_table_privilege(r.rolname, c.oid, 'TRUNCATE'))
  union all
  select 'definer_execute', p.oid::regprocedure::text, r.rolname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) r(rolname)
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  order by 1, 2, 3
$$;
revoke execute on function public.privilege_report() from public, anon, authenticated;
grant execute on function public.privilege_report() to service_role;
