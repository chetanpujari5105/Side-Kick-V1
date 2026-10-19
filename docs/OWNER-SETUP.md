# Owner setup — turning the beta backend on

Everything here is for **you** to do, in this order. Nothing has been created, deployed or pushed for you. No real
key or secret exists anywhere in this repository; the tests make throwaway ones in memory.

**The site runs without any of this today.** With `SITE_MODE=manual` (set in Vercel on 2026-10-15 for Preview and
Production) the site is email-only: no database, no Turnstile, no cookies, and the build needs no secret. Everything
below is for switching to `SITE_MODE=automated` later; `docs/MORNING.md` has the order of the switch.

Read `docs/backend-design.md` for how it works. Facts marked **[V]** were read in the provider's own docs on
2026-10-15; **[U]** were not confirmed.

---

## 0. Before anything: three decisions only you can make

1. **Vercel Hobby is for non-commercial personal use only.** Vercel counts "advertising the sale of a product or
   service" and "any method of requesting or processing payment" as commercial [V vercel.com/docs/limits/fair-use-guidelines].
   A free, invite-style beta with **no price on the site** is the safest reading, but a free beta of a product you
   plan to sell is not addressed explicitly. If in doubt, ask Vercel support, or use Pro ($20 per developer seat a
   month [V vercel.com/docs/plans/hobby]). **Never add pricing or a payment link while on Hobby.**
2. **Privacy text — needs legal review.** Support › Privacy was narrowed on 15 October 2026 to what is verified:
   the apps part now follows `ConnectSuite-overnight/docs/privacy-facts-2026-10-15.md` (ML Kit is gone since
   2114c0f, so "no analytics or crash-reporting kit" is said with "checked the code and the builds; not yet measured
   the traffic"; the Activity history's call names, file names and 2,000-entry limit; the diagnostic log; no clear
   button; how to remove everything), and the website part describes the real backend (one cookie, Cloudflare
   Turnstile, Neon, GitHub, emails sent from your Mac, where tokens go, retention). Defect 188 in `defects.md` still
   says "open — ML Kit sends usage metrics"; the facts file calls that entry stale. Close it in the Mac repo once the
   F9 traffic capture is done. `policyEffectiveDate` is a **placeholder** on purpose, so
   the page shows its DRAFT banner. After the review, set it to the launch day. Your **external** policy page
   (chetan-website-delta.vercel.app/sidekick/privacy) says "Notifications, messages, call lists, contacts and photos
   … are not written to disk", which the facts file contradicts for call names (it discloses the Activity history
   elsewhere on the same page), and it states "sends nothing" without the "not yet measured" limit: align it with
   Support › Privacy or stop linking to it before launch. Also: the Sep 29 `app-release.apk` in the Mac repo still
   carries ML Kit (facts file) — never share it.
3. **Which mailbox sends the emails.** By default the signer on your Mac sends every email through **Mail.app**,
   from whichever account Mail uses by default (or `SK_MAIL_FROM`). Recipients see that address. Pick one you're
   happy to reply from. Once a Gmail app password file exists (`docs/OWNER-CLICKS.md` §7), it sends branded HTML
   emails through Gmail SMTP as `Sidekick <chetanpujari.sitit@gmail.com>` instead, and falls back to Mail.app by itself.

## 1. Prove the token in the Mac app — before creating any account

Everything after this costs time and creates accounts, so first prove the one thing nothing here could test: that a
token made by this pipeline opens the real Mac app. No account, no network, no email:
```sh
node scripts/token-proof.mjs --label "Token proof"
```
It runs the API in memory, makes one approved sign-up and runs **one real signer cycle**: your issuer
(`~/Desktop/ConnectSuite/scripts/issue-trial-token.mjs`), your key (`~/.sidekick-trial-key/private.pem`), the same
`--label/--days 45/--out` arguments launchd will use. It prints the path of the `.sidekick-token` file (not the
token). In the Mac app choose **Open token file…** (or Settings › About) and pick it.
- **Accepted, with an end date 45 days out** → carry on with §2.
- **Refused** → stop. The signer's issuer call or the app's format is the problem; don't create accounts yet.
- Want Keychain mode for the key? Run it again with `SK_KEY_SOURCE=keychain` (the PEM stored as item
  `sidekick-trial-key`). That mode has only been tested with a stand-in issuer; this run is its real test.
