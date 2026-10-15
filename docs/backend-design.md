# Sidekick beta backend — design

Status: design for branch `site/backend-2026-10-15`, written 2026-10-15 before any code.
Owner setup lives in `docs/OWNER-SETUP.md`. Facts marked **[V]** were read today in the source named;
**[U]** unverified; **[A]** an assumption. The research log with every source is kept privately by the owner.

## 1. Goal and the shape of it

```
visitor ── POST /api/get-sidekick ──► Turnstile Siteverify ─► rate limit ─► row written ─► 200 + "form" session
                                                                               │
                                                     confirm email queued ◄────┘
visitor opens the email ─ GET /api/confirm-email?t= (page) ─ POST /api/confirm-email ─► email confirmed
                                                                               │  approval rule (cap 25, allow/deny)
                                                     approved ─┬─ or waitlisted (email says so)
                                                               ▼
owner's Mac: tools/signer (launchd, every 5 min) ─ POST /api/admin/pending (HMAC) ─► app's own issuer signs
                                               ─ POST /api/admin/token (HMAC) ─► token stored, token email queued
                                               ─ POST /api/admin/outbox (HMAC) ─► sends queued emails via Mail.app
visitor opens the token email ─ access link page ─ POST /api/access ─► "email" session (24 h)
Download page ─ GET /api/download/mac/arm64 ─► session + approved? ─► download logged ─► 302 to a signed file URL
```

Everything runs on free tiers: Vercel Hobby (functions + static), Neon Free (Postgres), Cloudflare Turnstile Free,
a private GitHub release for the DMG, and the owner's own mailbox for email. No custom domain: the site lives on
its `*.vercel.app` address.

## 2. Limits that shape the design (read 2026-10-15)

| Service | Limit that matters | Design consequence |
|---|---|---|
| Vercel Hobby | Non-commercial personal use only; advertising the sale of a product counts as commercial [V fair-use-guidelines] | Owner decision before launch: the beta must not advertise a price. Listed in OWNER-SETUP |
| Vercel Hobby | 1,000,000 invocations, 4 h Active CPU, 360 GB-h memory a month; over the limit → wait 30 days [V plans/hobby] | One function, cheap handlers, no polling from browsers |
| Vercel Hobby | Function max 300 s; runtime logs kept 1 h [V plans/hobby] | Logs can't be the audit trail: downloads are logged in the database |
| Vercel Hobby cron | Once a day at most, ±59 min; a more frequent schedule fails the deploy [V cron-jobs/usage-and-pricing] | Retention runs daily at 03:xx UTC; nothing time-critical uses cron |
| Vercel env vars | 64 KB total per deployment [V limits] | ~15 small variables; no keys or certificates in env except short secrets |
| Neon Free | 100 CU-hours/project/month; 1 GB storage/project; scale to zero after 5 min (fixed); wakes "within a few hundred milliseconds"; over the hours → suspended until next month, data kept [V plans, scale-to-zero] | One retry with backoff on the first query; health check never touches the database |
| Turnstile | Token valid 300 s, single use, ≤ 2048 chars; Siteverify needs a timeout [V server-side-validation] | 5 s timeout, fail closed, one widget per form, reset after each submit |
| GitHub Releases | File < 2 GiB, no bandwidth limit [V about-releases]; API asset download returns 200 or 302 [V rest/releases/assets]; fine-grained token needs Contents: read [V permissions page] | DMG (≈122 MB) fits. Signed redirect lifetime is **not documented**; observed ≈ 1 h on a public asset [observation] |
| Cloudflare R2 | Free 10 GB-month, egress free; presigned URLs SigV4, 1 s–7 days, only on the S3 endpoint [V r2 pricing, presigned-urls]; enabling needs a checkout to add an R2 subscription [V get-started], very likely a card [U] | Built as the alternative storage with an exact 600 s link |
| Resend Free | 100/day, 3,000/month; without a verified domain it sends only to the account's own address [V] | Unusable until a domain exists; adapter built for later |
| Email in general | No domain → no SPF/DKIM alignment for any provider; Brevo rewrites unauthenticated senders to brevosend.com [U] | Default: queue in the database, send from the owner's mailbox on the owner's Mac |

