-- 0069 — Document alert_events.user_id (P4 review m14). Comment only, no behaviour change.
-- The default auth.uid() (0061) only keeps the generated Insert type optional: the service role (the only writer)
-- gets null from it and the alert_events_fill_user trigger / the record_* RPCs set the owner. Clients cannot
-- insert (0023 revoke, no insert policy) — tests/db/privileges.test.ts asserts 42501.
comment on column public.alert_events.user_id is
  'Owner of the alert. Set by alert_events_fill_user (watch alerts) or the record_* RPCs (discovery alerts). '
  'default auth.uid() exists for the generated types only: clients have no insert privilege (0023).';