- It adds one line to the issuer's `issued-tokens.tsv`, like any issue. The test sign-up lives only in memory.

## 2. What each service costs, and how to turn it off

| Service | What for | Cost | Card / phone? | At the free limit | Turn it off |
|---|---|---|---|---|---|
| **Vercel Hobby** | Pages + one API function + daily cron | $0 | No card on Hobby | Over 1,000,000 invocations / 4 h Active CPU / 100 GB transfer a month: you wait 30 days [V] | Project › Settings › Advanced › Delete Project (or Pause) |
| **Neon Free** | Postgres database | $0 | Neon says no card needed [V neon.com FAQ] | Over 100 CU-hours/month: compute suspended until next month, data kept; storage 1 GB [V plans] (one Neon FAQ says 0.5 GB — check) | Project › Settings › Delete project |
| **Cloudflare Turnstile** | Human check | $0, unlimited challenges [V turnstile/plans] | Cloudflare account; card [U — not needed for Turnstile as far as read] | No limit on Free [V] | Turnstile › your widget › Delete |
| **GitHub** (default DMG host) | Private release with the DMG | $0, no bandwidth limit, files < 2 GiB [V about-releases] | No | — | Delete the release or revoke the token |
| *Cloudflare R2* (alternative) | DMG with an exact 10-minute link | $0 within 10 GB-month, egress free [V r2/pricing] | Enabling R2 needs a checkout to add an R2 subscription [V r2/get-started]; very likely a card [U] | Billed per use above the free tier [V] | Delete the bucket, then cancel the R2 subscription |
| *Resend* (later, needs a domain) | Server-side email | $0 for 100/day, 3,000/month [V] | [U] | Sends stop at the quota [A] | Delete the API key |
| **Mail.app on your Mac** (default email) | Sends every email | $0 | — | Your mail provider's own sending limits [U] (Gmail personal accounts are commonly cited at about 500/day) | Unload the signer (§7) |

## 3. Create the accounts and keys (you, in a browser)

**a. Neon** — neon.com → sign up → **Create project** (Postgres 17; region **AWS US East (N. Virginia)**, next to
Vercel's default function region [A]). In the project, create a second **branch** called `preview` (Free allows
10 [V]). From **Connect**, copy two connection strings — one for `main` (Production), one for `preview` — the
"Pooled connection" form is fine with the HTTP driver [A]. These are **secrets**.

**b. Cloudflare Turnstile** — dash.cloudflare.com → Turnstile → **Add widget**: name *Sidekick*, widget mode
**Managed**, hostnames: your production host (`<project>.vercel.app`) and your preview branch host
(`<project>-git-<branch>-<your-vercel-username>.vercel.app`; Vercel shows the exact one after the first preview).
Copy the **Site key** (public) and the **Secret key** (secret).

**c. The DMG on GitHub (default)**
1. Create a **private** repository, e.g. `sidekick-releases`.
2. **Releases › Draft a new release**, tag **`v2.0.1`** (the API looks for `v` + the version in `data/releases.json`,
   unless you set `GITHUB_RELEASE_TAG`), and attach **`Sidekick-2.0.1-arm64.dmg`** — the name must match
   `data/releases.json` exactly. Publish.
3. **Settings › Developer settings › Fine-grained tokens › Generate**: resource owner = you; **Only select
   repositories** = `sidekick-releases`; **Repository permissions › Contents: Read-only** (that is all the API needs
   [V docs.github.com permissions page]); expiry 90 days, and put the date in your calendar. The token is a
   **secret**.
   *Known limit:* GitHub decides how long the file link it hands out lives — observed about **1 hour**, not 10
   minutes, and undocumented. The site still checks the visitor and logs the download on every click.

   *Alternative, R2:* Cloudflare › R2 › complete the subscription checkout › create bucket `sidekick-beta` › upload
   the DMG › **Manage R2 API tokens** › create a token with **Object Read** on that bucket only. You get an Access
   Key ID and a Secret Access Key (secret); your Account ID (32 hex characters) is on the R2 overview page. Links
   then last exactly `DOWNLOAD_URL_TTL` seconds (default 600).

