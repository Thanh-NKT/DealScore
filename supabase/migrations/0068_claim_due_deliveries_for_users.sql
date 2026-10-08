-- 0068 — claim_due_deliveries_for_users (P4 review I4).
--
-- claim_due_deliveries (0061) claims every due delivery in the database. A caller that owns a known set of
-- users (DB tests, a targeted re-send) must not claim, send or skip anyone else's alerts. This is the 0061
-- body unchanged except that both statements only touch deliveries whose event belongs to p_user_ids.
-- claim_due_deliveries itself is not changed. Service role only.

create or replace function public.claim_due_deliveries_for_users(p_now timestamptz, p_limit integer, p_user_ids uuid[])
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
           join alert_events xe on xe.id = x.alert_event_id
           where x.status = 'sending'
             and x.claimed_at < p_now - interval '15 minutes'
             and x.attempts + 1 >= 3
             and xe.user_id = any(p_user_ids)
           for update of x skip locked)
     and d.status = 'sending';

  with due as (
    select d.id from alert_deliveries d
    join alert_events de on de.id = d.alert_event_id
    where ((d.status = 'pending' and d.next_attempt_at <= p_now)
           or (d.status = 'sending' and d.claimed_at < p_now - interval '15 minutes'))
      and de.user_id = any(p_user_ids)
    order by d.next_attempt_at
    limit p_limit
    for update of d skip locked
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

revoke execute on function public.claim_due_deliveries_for_users(timestamptz, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_due_deliveries_for_users(timestamptz, integer, uuid[]) to service_role;
