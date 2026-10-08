-- 0061 — alert_events gets more than one source (roadmap P4 E/F, spec §1.1).
--
-- An alert used to need a watch (alert_events.watch_id NOT NULL; claim / RLS / dispatch joined watches). Saved
-- searches (0060) and demand follows (0060) are two more sources. They reuse the same alert_deliveries rows,
-- claim, retry, idempotency key, quiet hours, digests and unsubscribe — "through the existing dispatch".
--
-- - alert_events.user_id (backfilled from watches; filled by a trigger for watch alerts, so
--   record_watch_evaluation (0041 body) is NOT redefined).
-- - exactly one source per row; the two new trigger kinds go only with their own source column, alone.
-- - items / items_total: snapshot of the ≤ 5 products a discovery alert names, and how many matched.
-- - RLS policies alerts_owner_select (0001) / deliveries_owner_select (0006) now go by alert_events.user_id.
-- - claim_due_deliveries: the 0028 body without the join to watches (watch_id may be null now).
-- - The (user_id, created_at) index is built CONCURRENTLY in 0066.

alter table public.alert_events alter column watch_id drop not null;

alter table public.alert_events
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists saved_search_id uuid references public.saved_searches(id) on delete cascade,
  add column if not exists demand_follow_id uuid references public.demand_follows(id) on delete cascade,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists items_total smallint;

update public.alert_events e set user_id = w.user_id
from public.watches w
where w.id = e.watch_id and e.user_id is null;

-- default auth.uid(): null for the service role (the only writer); it only keeps the column optional in the
-- generated Insert type. alert_events_fill_user() sets the real owner.
alter table public.alert_events alter column user_id set not null;
alter table public.alert_events alter column user_id set default auth.uid();

alter table public.alert_events drop constraint if exists alert_events_items_valid;
alter table public.alert_events add constraint alert_events_items_valid check (
  jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 5
);
alter table public.alert_events drop constraint if exists alert_events_items_total_valid;
alter table public.alert_events add constraint alert_events_items_total_valid check (
  items_total is null or items_total > 0
);
alter table public.alert_events drop constraint if exists alert_events_one_source;
alter table public.alert_events add constraint alert_events_one_source check (
  num_nonnulls(watch_id, saved_search_id, demand_follow_id) = 1
);

-- 0041 list + the two discovery kinds.
alter table public.alert_events drop constraint if exists alert_trigger_types_valid;
alter table public.alert_events add constraint alert_trigger_types_valid check (
  cardinality(trigger_types) > 0 and trigger_types <@
  array['target_price','drop_pct','low','deal_score','back_in_stock','deeper_drop','price_hike',
        'saved_search','demand_found']::text[]
);
-- A watch alert never carries a discovery kind; a discovery alert carries exactly its own kind.
alter table public.alert_events drop constraint if exists alert_events_source_triggers;
alter table public.alert_events add constraint alert_events_source_triggers check (
  (watch_id is not null) = not (trigger_types && array['saved_search','demand_found']::text[])
  and (saved_search_id is null or trigger_types = array['saved_search']::text[])
  and (demand_follow_id is null or trigger_types = array['demand_found']::text[])
);

-- New all-null columns: the build is a cheap scan. The large user_id index is 0066 (concurrently).
create index if not exists idx_alert_events_saved_search on public.alert_events (saved_search_id)
  where saved_search_id is not null;
create index if not exists idx_alert_events_demand_follow on public.alert_events (demand_follow_id)
  where demand_follow_id is not null;

create or replace function public.alert_events_fill_user()
returns trigger language plpgsql set search_path = public as $$
begin
  -- A watch alert always belongs to the watch owner, whatever the insert said.
  if new.watch_id is not null then
    new.user_id := (select w.user_id from watches w where w.id = new.watch_id);
  end if;
  return new;
end $$;
revoke execute on function public.alert_events_fill_user() from public, anon, authenticated;
drop trigger if exists alert_events_fill_user on public.alert_events;
create trigger alert_events_fill_user before insert on public.alert_events
  for each row execute function public.alert_events_fill_user();

-- RLS by the event's own owner column.
drop policy if exists "alerts_owner_select" on public.alert_events;
create policy "alerts_owner_select" on public.alert_events
  for select using ((select auth.uid()) = user_id);

drop policy if exists "deliveries_owner_select" on public.alert_deliveries;
create policy "deliveries_owner_select" on public.alert_deliveries for select using (
  exists (select 1 from alert_events e
          where e.id = alert_deliveries.alert_event_id and e.user_id = (select auth.uid()))
);

-- Same as 0028 except the last update: no join to watches (watch_id may be null), user_id from the event.
create or replace function public.claim_due_deliveries(p_now timestamptz, p_limit integer)
returns table (delivery_id uuid, channel text, attempts smallint,
               alert_event_id uuid, watch_id uuid, user_id uuid)
language sql set search_path = public as $$
  -- Out of attempts (3 = MAX_DELIVERY_ATTEMPTS): stop, do not reclaim.
  update alert_deliveries d
     set status = 'failed',
         attempts = d.attempts + 1,
         last_error = coalesce(d.last_error, 'stuck in sending (result not recorded)')
   where d.id in (
           select x.id from alert_deliveries x
           where x.status = 'sending'
             and x.claimed_at < p_now - interval '15 minutes'
             and x.attempts + 1 >= 3
           for update skip locked)
     and d.status = 'sending';

  with due as (
    select d.id from alert_deliveries d
    where (d.status = 'pending' and d.next_attempt_at <= p_now)
       or (d.status = 'sending' and d.claimed_at < p_now - interval '15 minutes')
    order by d.next_attempt_at
    limit p_limit
    for update skip locked
  )
  update alert_deliveries d
     set status = 'sending',
         claimed_at = p_now,
         -- d.status is the value before this update: a reclaimed row counts the lost attempt.
         attempts = case when d.status = 'sending' then d.attempts + 1 else d.attempts end
  from due, alert_events e
  where d.id = due.id and e.id = d.alert_event_id
  returning d.id, d.channel, d.attempts, e.id, e.watch_id, e.user_id
$$;
revoke execute on function public.claim_due_deliveries(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_deliveries(timestamptz, integer) to service_role;
