# External privacy page — draft text (2026-10-15)

> ## ⚠ NEEDS LEGAL REVIEW — NOT FOR PUBLICATION AS IS
>
> This is a draft for the owner's external page at `chetan-website-delta.vercel.app/sidekick/privacy` (the page the
> site footer links to, `SiteFooter.dc.html:56`). **Nothing was published, pushed or edited on any site.** Before it
> goes live it needs a legal review, and the effective date must be set on the day the reviewed text goes live (the
> same rule as `data/site-config.js:16-18`).

**Sources.** The apps: `../ConnectSuite-overnight/docs/privacy-facts-2026-10-15.md` (branch `post-dmg/2026-10-15`;
called *the facts file* below), with the key code lines re-read for this draft. The website: Support › Privacy on
this branch (`Support.dc.html:150-179`) and the server code it describes. App paths below are relative to
`../ConnectSuite-overnight`; site paths are relative to this repo.

**Marks.** **[V]** verified, with file:line · **[U]** unverified (not observed or not measured) · **[A]** assumed or
inferred, and stated as such. Every "never" or "none" here is a code read, not a traffic capture. That is why the text
says *"built not to"* and *"we have not measured"* rather than *"we guarantee"* (facts file, lines 10-12).

**How to use this.** Part 1 is the page text. Each sentence carries a number, like `[3]`. Part 2 gives each number's
mark and evidence. Remove the numbers before publishing.

---

## Part 1 — Page text

### Sidekick privacy policy

**Draft. Effective date: [set on go-live day, after legal review].**

Sidekick has two apps, one for Mac and one for Android, plus a website. This page covers all three. In short:
the apps connect your phone and Mac to each other and send nothing to us. The website keeps what you type into its
forms.

#### The apps

**No account, no server, no tracking.** Neither app has a Sidekick account or anything to sign in to. [1] Your phone
and Mac connect directly to each other over your own network, encrypted with TLS 1.3, and each one refuses a device
whose certificate doesn't match the one it paired with. [2] Neither app is built with an analytics, advertising or
crash-reporting kit, and neither app is built to send anything to us. [3] The phone reads the pairing code itself,
using an open-source decoder. [4] We have checked the code and the builds. We have not yet measured the apps'
network traffic. [5] If you install from Google Play, Google's privacy policy covers what Google Play itself
collects. [6]

**What leaves your devices.** Data goes over the link between your paired phone and Mac, and nowhere else. [7] To find
each other, the apps announce themselves on your local network. [8] A link you open from Sidekick's clipboard
history opens in your web browser, as any link would. [9]

**What the Mac shows but doesn't keep.** Messages, notification text and clipboard contents are held in memory while
your phone is connected. They are cleared when it disconnects, and Sidekick doesn't write them to the Mac's disk. [10]
Clipboard history keeps at most 20 entries. [11] Photos and videos you open for a preview are stored temporarily and
deleted when you disconnect or quit. [12] If a phone notification is also shown as a macOS notification, macOS keeps
it in Notification Center until you clear it. [13]

**What the Mac keeps on its disk.** Everything is in the folder `~/Library/Application Support/sidekick-desktop`. [14]
It holds:

- **An Activity history.** For a call, it records the caller's **contact name** as it appears on your phone, or
  "Unknown number". It **never** records the phone number. [15] It also records the names of files you send or save,
  your phone's name, and short status lines such as "Message received", without the message itself. [16] It keeps the
  newest 2,000 entries, with no time limit. [17] There is no button to clear it yet. [18]
- **A diagnostic log** of at most two 512 KB files. It shows phone numbers only as their last two digits and never
  includes message, notification or clipboard text. It can include file names, app names and your phone's
  name. [19]
- **Your settings and the pairing record**, which includes your phone's name. [20]
- **This Mac's key.** It is sealed with the macOS Keychain. [21]
- **Your beta token.** Only your Mac user account can read it. The app checks it on the Mac and doesn't send it
  anywhere. [22]

Photos and files you save go to the folder you choose (Downloads unless you change it). Mirror screenshots go to your
Desktop. [23] Time Machine backs up the Sidekick folder unless you exclude it. [24]

