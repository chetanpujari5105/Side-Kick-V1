# Go-live test — click by click, on the Vercel preview

Run this on the **preview** deployment after `docs/OWNER-SETUP.md` §1–§8 (token proven in the Mac app, accounts,
env vars, migration, signer configured). You are the visitor, with your own email address. It takes about 30
minutes plus however long your Mac takes to send mail. Write the result of each step in the box.

You need: the preview URL (call it `P`, e.g. `https://sidekick-git-site-closeout-….vercel.app`), a terminal in this
repo, the **preview** signer and admin secrets, Mail on this Mac, and the Vercel dashboard open on the project's
**Logs** tab for the preview.

```sh
export SK_API_BASE=P                      # the preview URL, https, no trailing slash
read -s SK_SIGNER_SECRET && export SK_SIGNER_SECRET   # paste the PREVIEW ADMIN_AUTH_SIGNER_SECRET
read -s SK_ADMIN_SECRET  && export SK_ADMIN_SECRET    # paste the PREVIEW ADMIN_AUTH_SECRET
```
(Environment variables override the Keychain items, which hold the production secrets.)

**Logs rule for every step:** each line our function writes is JSON like
`{"level":"info","event":"signup.ok","created":true}`. It may carry an event name, a sign-up id (a UUID), a
purpose, a count or a status — **never** an email address, a name, a token, a link token or an IP address. If you
ever see one of those in a log line our function wrote, stop and note the step. (Vercel's own request rows show
the path, status and timing; tokens in our links sit after `#`, which browsers never send, so they can't appear
there either.)

---

## 0. The deployment itself

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 0.1 | Open `P/api/health` | `{"ok":true}` (not 503 `MISCONFIGURED`, not a Vercel 404) | none. If 503: a line `config.invalid` naming the missing **variable names** only | ☐ |
| 0.2 | Open `P/api/releases` | JSON with `"version":"2.0.1"`, `arm64` only, `"bytes":null,"sha256":null` (until §9 data-sync), `"storeUrl":null`, no `.apk` | — | ☐ |
| 0.3 | Open `P/api/session` | `401` JSON `NO_SESSION`. This proves the `/api/*` rewrite reaches the function | — | ☐ |
| 0.4 | `curl -sI P/ \| grep -i -E "content-security\|strict-transport"` and `curl -sI P/Support.dc.html` | Both show the CSP (with `challenges.cloudflare.com`) and HSTS. Proves the `headers` rule (negative lookahead) applies to pages | — | ☐ |
| 0.5 | `curl -sI P/api/health` | `cache-control: no-store`, HSTS, its own strict CSP | — | ☐ |
| 0.6 | Open `P/` | The Home page (the `/` rewrite). Footer: "This site runs no analytics." | — | ☐ |
| 0.7 | Open `P/Support.dc.html#privacy` | "Beta privacy notice. Published by Chetan Pujari, India. Last updated 19 October 2026. Questions: …" and no DRAFT banner (launch log Part 16; the legal review is still open) | — | ☐ |
| 0.8 | `node tools/signer/signer.mjs --check` | "Signer configuration looks complete (nothing was sent)." If the preview is behind Vercel Authentication, the next steps' signer calls will fail with 401/403 from Vercel: switch preview protection off for this test, or run this whole script on production instead | — | ☐ |

## 1. Sign up

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 1.1 | `P/Get%20Sidekick.dc.html`. Press **Continue to download** with the form empty | Error summary at the top with the Handoff messages ("Enter your name.", "Enter your email address." …); focus moves to it | none (nothing sent) | ☐ |
| 1.2 | Fill in your real name and email, chip **Apple silicon**, your phone model, tick the Privacy Policy **and "Email me Sidekick updates"**, complete the human check, send | You land on the Download page: "Check your email." with your first name | `botcheck` nothing (passes), `signup.ok` `created:true`, `mail.queued` `kind:"confirm"` | ☐ |
| 1.3 | In the browser's dev tools › Application › Cookies | One cookie, `sk_session`, **HttpOnly**, **Secure**, SameSite **Lax**, about 24 h | — | ☐ |