**d. Secrets you make yourself** (on your Mac, one per line, each run gives a new value — don't reuse between
Production and Preview):
```sh
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # ADMIN_AUTH_SECRET
openssl rand -hex 32   # ADMIN_AUTH_SIGNER_SECRET
openssl rand -hex 24   # CRON_SECRET
```
Paste each straight into Vercel (next step) and into Keychain (§6); don't save them in a file or a chat.

## 4. Vercel environment variables

Project › Settings › Environment Variables. Mark every **secret** one as **Sensitive**. Set Production and Preview
**separately** (different database branch, different secrets, different `APP_ORIGIN`).

| Name | Secret? | Production | Preview | From |
|---|---|---|---|---|
| `SITE_MODE` | no | `automated` (today: `manual`) | `automated` (today: `manual`) | Set it **last**, after every variable below exists, so a half-set project never builds the automated site. `manual` needs nothing else |
| `APP_ORIGIN` | no | `https://<project>.vercel.app` | your preview **branch** host, `https://…-git-<branch>-….vercel.app` | Vercel › Domains / the deployment page. Links in emails are built from this, never from the request |
| `SESSION_SECRET` | **yes** | new value | different value | §3d. ≥ 32 characters |
| `SESSION_SECRET_PREVIOUS` | **yes** | only while rotating | — | the old `SESSION_SECRET`, for 24 h after a change |
| `DATABASE_URL` | **yes** | Neon `main` | Neon `preview` | §3a |
| `TURNSTILE_SITE_KEY` | no (public) | site key | same | §3b. Also read by the **build** in automated mode — it must be set or the build stops. Manual mode doesn't use it |
| `TURNSTILE_SECRET` | **yes** | secret key | same | §3b |
| `STORAGE_PROVIDER` | no | `github` (default) or `r2` | same | your choice |
| `GITHUB_RELEASES_TOKEN` | **yes** | fine-grained token | same | §3c |
| `GITHUB_RELEASES_REPO` | no | `<you>/sidekick-releases` | same | §3c |
| `GITHUB_RELEASE_TAG` | no | optional (default `v2.0.1`) | | |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_BUCKET` | no / **yes** / no | only with `r2` | | §3c alternative |
| `R2_SECRET_ACCESS_KEY` | **yes** | only with `r2` | | |
| `DOWNLOAD_URL_TTL` | no | `600` (R2 only; 60–3600) | | |
| `EMAIL_PROVIDER` | no | `outbox` (default: your Mac sends) | same | `resend` only once you have a verified domain |
| `EMAIL_PROVIDER_KEY`, `EMAIL_FROM` | **yes** / no | only with `resend` | | Resend dashboard |
| `ADMIN_AUTH_SECRET` | **yes** | §3d | different | for `tools/admin` |
| `ADMIN_AUTH_SIGNER_SECRET` | **yes** | §3d | different | for `tools/signer` |
| `CRON_SECRET` | **yes** | §3d | different | Vercel sends it to the cron job automatically [V cron-jobs/manage-cron-jobs] |
| `BETA_CAP` | no | `25` (default) | `25` | starting cap; `admin settings --cap` overrides it |
| `RETENTION_SIGNUP_DAYS` | no | `365` (default) | | |
| `RATE_LIMIT_SIGNUP_IP` etc. | no | optional, `N/seconds` | | defaults in `server/config.mjs` |
| `STORAGE_PROVIDER=static` | no | `static` (2026-10-16) | `static` | The download is the Beta page: no GitHub or R2 needed. `BETA_PAGE_URL` is optional (default `APP_ORIGIN/Beta.dc.html`) |
| `PLAY_GATE` | no | `on` (default) | `on` | No token and no invitation until `admin play-mark-added`. `off` brings back the old flow. (Mac-only sign-ups of the email flow have no Google account to add and are not held back.) |
| `SIGNUP_DAILY_CAP` | no | `60` (default) | | One-click flow (2026-10-18): tokens handed out on the result page per UTC day. `0` turns instant tokens off (everyone takes the email flow) |
| `ANDROID_ACCESS` | no | `manual-batch` (default) | | How a Google account reaches the Play test list: `manual-batch` (daily `admin play-batch` paste, OWNER-CLICKS §5) or `google-group` (the signer adds it to a Google Group; docs/ANDROID-GROUP-SETUP.md; NOT tested against real Google) |
| `RATE_LIMIT_INSTANT_IP`, `RATE_LIMIT_DOWNLOAD_IP` | no | optional, `N/seconds` | | defaults `3/3600` (instant tokens per IP; over it, that sign-up takes the email flow) and `30/3600` (`GET /download/mac` per IP) |

`SITE_MODE=manual` is also the **kill switch** of the one-click flow: after a redeploy the build is the email-only
site and the API refuses sign-ups (503 `SIGNUP_CLOSED`; a no-JavaScript form goes back to the page). `/download/mac`
keeps working (it only points at public files).

If anything required is missing, every API call answers `503 MISCONFIGURED` and the function log names the
missing variables (names only). `GET /api/health` shows `{"ok":true}` when all is set. Total size is far under
Vercel's 64 KB limit [V].

Project settings: **Framework Preset: Other**. Build, install and output come from `vercel.json`
(`node scripts/build-site.mjs`, `npm ci --omit=dev`, `dist`). Node 22 or later.

## 5. Create the tables (once per database)

**2026-10-16:** with the Neon integration, `DATABASE_URL` is Sensitive and can't be read back. Run
`node tools/admin/admin.mjs migrate` instead: schema v1 and v2 run inside the Vercel function, and it is safe to
run twice. For a local string in a mode-600 file: `node scripts/migrate.mjs --url-file <file>`.

On your Mac, from the repo, without leaving the URL in your shell history:
```sh
read -s DATABASE_URL && export DATABASE_URL   # paste the Neon *preview* string, press Enter
node scripts/migrate.mjs                       # → "Database ready: schema version 1."
unset DATABASE_URL
```
Repeat with the **production** string. It is safe to run twice.

## 6. Your Mac: Keychain items for the signer and the admin CLI

```sh
security add-generic-password -a "$USER" -s sidekick-signer-hmac -w   # paste ADMIN_AUTH_SIGNER_SECRET (Production)
security add-generic-password -a "$USER" -s sidekick-admin-hmac  -w   # paste ADMIN_AUTH_SECRET (Production)
```
(`-w` as the last option makes `security` ask for the value instead of taking it on the command line [A].)
The token key stays where it is: `~/.sidekick-trial-key/private.pem` (ConnectSuite `docs/trial-licence-summary`).
The signer never reads it — it hands the **path** to the app's own issuer, exactly as the docs' command does.
*Keychain mode for the key* (`SK_KEY_SOURCE=keychain`, the PEM stored as item `sidekick-trial-key`) passes the key to
the issuer on a file descriptor; it is tested with a stand-in issuer only, **not** with the real one [U]. Stay on
file mode unless you test it.

## 7. The signer (sends tokens and every email)

```sh
export SK_API_BASE=https://<project>.vercel.app
node tools/signer/signer.mjs --check   # configuration only, sends nothing
node tools/signer/signer.mjs --once    # one real cycle
```
The first cycle that sends mail makes macOS ask whether **node may control Mail** — allow it (System Settings ›
Privacy & Security › Automation). Each token the signer issues is also kept at
`~/.sidekick-trial-key/tokens/<signupId>.sidekick-token` (mode 600), and the issuer adds its usual line to
`issued-tokens.tsv`.

Run it every 5 minutes with launchd:
```sh
cp tools/signer/com.sidekick.signer.plist.template ~/Library/LaunchAgents/com.sidekick.signer.plist
# edit: __NODE_PATH__ (`which node`), __REPO__ (this folder), __PROJECT__, __HOME__
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sidekick.signer.plist
tail -f ~/Library/Logs/sidekick-signer.log
```
Stop: `launchctl bootout gui/$(id -u)/com.sidekick.signer`. **Emails and tokens only go out while your Mac is awake
and logged in.** People see "up to a day" on the site.

### Signer status
```sh
SK_API_BASE=https://<project>.vercel.app node tools/signer/signer.mjs --status
```
It prints, with no secret and no address: whether the launchd job is loaded (its runs and last exit code), the last
run and the last successful run, how many runs in a row have failed, the queue on the site (emails waiting to
send, tokens to issue, people waiting for the Play list), the token pool (`N ready (low-water 40)`, with `ATTENTION`
below the low-water mark) and how many Google accounts wait for the daily Android paste.

The token pool (2026-10-18): after each run the signer discards pool tokens that could no longer give 35 days, and
when fewer than 40 (`SK_POOL_LOW`) are ready it makes up to 100 (`SK_POOL_MAX`) with your issuer and key, labelled
"Sidekick beta" (no name), and uploads only the token strings. They wait on this Mac (`~/.sidekick-trial-key/tokens/
pool`, mode 600) only until the upload succeeds. Its log line is `signer pool: {…}`, plus an `ATTENTION` line while
the pool is below the low-water mark; a pool failure never fails the run. `SK_POOL=off` stops it. It reads `~/Library/Logs/sidekick-signer.log`
(`SK_LOG_FILE` to change) and asks the site for counts with the signer key.

Reading the log: one line per run — `signer: {…}` with counts when it worked, or `signer failed: fetch failed
(ETIMEDOUT) host=<host> 20004 ms, 2 attempts (run 41012 ms)` when it could not reach the site. The code says why:
`ENOTFOUND` (no DNS — offline or Wi-Fi down), `ETIMEDOUT`/`TIMEOUT` (no answer within 20 s), `ECONNRESET`/
`ECONNREFUSED` (connection dropped). Each request is retried once after 2 s, inside the same run. After 6 failed runs
in a row (30 minutes) the log gets one `ATTENTION` line; nothing else happens (no email, no notification). Failed
emails are retried by later runs (up to 5 tries).

Stop and restart the job:
```sh
launchctl bootout gui/$(id -u)/com.sidekick.signer                                          # stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sidekick.signer.plist           # start again (runs at once)
launchctl print gui/$(id -u)/com.sidekick.signer | grep -E "state|runs|last exit"           # is it loaded?
```

**While testers are being invited, keep this Mac awake and online** (advice only; nothing here changes a setting):
plug it in; in System Settings › Battery (or Energy) turn on "Prevent automatic sleeping when the display is off";
or run `caffeinate -i` in a Terminal window and leave it open. Check `--status` after inviting someone: `consecutive
failed runs: 0` and `0 emails waiting to send` mean the invitation and token went out.

## 8. Test on a preview first

1. Push the branch yourself (`git push -u origin site/closeout-2026-10-15` after removing the local push guard:
   `git config --unset remote.origin.pushurl`). Vercel builds a **preview**. (Pushing also publishes the earlier
   unpushed site commits this branch is built on.)
2. `https://<preview host>/api/health` → `{"ok":true}`; `/api/releases` → the release facts with `null` size/hash.
   The first time, also confirm `/api/session` answers 401 JSON (proves the `/api/*` rewrite reaches the function [U]).
