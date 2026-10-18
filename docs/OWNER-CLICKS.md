# Owner clicks and runbook

**Status 2026-10-17.** Production (`side-henna.vercel.app`) is `SITE_MODE=automated`. Sections 2 (Mail) and 3
(Cloudflare Turnstile) below are done. Section 1 (token proof) is still open: until the packaged Mac app accepts a
token, don't invite real testers. Sections 5 and 6 are the runbook for real testers and the pre-launch checklist.
Sections 1–4 are kept as written on 2026-10-16 (end of launch part 1).

---

## 1. Token proof in the packaged Mac app (needed for TOKEN OK)

The pipeline made a real token with your real issuer and your key file (file mode, so Keychain wasn't asked):

- File: `~/.sidekick-trial-key/tokens/11d39e46-994e-45f2-988d-0e4eb5ae57e2.sidekick-token` (mode 600)
- Label "Token proof 2026-10-16", valid 2026-10-16 → **2026-11-30** (45 days), per your `issued-tokens.tsv`.

To try it on the fresh macOS user:

1. In **your** account, in Terminal:
   ```sh
   cp ~/.sidekick-trial-key/tokens/11d39e46-994e-45f2-988d-0e4eb5ae57e2.sidekick-token /Users/Shared/token-proof.sidekick-token
   chmod 644 /Users/Shared/token-proof.sidekick-token
   ```
   (`/Users/Shared` can be read by every user on this Mac. Step 5 removes the copy.)
2. Apple menu › **Log Out**, then log in as the fresh user.
3. Open the packaged **Sidekick** app. On **Enter your beta token**, press **Open token file…**, go to
   **Macintosh HD › Users › Shared**, choose `token-proof.sidekick-token`, press **Open**.
4. Expected: accepted, and **Settings › About › Beta access** shows an end date of **30 November 2026**.
   If it is refused, write down the exact message and don't reply TOKEN OK.
5. Log back in to your account and run `rm /Users/Shared/token-proof.sidekick-token`.
6. Reply **TOKEN OK** (or the refusal text).

## 2. Let the signer use Mail (stopped here in part 1)

The first email (to your own address) failed after 60 seconds. The most likely reason is the macOS question
"… wants access to control Mail", which I'm not allowed to answer.

1. If a dialog like that is on screen, click **Allow** (or **OK**).
2. If not: **System Settings › Privacy & Security › Automation**. Under the app that ran the command (Terminal,
   or the app you run Claude Code in), turn **Mail** on. When the signer later runs from launchd, macOS asks
   again for **node**; allow that too.
3. Open **Mail** once and check that it sends from **chetanpujari.sitit@gmail.com** (Mail › Settings › Accounts).
4. Check with one email to yourself (it goes to your own address only, through the Preview):
   ```sh
   cd ~/Desktop/Side-Kick-V1
   S=~/Documents/Sidekick-private/secrets
   export SK_API_BASE=https://side-git-site-automated-2026-10-15-chetanpujari5105s-projects.vercel.app \
     SK_ADMIN_SECRET_FILE=$S/preview.ADMIN_AUTH_SECRET SK_VERCEL_BYPASS_FILE=$S/preview.VERCEL_BYPASS
   node tools/admin/admin.mjs stats
   ```
   **Before you run the signer**, delete the one sign-up on the Preview that isn't yours. It appeared on
   16 October at 12:25 IST while I was paused, and I didn't send it anything:
   `node tools/admin/admin.mjs export` shows it, then `node tools/admin/admin.mjs delete <that address>`.
   Then sign up on the Preview with your own address and run the signer once with the stand-in issuer (see
   `docs/GO-LIVE-TEST.md`, "2026-10-16 additions").

## 3. Cloudflare Turnstile (the browser wasn't logged in to Cloudflare)

The Preview uses Cloudflare's **test** keys, which always pass. Production refuses them (the build and the API
both check).

1. Go to **dash.cloudflare.com** and log in or sign up. Use your own email, password and verification; I can't
   do that part.
2. Left menu › **Turnstile** › **Add widget**.
3. Widget name: `Sidekick`. **Hostnames › Add**: `side-henna.vercel.app` and
   `side-git-site-automated-2026-10-15-chetanpujari5105s-projects.vercel.app`.