## 2. Confirm the email

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 2.1 | `node tools/signer/signer.mjs --once` | Prints `"mailed":1` (the confirm email). macOS may ask whether node may control Mail: allow | `admin.call` `pending`, `outbox`, `outbox-ack` | ☐ |
| 2.2 | Open the email "Confirm your email for the Sidekick beta" | From your chosen mailbox. Two links: confirm (`P/api/confirm-email#t=…`) and updates (`P/api/confirm-email?for=updates#t=…`). The token part is after `#` | — | ☐ |
| 2.3 | Click the **updates** link | A page "Confirm Sidekick updates" with a human check and a button. The address bar loses the `#t=…` part. Nothing changed yet (it's a GET) | Vercel request row `GET /api/confirm-email?for=updates` — no token in it | ☐ |
| 2.4 | Press **Yes, email me updates** | "Updates confirmed. … To stop them, write to us at the address on our Privacy page." | `link.used` `purpose:"marketing_confirm"` | ☐ |
| 2.5 | Click the **confirm** link, press **Confirm my email** | Download page: "You're in, <name>." Mac card, Apple silicon only; checksum box says "The checksum appears here once the beta build is staged." (until §9 data-sync); Android card "Not available yet." | `link.used` `signup_confirm`, `signup.confirmed` with `state:"approved"` | ☐ |
| 2.6 | If 2.3 showed the generic "Confirm your email" wording instead of the updates wording | The `?for=` query did not survive Vercel's rewrite. Harmless (the button still does the right thing, the link's purpose is stored server-side), but note it | — | ☐ |

