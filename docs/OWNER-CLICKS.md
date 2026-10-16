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

## 5. Inviting a real tester (runbook)

Run the commands from `~/Desktop/Side-Kick-V1` with the Production admin key from its file:
```sh
export SK_API_BASE=https://side-henna.vercel.app \
  SK_ADMIN_SECRET_FILE=~/Documents/Sidekick-private/secrets/production.ADMIN_AUTH_SECRET
```

1. **The tester signs up and confirms.** They fill in Get Sidekick on the site (name, email, Mac chip, phone model
   name, the Google account their Play Store uses) and press the link in "Confirm your email for the Sidekick beta".
   Until they press it, they are `pending_email` in `node tools/admin/admin.mjs export`.
2. **`play-pending` lists them.** `node tools/admin/admin.mjs play-pending` prints the Google accounts to add
   (confirmed and approved, not yet on the Play list).
3. **Add their Google email in Play Console.** Account chetanpujari.sitit@gmail.com › **Sidekick** › Test and
   release › Testing › **Internal testing** › **Testers** › the arrow next to **Sidekick beta testers** › type the
   address in **Add email addresses**, press Enter › **Save changes**. Back on Testers, check that **Sidekick beta
   testers** is ticked; if you ticked it now, press **Save** (bottom right). Use only this list: it is the one
   enabled for Sidekick's internal track together with "Sidekick - owner". The internal track allows 100 testers.
   Don't use **Upload CSV file** on a list that already has people: it replaces the list.
4. **Mark them added.** `node tools/admin/admin.mjs play-mark-added their.google@gmail.com` (that address only).
   This is what lets the signer send their invitation, so do it only after step 3 is saved.
5. **The signer sends within about 5 minutes.** Its next run makes their token with your issuer, then sends two
   emails through Mail: "Your Sidekick beta invitation" (Beta page, Drive folder, checksum, six install steps,
   Google Play test link) and "Your Sidekick beta token". Check with
   `SK_API_BASE=https://side-henna.vercel.app node tools/signer/signer.mjs --status`: `0 tokens to issue` and
   `0 emails waiting to send`, and a log line with `"mailed":2`. Your Mac must be awake and online.
6. **If the tester says "no download" or "Play says not available"**, check in this order:
   1. Confirmation done: `admin export` shows them as `approved`, `play_added` or `delivered`, not
      `pending_email`. If not, ask them to press the link in the confirmation email (or sign up again).
   2. Google email correct: the `google_email` column is the account their **phone's Play Store** uses.
   3. On the list: that address is in **Sidekick beta testers**, and the list is ticked for Internal testing.
   4. Track release live: Internal testing › **Releases** shows a release "Available to internal testers".
   5. Right account on the phone: they opened the Google Play test link on the phone while signed in to that
      Google account (Play Store › profile picture › switch account), accepted the invitation, then followed its
      link to Google Play and tapped **Install**. It can take a few minutes after you add them. While in testing, Play may show
      the app as "com.chetan.connectsuite (unreviewed)".
   6. Drive link: the folder in the invitation opens in a private window (not logged in) and lists
      `Sidekick-2.0.1-arm64.dmg`.
   7. Checksum: `shasum -a 256 ~/Downloads/Sidekick-2.0.1-arm64.dmg` prints exactly the SHA-256 in the invitation
      and on the Beta page. If not, download it again.
   No email at all: ask them to check spam; run `signer --status` (failed runs, emails waiting) and see
   `docs/OWNER-SETUP.md` §7 "Signer status".
7. **Remove a tester and delete their data.** `node tools/admin/admin.mjs delete their@email` deletes the sign-up,
   its links and emails, and the signer's local token copy; then remove their line from
   `~/.sidekick-trial-key/issued-tokens.tsv` by hand (the command reminds you). In Play Console open **Sidekick beta
   testers**, press the bin next to their Google email, **Save changes**. A token already sent keeps working until it
   expires (45 days from the day it was made): the Mac app checks it offline.

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