4. Widget mode: **Managed**. Pre-clearance: **No**. Press **Create**.
5. Copy the **Site key** (public) and the **Secret key** (secret) straight into two files. Don't paste them into
   a chat:
   ```sh
   cd ~/Documents/Sidekick-private/secrets
   umask 077
   pbpaste > production.TURNSTILE_SITE_KEY    # after copying the Site key
   pbpaste > production.TURNSTILE_SECRET      # after copying the Secret key
   chmod 600 production.TURNSTILE_*
   ```
   Part 2 reads them from there.

## 4. Things to decide or check (no clicks needed today)

- **Google Play test list.** In the test I marked your Google account as "added" without touching Play Console.
  For real testers: `admin play-pending` prints the addresses. Paste them into **Play Console › Testing ›
  Internal testing › Testers › your list › Add email addresses**, then run `admin play-mark-added`. **Upload CSV
  file replaces the whole list**, so use it only if the list holds nobody else. An internal test holds up to
  100 testers.
- **Drive folder sharing.** The Beta page and every invitation link to it, and the repo is public. Anyone with
  the link can download the DMG; only the token decides who can use the app.
- **Legal review** of Support › Privacy (both modes) before going live; the DRAFT banner stays until then.
- **Vercel bypass token.** Testing the protected Preview from your Mac needed "Protection Bypass for
  Automation" (created by `vercel curl`). To remove it later: Vercel › side › Settings › Deployment Protection ›
  Protection Bypass for Automation › delete it.

## 5. Testers: the one-click flow and the 60-second Android routine

Since launch log Part 7 (2026-10-18) a visitor fills in Get Sidekick (name, email, the privacy tick; Android is an
optional box) and lands on **"You're in"**: the Mac download, their beta token with a Copy button and three install
steps. Nothing waits for you on the Mac side, as long as the signer keeps the token pool filled (it does on every
run; `signer --status` shows `token pool …: N ready` and an ATTENTION line below 40). When the pool is empty, the
daily cap (SIGNUP_DAILY_CAP, default 60) is reached or the beta is full, the page says so and the old email flow
takes over (confirm email → the signer makes that person a token → invitation + token emails).

Android still needs you, because Play Console's email lists can only be edited in Play Console. Run the commands
from `~/Desktop/Side-Kick-V1` with the Production admin key from its file:
```sh
export SK_API_BASE=https://side-henna.vercel.app \
  SK_ADMIN_SECRET_FILE=~/Documents/Sidekick-private/secrets/production.ADMIN_AUTH_SECRET
```

### The daily routine (about 60 seconds; skip it on days `signer --status` says `Android: 0 Google accounts waiting`)

1. `node tools/admin/admin.mjs play-batch` — prints how many Google accounts wait and ONE comma-separated line. It
   keeps that exact batch on this Mac (mode 600).