**What the phone keeps.** The phone keeps the paired devices, a list of transfers and its own diagnostic log of at
most two 512 KB files. [25] Its private key is kept in Android's Keystore. [26] Files it receives go to
Download › ConnectSuite. [27] The app's settings and database are excluded from Android cloud backup and
device-to-device transfer. Its log file isn't, so a phone-to-phone transfer may copy it. [28]

**Removing everything.**

- *Mac:* quit Sidekick and delete the app. Then delete the folder `~/Library/Application Support/sidekick-desktop`.
  Last, open Keychain Access and delete the item **Sidekick Safe Storage**. [29] Files and screenshots you saved stay
  where you saved them until you delete them. There is no "Remove all data" button yet. [30] *Start over* in the app
  forgets your phone, but it doesn't clear the Activity history. [31]
- *Phone:* uninstall Sidekick. This removes its data. [32] Files it received stay in Download › ConnectSuite until
  you delete them. [27]

#### The website

The website runs no analytics. [33] It's hosted by Vercel, which receives the standard details any website visit
sends, such as your IP address and browser. [34] The Get Sidekick form, the pages our emails link to and the roadmap
forms show a human check from Cloudflare (Turnstile). Cloudflare receives the details that check needs from your
browser, and Cloudflare's privacy policy covers them. [35]

The site sets one cookie, `sk_session`. It's set only after you send the Get Sidekick form or open a link from one of
our emails. It lasts 24 hours and lets that browser show where your sign-up stands and, once you're in, your download
page. It holds your first name or a reference to your sign-up, signed so it can't be altered, and nothing else. [36]

**What we store when you sign up.** We store your name, email, Mac chip, phone model, the time you agreed to this
policy, whether you asked for updates, and the dates your sign-up moved on (confirmed, approved, token sent). [37] We
use them only to run the beta and to know which builds people need. [38] We don't store your IP address. Rate limits
keep only a one-way code made from it, for up to two days. [39]

If you ask to hear when a roadmap item ships, we store your email and that item. We email you about it only after you
confirm by email. If you send a suggestion, we store your message and, if you give it, your email. [40]

Your details are stored in a database run by Neon. [41] The Mac app downloads from a private GitHub release, so
GitHub receives the standard request details. We keep a record of each download for 180 days. [42]

Our emails are sent by the Mail app on our own Mac, from our own email account. Your address and each email pass
through that Mac and our email provider. An email waits in our database until our Mac sends it, and then its address
and text are erased there. [43]

Your beta token is made on our Mac. It contains the name you gave, a random id and its start and end dates. Our Mac
keeps a copy of it and a list of the tokens it has issued (date, id, name, start and end). We email the token to you,
and it is erased from our database 46 days after it's issued. [44]

**How long we keep it.** Sign-ups and roadmap requests that are never confirmed are deleted after 7 days. We keep
other details until you ask us to delete them, or for a year after they last changed. [45]

#### Asking us to delete your details

Write to **chetanpujari.sitit@gmail.com** and ask us to delete your details. We delete your sign-up and everything
linked to it, your roadmap requests and suggestions sent from that address, and our Mac's copy of your token. We do
this within 30 days of your request. [46] To stop update emails, write to the same address. [47]

The apps keep nothing on our side, so there is nothing of yours from the apps for us to delete. To remove app data,
follow *Removing everything* above. [48]

#### Who we are

Chetan Pujari, India · chetanpujari.sitit@gmail.com. [49] When this policy changes, we change the effective date at
the top of this page. [50]

---

## Part 2 — Each statement, marked