3. Previews can be behind **Vercel Authentication** (available on Hobby [V]; on by default for previews [U]); open the preview in the browser where
   you're logged in to Vercel. The signer can't reach a protected preview — run it against the preview only if you
   switch protection off for previews temporarily, otherwise test the signer on production before announcing [U].
4. Sign up with your own address, run the signer (`SK_API_BASE=<preview>` and the **preview** secrets via
   `SK_SIGNER_SECRET=…`), click the confirm link, check the Download page, run the signer again, open the token email,
   paste the token into the Mac app (already proven in §1; this checks the email copy), download the DMG and compare
   its SHA-256. The full click-by-click script, with what to look for in the Vercel logs, is **docs/GO-LIVE-TEST.md**.
5. `node tools/admin/admin.mjs stats`, then `delete <your email>` to clean up (GO-LIVE-TEST step 10).

## 9. Go-live checklist

- [ ] The staged DMG exists. Put its real size and hash in with **one command**, then commit both files:
      `node scripts/data-sync.mjs --from-dmg /path/to/Sidekick-2.0.1-arm64.dmg` (refuses a file with another name).
      Never type a hash by hand. (The DMG in `~/Desktop/Sidekick-Beta-Share-2026-10-12/` matched the old values;
      re-run the command on whichever file you actually upload.)
