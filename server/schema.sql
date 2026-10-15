-- Sidekick beta backend schema, version 1. Applied by `node scripts/migrate.mjs` (idempotent).
create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now());

create table if not exists signups (
  id uuid primary key,
  email text not null,
  email_norm text not null unique,
  name text not null,
  mac_chip text not null check (mac_chip in ('apple', 'unsure')),
  phone_model text not null,
  privacy_accepted_at timestamptz not null,
  marketing_requested_at timestamptz,
  marketing_confirmed_at timestamptz,
  state text not null default 'pending_email' check (state in ('pending_email', 'approved', 'waitlisted', 'denied', 'issued', 'delivered')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  confirmed_at timestamptz,
  approved_at timestamptz,
  token text,
  token_issued_at timestamptz,
  token_emailed_at timestamptz,
  signer_claimed_at timestamptz
);
create index if not exists signups_state on signups (state, approved_at);

create table if not exists email_links (
  hash text primary key,
  purpose text not null check (purpose in ('signup_confirm', 'marketing_confirm', 'roadmap_confirm', 'access')),
  ref_id uuid not null,
  expires_at timestamptz not null,
  max_uses int not null,
  uses int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null
);
create index if not exists email_links_ref on email_links (ref_id);

create table if not exists rate_limits (
  bucket text primary key,
  window_start bigint not null,
  count int not null
);

create table if not exists downloads (
  id bigserial primary key,
  signup_id uuid not null references signups (id) on delete cascade,
  platform text not null,
  arch text,
  created_at timestamptz not null
);

create table if not exists outbox (
  id uuid primary key,
  signup_id uuid references signups (id) on delete cascade,
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);

create table if not exists roadmap_notify (
  id uuid primary key,
  email_norm text not null,
  feature_id text not null,
  confirmed_at timestamptz,
  created_at timestamptz not null,
  unique (email_norm, feature_id)
);

create table if not exists feedback (
  id uuid primary key,
  message text not null,
  email text,
  created_at timestamptz not null
);

create table if not exists settings (key text primary key, value text not null);
create table if not exists access_rules (pattern text not null, kind text not null check (kind in ('allow', 'deny')), primary key (pattern, kind));
create table if not exists admin_nonces (nonce text primary key, seen_at timestamptz not null);

insert into schema_migrations (version) values (1) on conflict do nothing;
