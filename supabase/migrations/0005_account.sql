-- 0005_account.sql: account settings, terms consent, notification_settings
alter table public.users add column if not exists consent_at timestamptz;

-- 0001 let users INSERT/UPDATE their entire own row. Consequence: they could write
-- consent_version themselves (faking consent) or clear deleted_at (self-restore after
-- the grace period). Rows are created by a trigger; only marketing_opt_in belongs to the user.
drop policy if exists "users_insert_self" on public.users;
revoke insert, update, delete on public.users from anon, authenticated;
grant update (marketing_opt_in) on public.users to authenticated;

create table if not exists public.notification_settings (
  user_id       uuid primary key references public.users(id) on delete cascade,
  email_enabled boolean  not null default true,
  push_enabled  boolean  not null default false,
  frequency     text     not null default 'instant'
                check (frequency in ('instant', 'daily_digest')),
  digest_hour   smallint not null default 8 check (digest_hour between 0 and 23),
  quiet_start   smallint check (quiet_start between 0 and 23),   -- Vietnam time
  quiet_end     smallint check (quiet_end between 0 and 23),
  updated_at    timestamptz not null default now(),
  constraint notification_quiet_pair  check ((quiet_start is null) = (quiet_end is null)),
  constraint notification_quiet_range check (quiet_start is null or quiet_start <> quiet_end)
);

alter table public.notification_settings enable row level security;

drop policy if exists "notif_select_own" on public.notification_settings;
create policy "notif_select_own" on public.notification_settings
  for select using (auth.uid() = user_id);

drop policy if exists "notif_update_own" on public.notification_settings;
create policy "notif_update_own" on public.notification_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.notification_settings to authenticated;
grant update (email_enabled, push_enabled, frequency, digest_hour,
              quiet_start, quiet_end, updated_at)
  on public.notification_settings to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, auth_provider)
  values (new.id, new.email, new.raw_app_meta_data->>'provider')
  on conflict (id) do nothing;

  insert into public.notification_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Users created before this migration
insert into public.notification_settings (user_id)
select id from public.users
on conflict (user_id) do nothing;

alter table public.watches alter column channels drop default;
alter table public.watches alter column channels drop not null;
update public.watches set channels = null;

alter table public.watches drop constraint if exists watches_channels_valid;
alter table public.watches add constraint watches_channels_valid check (
  channels is null
  or (cardinality(channels) > 0 and channels <@ array['email', 'push']::text[])
);
