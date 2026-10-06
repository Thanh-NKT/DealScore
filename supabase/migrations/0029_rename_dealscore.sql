-- 0029 — rebrand Kairo → DealScore in the database's operational names.
--
--   1. Vault secrets kairo_app_url / kairo_cron_secret are renamed to dealscore_app_url /
--      dealscore_cron_secret, keeping their values (vault.update_secret only changes the name; the
--      ciphertext is bound to the secret id, not its name). Skipped when the old secret is missing or the
--      new name is already taken.
--   2. The kairo-* pg_cron jobs are unscheduled and rescheduled with identical schedules and commands as
--      dealscore-*, now reading the dealscore_* Vault secrets.
--   3. admin_cron_status() (latest body: 0021) lists dealscore-* jobs. Signature and grants unchanged.

-- 1 ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select s.id, s.name as old_name, 'dealscore_' || substr(s.name, length('kairo_') + 1) as new_name
    from vault.secrets s
    where s.name in ('kairo_app_url', 'kairo_cron_secret')
  loop
    if not exists (select 1 from vault.secrets where name = r.new_name) then
      perform vault.update_secret(r.id, null, r.new_name);
    else
      raise notice 'vault secret % already exists; % left as is', r.new_name, r.old_name;
    end if;
  end loop;
end $$;

-- 2 ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname like 'kairo-%';

select cron.schedule('dealscore-alerts', '*/15 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/alerts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

select cron.schedule('dealscore-conversions', '7 */6 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/conversions',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

select cron.schedule('dealscore-collector', '17 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/collector',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

-- 03:00 Monday, Vietnam time (= 20:00 Sunday UTC).
select cron.schedule('dealscore-backtest', '0 20 * * 0', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/backtest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

-- 02:41 Vietnam time (= 19:41 UTC).
select cron.schedule('dealscore-sourcing', '41 19 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/sourcing',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

select cron.schedule('dealscore-sourcing-demand', '11 */3 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'dealscore_app_url')
               || '/api/cron/sourcing?mode=demand',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                where name = 'dealscore_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

-- 03:23 Vietnam time (= 20:23 UTC).
select cron.schedule('dealscore-retention', '23 20 * * *', $job$ select public.prune_operational_data() $job$);

-- 3 ---------------------------------------------------------------------------
create or replace function public.admin_cron_status()
returns table (jobname text, schedule text, active boolean, last_start timestamptz, last_end timestamptz,
               last_status text, last_message text, failures_24h integer)
language sql stable security definer set search_path = public, cron as $$
  select j.jobname::text, j.schedule::text, j.active,
         lr.start_time, lr.end_time, lr.status::text, left(lr.return_message, 500),
         (select count(*)::integer from cron.job_run_details d
           where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours')
  from cron.job j
  left join lateral (
    select d.start_time, d.end_time, d.status, d.return_message
    from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1
  ) lr on true
  where j.jobname like 'dealscore-%'
  order by j.jobname
$$;
revoke execute on function public.admin_cron_status() from public, anon, authenticated;
grant execute on function public.admin_cron_status() to service_role;