- [ ] Same DMG uploaded to the GitHub release (or R2) under exactly that name.
- [ ] §1 token proof accepted by the Mac app.
- [ ] Privacy text legally reviewed; then `policyEffectiveDate` set to launch day (it is a placeholder; the DRAFT
      banner disappears when it and the publisher fields are real). External policy page fixed or unlinked.
- [ ] Android: `android.storeUrl` in `data/releases.json` set to the Google Play URL once one exists (until then
      the site says "not available yet"; it never offers an APK), then `node scripts/data-sync.mjs`.
- [ ] docs/GO-LIVE-TEST.md passed on the preview.
- [ ] Production env vars set (§4), migration run (§5), `/api/health` OK.
- [ ] Turnstile hostnames include the production host.
- [ ] Signer running under launchd; `--check` clean; Mail automation allowed.
- [ ] Full flow done once on production with your own address; test row deleted.
- [ ] Cap set (`node tools/admin/admin.mjs settings --cap 25`), allow/deny lists if you want them.
- [ ] Nothing on the site mentions a price (Hobby rule).
- [ ] `og:image` made absolute once you have a domain (Handoff §5).

## 10. Everyday commands

```sh
node tools/admin/admin.mjs stats
node tools/admin/admin.mjs export --out ~/Desktop/signups.csv        # written mode 600
node tools/admin/admin.mjs set-state someone@example.com approved
node tools/admin/admin.mjs delete someone@example.com                # "delete my data": sign-up, roadmap requests,
                                                                     # feedback and the signer's local token copy
node tools/admin/admin.mjs unsubscribe someone@example.com           # stops updates and roadmap emails
node tools/admin/admin.mjs settings --cap 40 --allow @friends.example --deny spam@example.com
node tools/admin/admin.mjs promote                                   # move waitlisted people up to the cap
```
(`delete`, `unsubscribe` and `set-state` take an email address or a signup id.) After a `delete`, also remove that
person's line from `~/.sidekick-trial-key/issued-tokens.tsv` by hand (the command reminds you); the privacy page
says your Mac keeps that list. If the person gave a Google account, the command prints it as `playReminder`: remove it
in Play Console › Testers by hand (the database no longer holds it). The signer keeps that list and its own log at
mode 600 after every run.

