-- 0025: a stale 'sending' delivery counts an attempt when it is reclaimed (review-user M1).
--
-- A delivery stays 'sending' when the dispatcher died, or could not record the result, after it
-- claimed the row. claim_due_deliveries reclaims such rows after 15 minutes. Before this migration
-- the reclaim did not touch `attempts`, so that path ignored the retry cap (MAX_DELIVERY_ATTEMPTS = 3
-- in src/lib/watch/constants.ts): a row whose send succeeded but whose bookkeeping kept failing could
-- be sent again and again.
--
-- Now:
--   * reclaiming a stale 'sending' row increments `attempts`;
--   * a stale row that has used its attempts becomes 'failed' instead of being sent again.
-- Return shape and grants are unchanged.

create or replace function public.claim_due_deliveries(p_now timestamptz, p_limit integer)
returns table (delivery_id uuid, channel text, attempts smallint,
               alert_event_id uuid, watch_id uuid, user_id uuid)
language sql set search_path = public as $$
  -- Out of attempts (3 = MAX_DELIVERY_ATTEMPTS): stop, do not reclaim.
  update alert_deliveries d
     set status = 'failed',
         attempts = d.attempts + 1,
         last_error = coalesce(d.last_error, 'stuck in sending (result not recorded)')
   where d.status = 'sending'
     and d.claimed_at < p_now - interval '15 minutes'
     and d.attempts + 1 >= 3;

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
  from due, alert_events e, watches w
  where d.id = due.id and e.id = d.alert_event_id and w.id = e.watch_id
  returning d.id, d.channel, d.attempts, e.id, w.id, w.user_id
$$;

revoke execute on function public.claim_due_deliveries(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_deliveries(timestamptz, integer) to service_role;
