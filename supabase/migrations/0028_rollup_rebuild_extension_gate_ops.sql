-- 0028 — follow-ups to the review of the review fixes (review-fixes I-1, I-2, I-3, M-4, M-8, M-9, M-11).
--
--   1. rebuild_variant_rollups(p_after, p_limit): the one-time rebuild of every variant's history under the
--      history rule (offer_in_history(), 0022), batched and resumable. Each call rebuilds the next p_limit
--      variants (by id) in its own transaction and returns the cursor. Run by `pnpm rollup:rebuild`.
--   2. refresh_variant_current_price: an extension-sourced observation sets the current price — and with it
--      the cached verdict and the watch alerts — only once a trusted (API / collector / seed) observation of
--      the same offer confirms it: within 24h and within 2% (TOLERANCE / WINDOW_HOURS in
--      src/lib/extension/corroborate.ts — keep in sync). A peer-only promotion still enters the history.
--   3. admin_set_listings_active: undoes an admin deactivation (record_observations never does). Only for
--      listings the admin deactivated; rebuilds their history; audit-logged like the other admin RPCs.
--   4. claim_due_deliveries: the "out of attempts" statement skips rows another claimer holds.
--   5. prune_operational_data: also deletes used / expired TikTok OAuth nonces (job_locks 'tiktok-oauth:%').
--   6. Default privileges: tables created later get the same tightening as 0023 §7.

