-- Sidekick beta backend schema, version 2 (2026-10-15). Applied after schema.sql by `node scripts/migrate.mjs`.
-- Idempotent: safe to run twice. Adds the Google account for the Play test list, the play_added state between
-- approved and issued, and one-use unsubscribe links for update emails.
alter table signups add column if not exists google_email text;
alter table signups add column if not exists play_added_at timestamptz;
alter table signups drop constraint if exists signups_state_check;
alter table signups add constraint signups_state_check check (state in ('pending_email', 'approved', 'play_added', 'waitlisted', 'denied', 'issued', 'delivered'));
alter table email_links drop constraint if exists email_links_purpose_check;
alter table email_links add constraint email_links_purpose_check check (purpose in ('signup_confirm', 'marketing_confirm', 'roadmap_confirm', 'access', 'unsubscribe'));
create index if not exists signups_google on signups (google_email);
insert into schema_migrations (version) values (2) on conflict do nothing;