2. Play Console (chetanpujari.sitit@gmail.com) › **Sidekick** › Test and release › Testing › **Internal testing** ›
   **Testers** › the arrow next to **Sidekick beta testers** › paste the line into **Add email addresses**, press
   Enter › **Save changes**. (Don't use Upload CSV on this list: it replaces it.)
3. `node tools/admin/admin.mjs play-mark-added --all-pending` prints the count; once step 2 is saved, run it again
   with `--yes`. Only that batch is marked; anyone who signed up after step 1 waits for tomorrow's batch.
4. Done. The signer's next run (within ~5 minutes, Mac awake and online) emails each of them "Sidekick for Android:
   your Google Play link".

The internal track allows 100 testers in all. If that becomes too few, see `docs/ANDROID-GROUP-SETUP.md` (a Google
Group on a closed track; needs a domain and has NOT been tested against real Google).

### When a tester writes "no download" or "Play says not available"

1. **Mac download:** `https://side-henna.vercel.app/download/mac` must answer with the file (GitHub Release) or, until
   that is published, the Drive folder. A private window shows which. Checksum:
   `shasum -a 256 ~/Downloads/Sidekick-2.0.1-arm64.dmg` must print the SHA-256 shown under "More details".
2. **Token lost:** they can sign up again with the same email: the page never shows the token again (anyone could
   type their address), but the copy email goes to that address with the token.
3. **Android:** `admin export` shows their `google_email` (the account their **phone's Play Store** uses) and
   `play_added_at`; that address is in **Sidekick beta testers**, ticked for Internal testing; a release is
   "Available to internal testers"; they opened the Play link on the phone signed in to that account. It can take a
   few minutes after you add them; Play may show "com.chetan.connectsuite (unreviewed)".
4. **No email at all:** spam folder; then `signer --status` (failed runs, emails waiting) and `docs/OWNER-SETUP.md`
   §7 "Signer status".

### Remove a tester and delete their data

`node tools/admin/admin.mjs delete their@email` deletes the sign-up, its links and queued emails, the record of the
token they were given (pool tokens), and the signer's local token copy (email-flow tokens; then remove their line from
`~/.sidekick-trial-key/issued-tokens.tsv` by hand, the command reminds you — pool tokens are listed there under the
label "Sidekick beta", with no name). In Play Console open **Sidekick beta testers**, press the bin next to their
Google email, **Save changes**. A token already given keeps working until it expires (45 days from the day it was
made): the Mac app checks it offline.

## 6. Pre-launch checklist

- [ ] **Token test:** the packaged Mac app accepted a token from this pipeline (section 1 or the token emailed to
      cpujari12@gmail.com) — then TOKEN OK.
- [ ] **Invitation check:** your own test invitation arrived and has the Beta page link, the Drive folder link, the
      checksum, the six install steps and the Google Play test link.
- [ ] **DNS:** `signer --status` shows `consecutive failed runs: 0`, and the signer log has no new `ENOTFOUND`. If it
      does: System Settings › Network › Wi-Fi › Details… › DNS › add `1.1.1.1` and `1.0.0.1` › OK (remove them the
      same way with "−").
- [ ] **Mac awake and online** while inviting: on power, "Prevent automatic sleeping when the display is off", or
      `caffeinate -i` in a Terminal window.
- [ ] **Play:** only "Sidekick - owner" and "Sidekick beta testers" are ticked for Internal testing.
- [ ] **Legal review** of Support › Privacy and of the updates emails (the DRAFT banner stays until then).

## 7. Publish the Mac app as a GitHub Release (the direct download)

**Done 2026-10-18** (launch log Part 8): release tag `sidekick-mac-2.0.1` (pre-release, on main), asset verified
anonymously (121668061 bytes, SHA-256 `a03b3390…f71284`) and set as `mac.directUrl`. The site accepts the tag
`v<version>` or `sidekick-mac-<version>` of the version in data/releases.json. For a later version, repeat the steps
below with the new file and `--verify-direct-url <the asset URL>`.

`/download/mac` sends visitors to the Drive folder until the DMG is on a GitHub Release of this (public) repo. That
upload needs a file picker, so it is yours:

1. github.com/chetanpujari5105/Side-Kick-V1 › **Releases** › **Draft a new release**.
2. **Choose a tag** › type `v2.0.1` › **Create new tag: v2.0.1 on publish**; **Target**: `main`. Title: `Sidekick 2.0.1`.
3. Drag `Sidekick-2.0.1-arm64.dmg` (the Drive-synced copy or your local file, 121668061 bytes) onto **Attach binaries**
   and wait until the upload finishes. The asset name must be exactly `Sidekick-2.0.1-arm64.dmg` (rename the file
   before dragging if it has ` (1)` or similar).
4. **Publish release**.
5. Then, in this repo on a branch: `node scripts/data-sync.mjs --verify-direct-url` downloads it anonymously into a
   scratch folder, checks 121668061 bytes and SHA-256 `a03b3390…f71284` against data/releases.json, deletes the copy,
   and only then writes `mac.directUrl`. Open a PR, merge. From then on the download starts by itself on "You're in"
   (in a hidden frame, so the page with the token never navigates; "Download again" stays; without JavaScript it is a
   normal link), `/download/mac` answers 302 to the asset, and Drive is named only "If the download fails".
   To go back to Drive: set `mac.directUrl` to `null` (PR, merge).

## 8. Switching the one-click flow off

- Everything (signups closed, the email-only site): Vercel › Settings › Environment Variables › Production
  `SITE_MODE` = `manual`, then redeploy. The API refuses sign-ups at once after the redeploy (503 / back to the page).
- Only instant tokens (keep signups, everyone takes the email flow): `SIGNUP_DAILY_CAP` = `0`, redeploy.
- Only the pool on your Mac: `SK_POOL=off` in the signer's launchd plist, then `launchctl bootout` / `bootstrap`
  (OWNER-SETUP §7).