-- 1 ---------------------------------------------------------------------------
create or replace function public.rebuild_variant_rollups(p_after uuid default null, p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_ids   uuid[];
  v_n     integer;
begin
  select coalesce(array_agg(id order by id), '{}') into v_ids
  from (select id from product_variants
        where p_after is null or id > p_after
        order by id
        limit v_limit) s;
  v_n := cardinality(v_ids);
  perform admin_rebuild_variant_rollup(v_ids);
  return jsonb_build_object('processed', v_n,
                            'last_id', case when v_n > 0 then v_ids[v_n] end,
                            'done', v_n < v_limit);
end $$;
revoke execute on function public.rebuild_variant_rollups(uuid, integer) from public, anon, authenticated;
grant execute on function public.rebuild_variant_rollups(uuid, integer) to service_role;

-- 2 ---------------------------------------------------------------------------
-- Same as 0022, plus the extension gate in the `latest` lateral.
create or replace function public.refresh_variant_current_price(p_variant_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_variant_ids is null or cardinality(p_variant_ids) = 0 then
    return;
  end if;

  with visible as (
    select o.id as offer_id, o.variant_id
    from offers o
    join listings l          on l.id = o.listing_id
    join product_variants pv on pv.id = o.variant_id
    join products pr         on pr.id = pv.product_id
    where o.variant_id = any(p_variant_ids)
      and offer_is_visible(o.match_status, l.status, pr.status)
  ),
  latest as (
    select vis.variant_id, vis.offer_id, lt.price, lt.original_price, lt.stock, lt.is_flash_sale, lt.observed_at
    from visible vis
    join lateral (
      select po.price, po.original_price, po.stock, po.is_flash_sale, po.observed_at
      from price_observations po
      where po.offer_id = vis.offer_id and po.is_valid and po.price is not null and po.price > 0
        -- Extension prices come from users' browsers: only once a trusted observation agrees.
        and (po.source <> 'extension' or exists (
              select 1 from price_observations t
              where t.offer_id = po.offer_id
                and t.source <> 'extension'
                and t.is_valid and t.price is not null and t.price > 0
                and t.observed_at between po.observed_at - interval '24 hours'
                                      and po.observed_at + interval '24 hours'
                and abs(t.price - po.price) <= 0.02 * greatest(t.price, po.price)))
      order by po.observed_at desc
      limit 1
    ) lt on true
  ),
  ranked as (
    select latest.*,
           count(*) over (partition by variant_id) as n_offers,
           row_number() over (
             partition by variant_id
             order by (coalesce(stock, 1) > 0) desc,
                      case when coalesce(stock, 1) > 0 then price end asc nulls last,
                      observed_at desc
           ) as rn
    from latest
  ),
  upserted as (
    insert into variant_current_price as t (variant_id, best_offer_id, price, original_price,
                                            is_flash_sale, in_stock, offer_count, observed_at)
    select variant_id, offer_id, price, original_price, is_flash_sale,
           coalesce(stock, 1) > 0, n_offers, observed_at
    from ranked
    where rn = 1
    order by variant_id
    on conflict (variant_id) do update set
      best_offer_id  = excluded.best_offer_id,
      price          = excluded.price,
      original_price = excluded.original_price,
      is_flash_sale  = excluded.is_flash_sale,
      in_stock       = excluded.in_stock,
      offer_count    = excluded.offer_count,
      observed_at    = excluded.observed_at
    returning t.variant_id
  )
  -- No visible offer with an observation left → no current price.
  delete from variant_current_price vcp
  where vcp.variant_id = any(p_variant_ids)
    and not exists (select 1 from upserted u where u.variant_id = vcp.variant_id);
end $$;
revoke execute on function public.refresh_variant_current_price(uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_variant_current_price(uuid[]) to service_role;

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_set_listings_active(p_listing_ids uuid[], p_note text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; v_vids uuid[];
begin
  -- Only an admin deactivation is undone: a listing the marketplace reported gone comes back by itself
  -- when the collector sees it again.
  update listings set status = 'active', deactivated_by = null
   where id = any(p_listing_ids) and deactivated_by = 'admin';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 0;
  end if;
  select coalesce(array_agg(distinct o.variant_id) filter (where o.variant_id is not null), '{}') into v_vids
  from offers o where o.listing_id = any(p_listing_ids);
  -- Its past prices return to the history (offer_in_history()), its latest one to the current price.
  perform admin_rebuild_variant_rollup(v_vids);
  perform admin_log('listing.reactivate', 'listing', null, null, jsonb_build_object('listing_ids', to_jsonb(p_listing_ids)), p_note);
  return v_n;
end $$;
revoke execute on function public.admin_set_listings_active(uuid[], text) from public, anon, authenticated;
grant execute on function public.admin_set_listings_active(uuid[], text) to service_role;

-- 4 ---------------------------------------------------------------------------
-- Same as 0025, except the "out of attempts" update locks its rows with SKIP LOCKED, like the claim.
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
  from due, alert_events e, watches w
  where d.id = due.id and e.id = d.alert_event_id and w.id = e.watch_id
  returning d.id, d.channel, d.attempts, e.id, w.id, w.user_id
$$;
revoke execute on function public.claim_due_deliveries(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_due_deliveries(timestamptz, integer) to service_role;

-- 5 ---------------------------------------------------------------------------
-- Same as 0024, plus TikTok OAuth nonces. A state is valid 30 minutes (STATE_TTL_MS); a used nonce has
-- locked_until = -infinity. Deleting a nonce can never re-enable it: consumeState() needs the row.
create or replace function public.prune_operational_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_contrib  integer := 0;
  v_cron     integer := 0;
  v_http     integer := 0;
  v_peer     integer := 0;
  v_counters integer := 0;
  v_nonces   integer := 0;
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
                            'peer_keys_cleared', v_peer, 'rate_counters', v_counters, 'oauth_nonces', v_nonces);
end $$;
revoke execute on function public.prune_operational_data() from public, anon, authenticated;
grant execute on function public.prune_operational_data() to service_role;

-- 6 ---------------------------------------------------------------------------
-- 0023 §7 tightened the tables that existed then; Supabase's default privileges still grant ALL on new
-- tables to anon / authenticated. Same rule for tables created later by this role (the migration owner).
-- A new user-owned table still grants its writes to authenticated explicitly (with RLS).
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;
