-- Final roadmap review I1: a params edit re-baselines (params_version + 1, initialized_at null, hits cleared) but
-- kept last_evaluated_at, so a search evaluated in the last SAVED_SEARCH_EVAL_INTERVAL_HOURS was "not due": the
-- save action's immediate baseline evaluated nothing, and the real baseline came at the next due pass, absorbing
-- every product that entered in between (a missed alert). Now the edit also nulls last_evaluated_at, so the row is
-- due at once — for the action's baseline and, if that fails, at the head of the next cron run (nulls first).
-- Redefined from the 0060 body (not redefined since); only the `new.last_evaluated_at := null` line is new.

-- Definer: the re-baseline deletes engine rows the user cannot touch.
create or replace function public.saved_searches_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.params is distinct from old.params then
    -- Re-baseline: whatever matches the new params today is not news.
    new.params_version := old.params_version + 1;
    new.initialized_at := null;
    new.last_evaluated_at := null;
    delete from saved_search_hits where saved_search_id = new.id;
  end if;
  if (new.name, new.params, new.status, new.channels) is distinct from
     (old.name, old.params, old.status, old.channels) then
    new.updated_at := now();
  end if;
  return new;
end $$;

revoke execute on function public.saved_searches_before_update() from public, anon, authenticated;