## 3. Endpoints

All under one function `api/index.mjs` (Web-standard `fetch`), with `vercel.json` rewriting `/api/(.*)` to it.
Every API response carries `Cache-Control: no-store` and the security headers in §8.

| Method · path | Auth | Turnstile | Purpose |
|---|---|---|---|
| `POST /api/get-sidekick` | none | **yes** | Signup (JSON or plain form post) |
| `GET  /api/confirm-email` (token in `#t=`) | — | no (read-only page) | Shows a page with a Confirm button |
| `POST /api/confirm-email` | link token | **yes** | Confirms the email (and marketing, for that link's purpose), applies the approval rule, sets an "email" session |
| `GET  /api/access` (token in `#t=`) | — | no (read-only page) | Shows a page with an Open my downloads button |
| `POST /api/access` | link token | **yes** | Sets an "email" session from the emailed access link |
| `GET  /api/session` | cookie | — | `{firstName, stage}` for the Download page; 401 without a session |
| `GET  /api/download/:platform(/:arch)` | "email" session + approved | — | Logs, then 302 to a signed file URL |
| `GET  /api/releases` | none | — | Release facts from `data/releases.json` |
| `POST /api/roadmap-notify` | none | **yes** | `{email, featureId}` → 202; confirm email queued |
| `POST /api/feedback` | none | **yes** | `{message, email?}` → 202 |
| `POST /api/admin/*` | HMAC (§6) | — | Signer and admin CLI only |
| `GET  /api/cron/retention` | `Authorization: Bearer $CRON_SECRET` | — | Daily retention job |
| `GET  /api/health` | none | — | `{ok:true}` or `{ok:false, error:'MISCONFIGURED'}`; no data, no database call |

### 3.1 `POST /api/get-sidekick`
Body exactly as Handoff §7: `{name(1..120), email, macChip:'apple'|'unsure', phoneModel(1..120), privacyAccepted:true,
marketingOptIn:boolean, captchaToken}`. A plain form post sends the same names, with `cf-turnstile-response`.

Order: content type and size (≤ 16 KB) → Origin check → field validation (400 `fieldErrors`, the Handoff strings) →
Turnstile Siteverify (fail closed: 403 `BOT_CHECK_FAILED`) → rate limits per IP and per email (429 `retryAfter`) →
**one upsert statement** → queue the email → **then** 200.

Idempotent: the email (lower-cased) is unique. A second signup with the same email changes nothing stored, writes
no row, and gets the same 200 and the same "form" session as a first one. The person who owns the inbox gets the
right email: a fresh confirm link if still unconfirmed, or a fresh access link if already confirmed (both
rate-limited per email). The response never says which.

Responses: JSON for `fetch`; for a plain form post a server-rendered page (errors with the Handoff strings, an
error summary focused on load, `aria-invalid` and `aria-describedby` on each field) or `303 → /check-email.html`.
`x64`, `intel` or anything else as `macChip` is a field error.

### 3.2 Sessions
Cookie `sk_session` = `base64url(JSON payload) "." base64url(HMAC-SHA256(SESSION_SECRET, payload))`,
`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`. Verified with `crypto.timingSafeEqual` on equal-length
buffers. Payload `{v:1, k:'form'|'email', n?:firstName, sid?:signupId, iat, exp}`.

- **form** session: from the signup response. Carries only the first name the visitor typed; the Download page
  shows "check your email". It never authorises a download and never reveals anything stored.
- **email** session: from an emailed link (confirm or access). Carries the signup id; downloads need it.
- Rotation: set `SESSION_SECRET_PREVIOUS` to the old value and `SESSION_SECRET` to a new one; old cookies verify
  for 24 h; then remove the previous one. Removing both logs everyone out (harmless: the emailed access link
  makes a new session).

### 3.3 Email links
Random 32 bytes, base64url, sent only by email, **after `#` in the link** (`/api/confirm-email#t=…`), so it never reaches a server log or a Referer header; the page's own nonce'd script moves it into the form and clears the address bar. The database stores SHA-256 of it. Purposes:
`signup_confirm` (48 h, single use), `marketing_confirm` (7 days, single use), `roadmap_confirm` (7 days, single
use), `access` (72 h, usable up to 10 times so a second device works). GET shows a small page whose button posts
the token (mail scanners that prefetch links consume nothing; validity is checked on POST). Links are built from `APP_ORIGIN`, never from the
request's `Host` header.

### 3.4 Approval
On confirmation, in one transaction holding an advisory lock: deny list match → `denied` (the visitor is told the
same as a waitlist); allow list match → `approved`; otherwise `approved` while approved + issued + delivered < cap
(default 25, `settings.beta_cap`), else `waitlisted`. The daily job and the admin `promote` command move the oldest
waitlisted people up when there is room. Allow/deny entries are a whole address or `@domain`.

States: `pending_email → approved | waitlisted | denied`; `approved → issued` (signer posted a token) `→ delivered`
(token email sent). Downloads are allowed in `approved`, `issued` and `delivered`.

### 3.5 Download
`GET /api/download/mac/arm64` and `GET /api/download/android`. Needs an "email" session whose signup is allowed.
Mac: storage adapter → signed URL → insert `{signupId, platform, arch, ts}` → `302 Location`. The Location comes
only from the storage adapter (a host from config), never from the request: no open redirect. A browser
navigation without a valid session gets `303 → /Download.dc.html` (the page shows the expired state); `fetch`
gets 401. Android: `releases.android.storeUrl` if set and on `https://play.google.com/` → 302; otherwise 404
`NOT_AVAILABLE`. No APK is ever served, and `releases.json` may not even describe one (`releaseProblems` refuses `android.build`). `x64` → 404.

### 3.6 Releases
`data/releases.json` is the one source. `/api/releases` imports it; the pages load `data/releases.js`, a copy
generated from it by `node tools/releases.mjs` (`--check` fails when stale, like the no-JS copies). Validation on
load: `sha256` is 64 hex characters or `null`, `bytes` a positive integer or `null`, the only Mac build is `arm64`.
Never fill a hash or size by hand from memory: `node tools/releases.mjs --from-dmg <path>` computes both.

## 4. Data (Postgres; `server/schema.sql`, applied by `node scripts/migrate.mjs`)

| Table | Holds | Kept |
|---|---|---|
| `signups` | id, email, name, mac_chip, phone_model, privacy_accepted_at, marketing_requested_at, marketing_confirmed_at, state, timestamps, token (text) + token_issued_at, token_emailed_at, signer_claimed_at | Unconfirmed: 7 days. Others: until deleted, or `RETENTION_SIGNUP_DAYS` (default 365) after the last change. Token text cleared 46 days after issue (a token lasts 45) |
| `email_links` | sha256 of link token, purpose, ref id, expires_at, uses, used_at | Deleted 7 days after expiry |
| `rate_limits` | bucket (HMAC of IP or email, never clear), window start, count | Deleted after 2 days |
| `downloads` | signup id, platform, arch, created_at | 180 days |
| `outbox` | queued email: to, subject, text, claimed/sent times, attempts, error code | Address and text erased on send; rows deleted after 7 days |
| `roadmap_notify` | email, feature id, confirmed_at | Unconfirmed: 7 days; confirmed: a year after confirming |
| `feedback` | message, optional email | 365 days |
| `settings` | beta_cap, allow list, deny list | — |
| `admin_nonces` | nonce, seen_at | 1 day |

Every reference to a signup is `ON DELETE CASCADE`, so deleting a person deletes their links, downloads and queued
emails. Every write is one statement (upserts and `RETURNING`) or one non-interactive transaction, so the Neon
HTTP driver needs no session. First query after idle retries once after 400 ms (Neon wakes in a few hundred ms
[V]). The pooled `-pooler` host is not needed for the HTTP driver [A]; if the owner switches to a `pg` Pool,
use the `-pooler` connection string.

## 5. Interfaces (all in `server/`)

| Interface | Real adapter | Fake (tests, demo, local dev) |
|---|---|---|
| `Repo` (database) | `PgRepo` over `@neondatabase/serverless` | `MemoryRepo` (pure JS); `PgRepo` over PGlite in tests |
| `Email` | `OutboxEmail` (default: queue for the signer), `ResendEmail` | `MemoryEmail` |
| `Storage` | `GitHubReleaseStorage` (default), `R2Storage` (SigV4, own code) | `FakeStorage` |
| `BotCheck` | `TurnstileBotCheck` | `FakeBotCheck` (pass/fail/timeout scripted) |
| `Clock` | `systemClock` | `FakeClock` |

`createApp({repo, email, storage, botCheck, clock, config, log})` returns the `fetch` handler. `api/index.mjs`
builds the real adapters from env once per instance.

## 6. Admin API and the signer

HMAC request signing: headers `x-sk-key` (`admin` or `signer`), `x-sk-ts` (ms), `x-sk-nonce` (16 random bytes,
hex), `x-sk-sig` = hex HMAC-SHA256(secret, `METHOD \n PATH \n TS \n NONCE \n sha256hex(body)`). Rejected when the
timestamp is more than 300 s away, the nonce was seen (stored in `admin_nonces`, unique), the signature differs
(constant-time compare), or the key may not call that path. Two secrets: `ADMIN_AUTH_SIGNER_SECRET` may call only
`pending`, `token`, `outbox`, `outbox-ack`; `ADMIN_AUTH_SECRET` may call everything.

| Path | Who | Does |
|---|---|---|
| `pending` | signer | Claims up to 10 approved signups without a token (claim expires after 15 min) → `[{signupId, label}]`; label = the name, control characters removed, ≤ 60 chars |
| `token` | signer | `{signupId, token}` → checks the token's shape (`SIDEKICK-TRIAL-1.<payload>.<86 chars>`, base64url), stores it once, state `issued`, queues the token email. A second token for the same person → 409 |
| `outbox` / `outbox-ack` | signer | Claims queued emails / reports sent or failed; on success the address and text are erased |
| `stats`, `export` (CSV), `set-state`, `delete`, `unsubscribe`, `settings`, `promote`, `retention` | admin | The CLI in `tools/admin/` |

**The signer** (`tools/signer/signer.mjs`, never deployed — `/tools` is in `.vercelignore`) runs on the owner's Mac by
launchd every 5 minutes (`tools/signer/com.sidekick.signer.plist.template`) or by hand
(`node tools/signer/signer.mjs --once`). Secrets come from the login Keychain (`security find-generic-password -w`)
or the environment, never from files in the repo. It runs the **app's own issuer**
(`<ConnectSuite>/scripts/issue-trial-token.mjs --key <file> --label <name> --days 45 --out <tmp>`). The Mac
repo's docs give the token's outer shape but not its payload or signed bytes, and say that issuer produced a token
the app accepted, so re-implementing it was rejected. The private key is read by the issuer, not by the signer, and is
never sent anywhere; only the finished token is posted. Keychain mode pipes the PEM to the issuer through a file
descriptor, never through disk [U: issuer reading `/dev/fd/3` untested]. Tokens follow the app's rules: 45 days,
not bound to one Mac (by the owner's decision of 2026-10-12), one token per signup.

The signer also sends the outbox through **Mail.app** (`osascript`, arguments passed as `argv`, never spliced into
script text), so mail goes from the owner's own address with no password stored anywhere. Fallback adapter: write
`.eml` files to a folder for manual sending.

## 7. Privacy

Stored: name, email, chip choice, phone model, the time the privacy policy was accepted, marketing requested and
confirmed times (double opt-in: stored as consent only after the emailed link is used), state, the token once
issued, download times. Not stored: IP addresses (rate-limit buckets hold an HMAC of the IP, keyed from
`SESSION_SECRET`), user agents, Turnstile tokens.

Logs: one line per event with an event code and, at most, the signup id. A redaction pass removes anything shaped
like an email, a token, an IPv4/IPv6 address or a bearer secret before printing, as a second line of defence.
Tests capture every log line and fail on any test email, token, IP or secret.

Delete-my-data: in plain words on Support › Privacy (write to the support email from the signup address);
`node tools/admin/admin.mjs delete <email>` removes the sign-up and everything linked, plus roadmap requests and
feedback from that address, and the signer's local token copy (the issuer's own list is edited by hand).
`unsubscribe <email>` withdraws updates consent and removes roadmap requests; updates are stopped on request by
email, since no update-sending code exists yet (closeout 2026-10-15).

## 8. Headers

API and server-rendered pages: `Cache-Control: no-store`, `Strict-Transport-Security: max-age=63072000;
includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` for JSON, and for the confirm/access pages a
per-response nonce: `script-src 'nonce-…' 'strict-dynamic' https://challenges.cloudflare.com; frame-src
https://challenges.cloudflare.com; style-src 'nonce-…'; form-action 'self'; base-uri 'none'`.

Static pages (`vercel.json`): the same HSTS, nosniff, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera, microphone, geolocation off) and `Content-Security-Policy: default-src 'self';
script-src 'self' 'unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src
'self' data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; object-src 'none';
base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. `'unsafe-eval'` is needed because `support.js`
compiles the page templates with `new Function`; inline styles are everywhere. Removing them needs the
Astro/Next rebuild Handoff §8 already asks for.

## 9. Threats

| Threat | Defence |
|---|---|
| Bots | Turnstile on every state-changing public endpoint, verified server-side, fail closed on error/timeout/hostname mismatch |
| Signup abuse / email bombing | Per-IP and per-email limits in the database; emails per address capped (3 an hour, 6 a day); unconfirmed rows deleted after 7 days |
| Enumeration | Same status, body and cookie for new and existing emails; per-email 429 applies to every address alike; roadmap-notify and feedback always 202 |
| Session takeover by typing someone's email | A form session never authorises a download (D-B7) |
| Token theft | Token only in the email and the database; never in logs or responses other than to the signer's own post; erased from the outbox on send and from the signup 46 days after issue. Tokens can't be revoked early (app design) |
| Replay (admin) | Timestamp window 300 s + single-use nonce + body hash in the signature |
| Replay (links) | Single-use confirm links; access links capped at 10 uses and 72 h; Turnstile tokens single-use by Cloudflare |
| Log leakage | Event-code logging + redaction + a test that scans every log line; link tokens ride in the URL fragment so Vercel's own request logs never see them |
| SSRF | No endpoint takes a URL. Outbound hosts are fixed: challenges.cloudflare.com, api.github.com, the R2 endpoint built from an account id that must match `^[0-9a-f]{32}$`, api.resend.com |
| Header injection in emails | Address validated (no CR/LF, quotes, angle brackets, spaces), subjects are constants, names stripped of control characters; Mail.app gets values as `argv` |
| CSRF on the no-JS form | State-changing posts check `Origin` against `APP_ORIGIN` when the browser sends it; signup carries no ambient authority; confirm/access need the emailed secret; cookie is SameSite=Lax |
| Open redirect | Every redirect target is a constant path or comes from the storage adapter / `releases.json` (checked prefix), never from input |
| Host header poisoning | Links in emails use `APP_ORIGIN` only |
| Mock switches in production | The build replaces `mock-api.js` with a real-only client, drops the Design review bar and forces `mocksEnabled:false`; a test greps `dist/` and loads it in a browser with the old switches set |

## 10. Front end

`data/site-config.js` keeps `mocksEnabled: true` for local design review (forms closed, as today). Real mode
(`mocksEnabled: false`) is what `scripts/build-site.mjs` produces in `dist/` for Vercel, and what
`npm run dev` serves locally against fake adapters. Real mode adds the Turnstile widget to the form, the roadmap
notify forms and Suggest a feature; the Download page reads `/api/session` and shows check-email, waitlist,
approved (token on its way) or ready. Without JavaScript the Get Sidekick page shows a plain HTML form that posts
to the same endpoint.

## 11. Not in scope / owner decisions
Domain, real email provider, R2 vs GitHub, privacy-policy legal review, the Vercel commercial-use question, and the
staged DMG's size and hash. See `docs/OWNER-SETUP.md`.
