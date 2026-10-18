-- Sidekick beta backend schema, version 3 (2026-10-18, the one-click download flow). Applied after schema-v2.sql.
-- Idempotent: safe to run twice. Adds the token pool the signer fills from the owner's Mac, Mac-only sign-ups (no
-- phone model, Google account or chip), the "Email me a copy" and Android-invitation marks, and a download counter
-- that holds no personal data.
alter table signups alter column phone_model drop not null;
alter table signups alter column mac_chip drop not null;
alter table signups add column if not exists token_source text;
alter table signups add column if not exists copy_emailed_at timestamptz;
alter table signups add column if not exists android_invited_at timestamptz;
create table if not exists token_pool (
  id uuid primary key,
  token text not null unique,
  not_after timestamptz not null,
  created_at timestamptz not null,
  issued_at timestamptz,
  signup_id uuid references signups (id) on delete cascade
);
create index if not exists token_pool_ready on token_pool (created_at) where issued_at is null;
create index if not exists token_pool_signup on token_pool (signup_id);
create table if not exists download_counts (
  day date not null,
  platform text not null,
  target text not null,
  count int not null default 0,
  primary key (day, platform, target)
);
insert into schema_migrations (version) values (3) on conflict do nothing;
