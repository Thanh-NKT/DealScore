-- 0044 — Deal Score transparency page (roadmap P2 item I).
--
-- deal_score_accuracy(p_weeks): the aggregate rows of backtest_runs from the last p_weeks weeks (clamped
-- 1..52), newest first, at most 200 rows. SECURITY DEFINER so anon can read these counts while the table itself
-- stays closed (backtest_runs has no anon / authenticated grant). The page recomputes rates from the counts
-- (src/lib/transparency/accuracy.ts) and only publishes the live Deal Score version.

create or replace function public.deal_score_accuracy(p_weeks integer default 12)
returns table (
  ran_at timestamptz, version text, horizon_days integer, drop_threshold numeric, variants integer, samples integer,
  buy_n integer, buy_correct integer, wait_n integer, wait_correct integer, avoid_n integer, avoid_correct integer,
  accuracy numeric
) language sql stable security definer set search_path = public as $$
  select b.ran_at, b.version, b.horizon_days, b.drop_threshold, b.variants, b.samples,
         b.buy_n, b.buy_correct, b.wait_n, b.wait_correct, b.avoid_n, b.avoid_correct, b.accuracy
  from backtest_runs b
  where b.ran_at > now() - make_interval(weeks => least(greatest(coalesce(p_weeks, 12), 1), 52))
  order by b.ran_at desc
  limit 200
$$;

revoke execute on function public.deal_score_accuracy(integer) from public;
grant execute on function public.deal_score_accuracy(integer) to anon, authenticated, service_role;