| # | Mark | Evidence |
|---|---|---|
| 1 | **[V]** | No sign-in or account in either app: facts file §(d) (no network calls of its own). Same sentence as Support › Privacy, `Support.dc.html:154` |
| 2 | **[V]** for the sockets; **[A]** for the TLS 1.3 and pinning wording | TLS server sockets `core/src/main/java/com/chetan/connectsuite/core/link/LinkTls.kt:112-125` (facts file §b). The TLS 1.3 and certificate-pinning wording comes from `Support.dc.html:155` and was not re-read in code for this draft |
| 3 | **[V]** code and build; **[U]** on the wire | No SDK in any `build.gradle.kts`, and 0 classes for Firebase, ML Kit, GMS, datatransport, Sentry, Crashlytics or OkHttp in the Play bundle's R8 mapping (facts file §b, lines 37-53). Mac: no `fetch`, `net.request`, `crashReporter` or `autoUpdater` in main/shared/preload; `electron-builder.yml:154` `publish: null` (facts file §d) |
| 4 | **[V]** | `app/build.gradle.kts:176-184` (ZXing replaced ML Kit; comment re-read for this draft) |
| 5 | **[U]**, stated as unmeasured | No traffic capture exists (defect 188's F9 has not been run): facts file lines 34-35, 81, 136 |
| 6 | **[A]** | Google Play's own collection is outside the app's code |
| 7 | **[V]** code; **[U]** on the wire | Facts file §(d). The only sockets are the link's and the older local *Sync* transport's, both on the local network (`ConnectionManager.kt:123-160`, `UdpDiscovery.kt:83-146`) |
| 8 | **[V]** | Mac: mDNS through `bonjour-service`, the gateway address and `/sbin/route` run locally (`desktop/src/main/discovery.ts`, file-level). Phone: UDP discovery `core/.../discovery/UdpDiscovery.kt:83-146` (facts file §b, §d) |
| 9 | **[V]** | `desktop/src/main/main.ts:2850-2868`: http/https only. Activity records "Opened a link" without the URL (facts file §d) |
| 10 | **[V]** | Cleared on disconnect: `desktop/src/main/clipboard.ts:509` (re-read), `notifications.ts:148`, `sms.ts:364` (facts file §c) |
| 11 | **[V]** | `desktop/src/shared/clipboardHistory.ts:17` `HISTORY_MAX = 20` (re-read) |
| 12 | **[V]** | `desktop/src/main/mediaPreview.ts:40,53-55,69,134-145`; `main.ts:2136,2411`. A crash leaves previews in place until the next start **[A]** (facts file §c) |
| 13 | **[V]** banner content; **[A]** macOS retention | `nativeNotifier.ts:248-256`; macOS's own storage is outside Sidekick (facts file §c) |
| 14 | **[V]** | `desktop/src/main/profile.ts:24` `PACKAGED_PROFILE = 'sidekick-desktop'` (re-read). Files you save and the Keychain item are outside this folder, as the page says |
| 15 | **[V]** | `desktop/src/main/activity.ts:191-193` `storedDetail` runs every `calls` row through `callHistoryName` on its way to disk. `desktop/src/shared/callRecord.ts:70-78` turns empty, number-shaped or 7+-digit names, or names that hold the caller's number, into "Unknown number" (both re-read). Older files that hold numbers are rewritten on load: `activity.ts:204-256` (facts file §a) |
| 16 | **[V]** | `main.ts:2328-2337` (messages: no text), `:2254-2262` (clipboard: byte count only), `:3096-3108,3156-3158` (file names), `:2078` (phone name) (facts file §a) |
| 17 | **[V]** | `activity.ts:38-39` `MAX_EVENTS = 2_000`, `MAX_BYTES = 1 MB` (re-read). Past 1 MB the file is renamed `.old` and rewritten, so up to two files exist (facts file §a). The page leaves out the `.old` detail; deleting the folder removes both |
| 18 | **[V]** | The Activity pane only exports (`desktop/src/renderer/activity.ts:350`). No clear exists in main, preload or renderer (facts file §a) |
| 19 | **[V]** for the files named; **not exhaustive** | `desktop/src/main/logger.ts:9-18` (two 512 KB files, re-read). Last two digits only: `calls.ts:84,227` and `shared/callRecord.ts:43-52`. App names: `main.ts:2227`. File names: `main.ts:2163,3106`. That the phone's name appears in connection lines is **[A]** (facts file §c table) |
| 20 | **[V]** | `desktop/src/main/store.ts:6-58,81-92` (facts file §c) |
| 21 | **[V]** file; **[A]** sealing | `identity.ts:41`, `identityStore.ts`. The sealing is inferred from the name and from defect 207's record (facts file §c) |
| 22 | **[V]** | Mode 600: `trial.ts:43,96,136`. Offline Ed25519 check: `trial.ts:31,145,183` (facts file §c, §d) |
| 23 | **[V]** | `downloads.ts`, `main/photos.ts`; screenshots `main.ts:2579` (facts file §c) |
| 24 | **[A]** | Time Machine's default behaviour. Not on Support › Privacy; it comes from `docs/privacy-policy-draft-2026-10-09.md` §1. Drop it if the review prefers to match the Support page exactly |
| 25 | **[V]** | Room entities `TrustedDeviceEntity`, `TransferEntity`, `MirroredNotificationEntity`: `core/src/main/java/com/chetan/connectsuite/core/data/ConnectSuiteDatabase.kt:26`. Log: `core/.../link/LinkLog.kt:20` `MAX_BYTES = 512 * 1024` (both re-read). What the phone's log contains was **not** read **[U]**. See open item O2 for the third entity |
| 26 | **[V]** that it uses the Keystore; **[A]** "cannot be exported, hardware-backed" (left off the page) | `core/.../crypto/DeviceIdentity.kt:48,98` (`AndroidKeyStore`, `KeyGenParameterSpec`) |
| 27 | **[V]** | `sync-module/.../ui/transfers/TransfersScreen.kt:139,294` ("Download › ConnectSuite") |
| 28 | **[V]** rules; **[A]** platform behaviour, not tested | `app/src/main/AndroidManifest.xml:106-108` (`allowBackup="false"`, re-read). `res/xml/data_extraction_rules.xml` excludes `sharedpref` and `database` from both cloud backup and device transfer; the `files` domain, where the log lives, is not excluded (re-read) |
| 29 | **[V]** folder; **[A]** Keychain item name | Folder as in 14. The item name **Sidekick Safe Storage** is not in the code. It is assumed from Electron's `safeStorage` naming plus `productName: Sidekick` (`desktop/electron-builder.yml:36`). `docs/privacy-policy-draft-2026-10-09.md` §2 records it as "measured 2026-10-08 (attributes only)" |
| 30 | **[V]** | "Remove all data" is listed as not built: `docs/feature-parity-audit-2026-10-14.md` row 38 (facts file §a) |
| 31 | **[V]** | `main.ts:1265-1282` (facts file §a) |
| 32 | **[A]** | Android removes an app's private storage on uninstall (platform behaviour, not tested here) |
| 33 | **[V]** | Same as Support › Privacy `Support.dc.html:164` (live branch of the text). Nothing that loads analytics on the site pages was re-grepped for this draft. The site's own page is the source of truth |
| 34 | **[A]** | Standard hosting behaviour. Same as `Support.dc.html:164` |
| 35 | **[V]** wording matches site; **[A]** what Cloudflare receives | `Support.dc.html:165` |
| 36 | **[V]** as stated on the site | `Support.dc.html:166`. `server/session.mjs:9,18` (signed with HMAC). The 24-hour lifetime was not re-read in code |
| 37 | **[V]** | `server/schema.sql`, `signups` table: `name`, `email`, `mac_chip`, `phone_model`, `privacy_accepted_at`, `marketing_requested_at` / `marketing_confirmed_at`, `confirmed_at`, `approved_at`, `token_issued_at`, `token_emailed_at` |
| 38 | **[A]** | A statement of purpose; code can't verify it |
| 39 | **[V]** | `server/app.mjs:31` (the rate-limit key is an HMAC of the input) and `:40`. `server/repo-pg.mjs:216` deletes rate-limit rows older than 2 days. There is no IP column in `server/schema.sql` |
| 40 | **[V]** | `server/schema.sql` tables `roadmap_notify` (email, feature, `confirmed_at`) and `feedback` (message, optional email). The confirm link: `server/app.mjs:15` |
| 41 | **[A]** | The hosting choice is in `docs/OWNER-SETUP.md`. The code only shows Postgres (`server/repo-pg.mjs`) |
| 42 | **[V]** retention; **[A]** GitHub | `server/repo-pg.mjs:219` deletes downloads older than 180 days. GitHub's request logging is outside our code |
| 43 | **[V]** | `server/repo-pg.mjs:123` blanks `to_email` and `body` when an email is sent. `:218` deletes outbox rows 7 days after sending, or 30 days after creation |
| 44 | **[V]** | `server/repo-pg.mjs:214` clears the token 46 days after issue. Mac copy: `tools/admin/admin.mjs:44-48`. Token contents as on `Support.dc.html:174` (the token format was not re-read) |
| 45 | **[V]** | `server/repo-pg.mjs:212-213` (unconfirmed after 7 days; others after `retentionSignupDays`, 365 by default, `server/config.mjs:49`). Roadmap requests: `:220` (unconfirmed after 7 days, confirmed after 365) |
| 46 | **[V]** for what is deleted; **[A]** for the 30 days | `server/app.mjs:292-300` (`deleteByEmail`: sign-up, roadmap requests, feedback). `tools/admin/admin.mjs:5-7,44-48` removes the signer's token copy. **The issuer's list `~/.sidekick-trial-key/issued-tokens.tsv` must be edited by hand** (`admin.mjs:47`). That is a manual step behind this promise. "Within 30 days" is the owner's commitment (`Support.dc.html:177`), not code |
| 47 | **[V]** | `tools/admin/admin.mjs:8`, `server/app.mjs:302-307` (`unsubscribe`) |
| 48 | **[V]** code; **[U]** on the wire | Follows from 3 and 7 |
| 49 | **[V]** | `data/site-config.js:13-15` (`supportEmail`, `publisher`, `publisherAddress: 'India'`, country only by the owner's choice) |
| 50 | **[V]** as on the site | `Support.dc.html:178` |

---

## Part 3 — Sentences on the old page known to be wrong

**I could not read the old page's text.** It is not in this repo or in `../ConnectSuite-overnight`, and no saved copy
or site log of it exists in either. I did not fetch the live page, because this task allowed only the repo and the
earlier site log. The only text from it I can read is what `docs/OWNER-SETUP.md:26-30` quotes:

| Old page (as quoted in `docs/OWNER-SETUP.md:27-29`) | Why it is wrong | Replaced by |
|---|---|---|
| "Notifications, messages, call lists, contacts and photos … are not written to disk" | The Mac's Activity history writes each caller's **contact name** to disk (`activity.ts:191-193`, `callRecord.ts:70-78`) | Statements 10 and 15 |
| "sends nothing" (wording as quoted; the full sentence is not available) | It has no limit. No traffic capture exists, so the honest form is "built not to send anything; we have not measured the traffic" | Statements 3 and 5 |

**Possibly more — not verified.** The first quote matches `docs/privacy-policy-draft-2026-10-09.md:72-73` word for
word. The old page may have been built from that draft **[A]**. If it was, these draft sentences would also be out of
date, because they are absent from or weaker than the facts file: *"diagnostic logs (connection states, counts and
file names — no message, clipboard or file content)"* (the Mac log also holds app names and the phone's name, and
phone numbers as two digits), and the *"no … service that sends data to us or to a third party"* sentence (no
"not yet measured" limit). Compare the live page with Part 1 before removing it; don't rely on this guess.

