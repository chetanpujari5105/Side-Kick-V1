# Reply TOKEN OK to start part 2.

(Only after step 1 below: the packaged Mac app accepted the token made by this pipeline.)

Written 2026-10-16 at the end of launch work part 1. Each item is something only you can do: a macOS permission, a
login, or a check on your own Mac. Nothing here needs a card. Production is still `SITE_MODE=manual` and was not
changed in part 1.

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