## 3. Approval, signer, token email

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 3.1 | `node tools/admin/admin.mjs stats` | `approved: 1` (you're under the cap of 25) | `admin.call` `stats` | ☐ |
| 3.2 | `node tools/signer/signer.mjs --once` | `"issued":1,"posted":1,"mailed":1`. A file `~/.sidekick-trial-key/tokens/<id>.sidekick-token` appears, mode 600; the issuer adds a line to `issued-tokens.tsv` | `token.stored` (sign-up id only), `mail.queued` `kind:"token"` | ☐ |
| 3.3 | Open "Your Sidekick beta token" | The token (starts `SIDEKICK-TRIAL-1.`), "works for 45 days", and a download-page link `P/api/access#t=…` | — | ☐ |
| 3.4 | Copy the token from the email; in the Mac app press **Paste token** (or copy the whole email — the app finds the token) | Accepted; Settings › About › Beta access shows an end date 45 days out | — | ☐ |

## 4. Download

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 4.1 | Click the access link in the token email, press **Open my download page** | Download page, "We emailed it to you" for the token | `link.used` `access` | ☐ |
| 4.2 | Press **Download for Apple silicon (.dmg)** | The DMG downloads. The page source (View Source) never contains a github.com or storage URL — only the button | `download.ok` `platform:"mac"` | ☐ |
| 4.3 | `shasum -a 256 ~/Downloads/Sidekick-2.0.1-arm64.dmg` | Equals the SHA-256 shown on the page (once §9 data-sync has run); equals the file you uploaded | — | ☐ |
| 4.4 | `node tools/admin/admin.mjs export --out ~/Desktop/test.csv` | Your row: state `delivered`, `downloads` 1, no token column. Delete the CSV afterwards | `admin.call` `export` | ☐ |

## 5. Wrong link

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 5.1 | Click the **confirm** link from step 2 again and press the button | "This link has expired." (confirm links work once) — HTTP 410 | `link.used` does **not** appear | ☐ |
| 5.2 | Take the access link, change one character after `#t=`, open it, press the button | "This link has expired." | — | ☐ |
| 5.3 | Open the access link with everything after `#` deleted | The page says it needs the whole link from the email | — | ☐ |
| 5.4 | Open `P/api/download/mac/x64` in the same browser | 404 (there is no Intel build) | — | ☐ |

## 6. Rate limit

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 6.1 | In a private window, send the Get Sidekick form with **the same email** 6 times within an hour (a new human check each time) | Sends 1–5 look normal ("Check your email"). Send 6: the banner "Too many tries in a short time. Please wait about 10 minutes and send the form again. Your answers are still here." | `signup.rate_limited` (no email in it) | ☐ |
| 6.2 | Run the signer once | At most 3 emails to your address went out this hour (and at most 6 today), whatever the number of sends — the rest were dropped silently | `mail.capped` | ☐ |

## 7. Expired link and expired session

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 7.1 | Real time expiry can't be waited for here (confirm 48 h, access 72 h, session 24 h, roadmap/updates 7 days); the automated suite checks each with a fake clock (`npm test`, flow tests). Instead: in a **private window** (no cookie) open `P/Download.dc.html` | "This link has expired." state with "Fill in the form again" | — | ☐ |
| 7.2 | In that private window open `P/api/download/mac/arm64` | Redirected to the Download page (expired state); nothing downloads | — | ☐ |
| 7.3 | Optional, GitHub storage only: in 4.2, copy the file link the browser was redirected to (Downloads list › copy address); open it again after more than an hour | GitHub refuses it (observed lifetime about 1 hour, not documented by GitHub) | — | ☐ |

## 8. Roadmap request

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 8.1 | `P/Roadmap.dc.html`: open an item | No email field and no **Notify me** (closed in launch log Part 14) | — | ☐ |

## 9. Unsubscribe and delete me

| # | Do | Expect | Logs | ✓ |
|---|---|---|---|---|
| 9.1 | Pretend you wrote to the support address asking to stop updates: `node tools/admin/admin.mjs unsubscribe <your email>` | `{"updates": 1, "notify": 1}` (updates consent withdrawn, roadmap request removed). Run again: `0`, `0` | `admin.unsubscribed` with counts only | ☐ |
| 9.2 | Pretend you asked to delete your data: `node tools/admin/admin.mjs delete <your email>` | `deleted: 1`, `notify`/`feedback` counts, `localTokenCopy: "removed"`, and a reminder to remove your line from `issued-tokens.tsv` by hand — do that | `admin.deleted` with counts only | ☐ |
| 9.3 | Reload the Download page in the browser that still has the cookie | Expired state; `P/api/session` answers 401 | — | ☐ |
| 9.4 | `node tools/admin/admin.mjs stats` | Back to zero (except anything you didn't delete) | — | ☐ |
| 9.5 | Look back over every log line from this test | No email, name, token, link token or IP in any line our function wrote | — | ☐ |

## 10. Clean up

- `unset SK_SIGNER_SECRET SK_ADMIN_SECRET SK_API_BASE`
- Delete `~/Desktop/test.csv`; delete the downloaded DMG if you don't need it.
- If you switched preview protection off for 0.8, switch it back on.
- Then run the same script on **production** (with the production secrets from Keychain: just don't export the
  two `SK_*_SECRET` variables) before you tell anyone the address.

If any step fails: note the step number, the exact page text, and the matching log lines (event names only).
Nothing in this test needs a password, card or key typed into a web page other than your own accounts.

---

## 2026-10-16 additions: Play gate, invitation, updates

On a protected Preview, pass `SK_VERCEL_BYPASS_FILE=<file with the Protection Bypass for Automation secret>` to the
signer and admin CLI, and use `SK_SIGNER_SECRET_FILE` / `SK_ADMIN_SECRET_FILE` (mode 600) instead of pasting
secrets. For a first run, use the stand-in issuer: `SK_ISSUER=$PWD/test/fixtures/fake-issuer.mjs` plus a
throwaway key in `SK_KEY_FILE`.

| # | Do | Expect | ✓ |
|---|---|---|---|
| A.1 | The form has **Google account email for Google Play**. Leave it empty and send | "Enter the Google account email your phone uses for Google Play." | ☐ |
| A.2 | After confirming, `signer --once` | `"issued":0`: no token and no invitation before play-added | ☐ |
| A.3 | `admin play-pending --out play.csv` | Your Google account, plus a line to paste into Play Console's "Add email addresses" box | ☐ |
| A.4 | Add it in Play Console, then `admin play-mark-added --file play.csv` | `marked: 1` | ☐ |
| A.5 | `signer --once` | `"issued":1,"mailed":2`: "Your Sidekick beta invitation" (Beta page, SHA-256, install steps, Play link) and "Your Sidekick beta token" (the token alone on its own line, no link) | ☐ |
| A.6 | `admin announce --subject … --body-file … --dry-run`, then without `--dry-run`, then `signer --once` | The counts only include people who confirmed updates. The update email has an unsubscribe link | ☐ |
| A.7 | Open the unsubscribe link and press **Unsubscribe** | "Unsubscribed". The same link again: "Link already used" (410) | ☐ |
| A.8 | `admin delete <you>` | Your row and everything linked to it are gone. Also take the address off the Play test list | ☐ |