## 11. Undoing each decision

| Decision | To reverse |
|---|---|
| DMG on GitHub | `STORAGE_PROVIDER=r2` + R2 variables; redeploy. **Also change Support › Privacy**, which names GitHub |
| Email from your Mac | Get a domain, verify it in Resend, set `EMAIL_PROVIDER=resend`, `EMAIL_PROVIDER_KEY`, `EMAIL_FROM`; the server then sends at once and the signer only signs (`SK_MAILER=none`). **Also change Support › Privacy**, which says emails are sent from your Mac |
| Signer runs the app's issuer | After checking the token format in `desktop/src/shared/trial.ts`, a built-in signer could replace it; until then keep the issuer |
| Auto-approval with a cap of 25 | `admin settings --cap 0` stops all automatic approvals (everyone waits); approve by hand with `set-state` |
| Daily retention cron | Remove `crons` from `vercel.json`; run `node tools/admin/admin.mjs retention` by hand instead |
| No-JS signup fails closed | Deliberate (Turnstile needs JavaScript). The page says so and keeps the answers |
| Android "not available yet" | Set `android.storeUrl` (a play.google.com URL) in `data/releases.json`, run `node scripts/data-sync.mjs` |
| Effective-date placeholder | Put the real date in `data/site-config.js` after the legal review |
| Roadmap items removed (presets, notification actions, folder chooser) | Re-add their lines to `data/roadmap-data.js` from git history (fe0ed73), then `node tools/noscript.mjs` and `node scripts/data-sync.mjs` |
| The whole backend | Delete the Vercel env vars → every endpoint answers 503 and the forms show their error; or redeploy `site/beta-2026-10-15` (no backend) |