---

## Part 4 — Open items for the owner and the legal review

- **O1. The F9 traffic capture.** Statements 3, 5, 7 and 48 stay *"built not to … not yet measured"* until it is done.
  The defect register still calls 188 open (`docs/defects.md:206` in the app repo; facts file line 34).
- **O2. The phone's `mirrored_notifications` table** (`core/.../data/MirroredNotification.kt:12-27`) stores the
  title and text of notifications received *from another paired Android device*, through the older phone-to-phone
  Sync. With only a Mac paired it should stay empty **[A]**. If phone-to-phone Sync ships in the beta, Part 1 must say
  that this phone stores those notifications. The facts file does not cover phone-side storage. Statement 25 was read
  for this draft only.
- **O3. Deletion has a manual step.** The issuer's token list is edited by hand (statement 46). Either keep that step
  in the owner's routine or change the promise.
- **O4. Not covered by this draft, for the reviewer.** A children's clause (the 10-09 draft had "not directed at
  children under 13"); the legal basis and governing law for users outside India; how policy changes are announced
  beyond the date; and whether the Google Play Data safety form matches Part 1.
- **O5. Never share** the Sep 29 `app-release.apk` in the app repo. It predates the ML Kit removal (facts file line 60;
  `docs/OWNER-SETUP.md:30-31`).
