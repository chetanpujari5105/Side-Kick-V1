# Drafts (not sent anywhere)

Written 2026-10-17, final messages added 2026-10-18. Nothing here has been posted or emailed. Facts come from `data/releases.json` (version
2.0.1); if that file changes, update the tester guide's steps and checksum.

## Final messages (ready to send, 2026-10-18)

Nothing below has been sent. The owner sends them. They use the short link `https://side-henna.vercel.app/get`, which
opens the Get Sidekick form (launch log Part 10). The short link works while `SITE_MODE=automated`. With the kill
switch on (`SITE_MODE=manual`) it answers 404, and the email-only page is at
`https://side-henna.vercel.app/Get%20Sidekick.dc.html`. Send only after the legal review of the privacy text and the
updates emails (the DRAFT banner stays until then), and only while the cap is 50 (`admin stats` shows `betaCap`).

### WhatsApp / DM (3 lines)

> I'm opening a small beta of Sidekick: your Android phone on your Mac (screen, notifications, files, clipboard) over your own Wi-Fi, no cloud, no account.
> Mac with Apple silicon (M1 or later), macOS 11 or later: one click at https://side-henna.vercel.app/get downloads the app and shows your beta token on the page.
> Android (10 or later) comes by Google Play test invitation: tick Android, type the Google email your phone uses, and the link arrives within a day. It's a small invited beta, limited to 50 people.

### Email

> **Subject:** You're invited: the Sidekick beta (50 places)
>
> Hi,
>
> I've been building Sidekick. It puts your Android phone on your Mac: mirror the screen, answer notifications, move
> files and share the clipboard. Everything goes over your own Wi-Fi, with no cloud and no account. I'm opening a small
> invited beta, limited to 50 people, and I'd like you to be one of them.
>
> **What you need:** a Mac with Apple silicon (M1 or later) running macOS 11 or later. For the phone side, an Android
> phone with Android 10 or later.
>
> **How to join:** open https://side-henna.vercel.app/get, type your name and email, tick the privacy box and click
> **Get the Mac app**. That one click starts the download, and your beta token is shown on the same page with a Copy
> button. The page lists three install steps. macOS asks you once to allow the app, because this beta isn't notarized
> by Apple yet.
>
> **Android:** tick "I also want the Android app" and type the Google email your phone's Play Store uses. Android
> comes by Google Play test invitation: I add you to the test list and you get an email with the Play link, within a
> day.
>
> If something breaks, just reply to this email (see below).
>
> Thanks for trying it,
> Chetan

### Short post

> Sidekick beta is open to 50 people: your Android phone on your Mac, over your own Wi-Fi, with no cloud and no account.
> Mac with Apple silicon, macOS 11+. One click at https://side-henna.vercel.app/get downloads it and shows your beta
> token on the page. Android comes by Google Play test invitation: type the Google email your phone uses, and the link
> arrives within a day. Small invited beta, 50 places.

### What to do if something breaks (for testers; paste under any message)

> If something doesn't work, reply to the email you got from Sidekick (or write to chetanpujari.sitit@gmail.com) with
> your Mac model and macOS version, your phone model and Android version, the step you were on and the exact message
> you saw. Never send your token or a screenshot of it. **Lost your token?** On the page, click "Email me a copy", or
> fill in the form at https://side-henna.vercel.app/get again with the same email. The page won't show the token a
> second time, but it emails "Your Sidekick beta: download link and token" to that address. **Download failed?** Use
> "Download again" on the page, or https://side-henna.vercel.app/download/mac. Under "More details" there is a
> Google Drive fallback. **No Android email after a day?** Check spam, then reply and tell us which Google account your
> phone uses.

## Owner checklist: day one (one page)

Run the commands from any folder with the helper `~/Documents/Sidekick-private/sk-admin.sh <command>` (Production; it
reads the admin secret from its file). The equivalent long form is `cd ~/Desktop/Side-Kick-V1 &&
SK_API_BASE=https://side-henna.vercel.app SK_ADMIN_SECRET_FILE=~/Documents/Sidekick-private/secrets/production.ADMIN_AUTH_SECRET
node tools/admin/admin.mjs <command>`.

1. **Morning and evening: is the signer healthy?**
   `cd ~/Desktop/Side-Kick-V1 && SK_API_BASE=https://side-henna.vercel.app SK_SIGNER_SECRET_FILE=~/Documents/Sidekick-private/secrets/production.ADMIN_AUTH_SIGNER_SECRET node tools/signer/signer.mjs --status`
   Good: `last run … (ok)` a few minutes ago, `consecutive failed runs: 0`, a queue of `0 emails waiting`, `token pool … N ready`
   with N of 40 or more. A few `ENOTFOUND` lines in `~/Library/Logs/sidekick-signer.log` are normal when the Mac's network
   blips, as long as the next run is ok. An `ATTENTION` line means the Mac was asleep or offline. Keep the Mac awake and
   online (`caffeinate -i -t 43200` in a Terminal; closing that Terminal or `pkill -f "caffeinate -i -t 43200"` stops
   it). On battery with the lid closed it sleeps anyway.
2. **Once a day: Android (about 60 seconds; skip it when `--status` says `Android: 0 Google accounts waiting`).**
   `sk-admin.sh play-batch` → Play Console › Sidekick › Internal testing › Testers › arrow next to **Sidekick beta
   testers** › paste the one line › Enter › **Save changes** → `sk-admin.sh play-mark-added --all-pending` (check the
   count) → the same with `--yes`. The signer emails "Sidekick for Android: your Google Play link" within ~5 minutes.
   Details: OWNER-CLICKS §5. To have Claude do it, use the daily prompt: *"Daily Android routine for Sidekick: run
   play-batch; if it lists N > 0 accounts, add exactly that line to 'Sidekick beta testers' in Play Console, save, check
   the list grew by N, then play-mark-added --all-pending, check the count is N, then --yes; report the counts only."*
3. **Reading the sign-ups.** `sk-admin.sh stats` gives totals by state, `betaCap`, `outboxPending` and `downloads`.
   `sk-admin.sh export > ~/Documents/Sidekick-private/signups-$(date +%F).csv` (then `chmod 600` it) gives one row
   per person. `state`: `delivered` = got the token; `pending_email` = hasn't confirmed; `waitlisted` = over the cap.
   `google_email` and `play_added_at` (empty = still waiting for the Android routine) are there too. The export has no
   token column. Don't share it: it holds people's email addresses.
4. **Kill switch.** Vercel › the `side` project › Settings › Environment Variables › Production `SITE_MODE` = `manual`
   › Redeploy. Sign-ups close, the site becomes the email-only beta and `/get` answers 404. Back: `SITE_MODE` =
   `automated` › Redeploy. Lighter switches are in OWNER-CLICKS §8 (`SIGNUP_DAILY_CAP=0`; `SK_POOL=off`).
5. **Raise the cap.** `sk-admin.sh settings --cap 50` (or any N). It changes only the cap: allow and deny lists stay
   as they are. Check with `sk-admin.sh stats` (`betaCap`). Waitlisted people move up (oldest confirmation first) at the daily retention job (03:17 UTC), or at once with `sk-admin.sh promote`.
6. **Delete a person.** `sk-admin.sh delete their@email`, then in Play Console › Sidekick beta testers remove their
   Google email › Save changes. A token already given keeps working until it expires, because the app checks it offline.

## Earlier drafts (2026-10-17, the email flow; superseded by the final messages above)

### Announcement — option A (plain)

> Sidekick is in a small beta. Mirror your Android phone's screen on your Mac, answer notifications, move files and
> share your clipboard — over your own Wi-Fi. No cloud. No account. You need a Mac with Apple silicon (M1 or later, macOS 11 or later)
> and an Android phone (Android 10 or later). To join, fill in the short form at https://side-henna.vercel.app and
> confirm your email. We add you to the Google Play test and email your download links and your beta token, up to
> a day later. Places are limited.

### Announcement — option B (casual)

> I've been building Sidekick: mirror your Android phone on your Mac, answer notifications, move files and share
> your clipboard, all over your own Wi-Fi (no cloud, no account). It's ready for a few testers. Got an Apple-silicon Mac (M1 or newer) and an Android phone (Android 10+)? Sign up at
> https://side-henna.vercel.app, confirm your email, and within a day you'll get the Mac download, the Android test
> link and your beta token. I'd love your feedback — the rough edges especially.

(Before sending either: the Privacy text and the updates emails need their legal review, and only invite as many
people as the Play list and your Mac can handle — see docs/OWNER-CLICKS.md §5–6.)

## Tester guide (one page)

**What you get.** After the Get Sidekick form, a page that says "You're in": the Mac download starts (or a
button starts it), your beta token is on that page with a Copy button, and "Email me a copy" sends it to you. If the
page says we're doing it by email instead, you get "Your Sidekick beta invitation" and "Your Sidekick beta token";
they can take up to a day; check your spam folder. (Updated 2026-10-18 for the one-click flow.)

**The Mac app.** The download is `https://side-henna.vercel.app/download/mac` (if the download fails, the page and the
emails name a Google Drive folder as the fallback): `Sidekick-2.0.1-arm64.dmg` (121,668,061 bytes). To check the download (optional), open Terminal and run
`shasum -a 256 ~/Downloads/Sidekick-2.0.1-arm64.dmg`; it must print exactly:
`a03b3390db4a81b1602deefd25825c16d0b72dc654c7a45ba52f9d5834f71284`
That line is only for checking the file; it is not your token.

Install it:
1. Open Sidekick-2.0.1-arm64.dmg and drag Sidekick into Applications.
2. Open Sidekick from Applications. macOS says it could not verify the app, because this beta isn't notarized by Apple yet. Choose Done.
3. Open System Settings › Privacy & Security, scroll to the message about Sidekick, click Open Anyway and enter your Mac password, then click Open Anyway again in the dialog that follows. You only do this once. Never turn off Gatekeeper: nothing here needs it.
4. Sidekick shows a short note that macOS may ask for your Mac password. Click Continue. If macOS then asks to use “Sidekick Safe Storage” in your keychain, enter your password and click Always Allow. That is where Sidekick keeps the key your phone knows this Mac by.
5. Sidekick asks for your beta token. Copy it and press Paste token, or press Open token file… and choose the file ending in .sidekick-token.
6. If macOS asks whether Sidekick may find devices on your local network, click Allow. Sidekick then shows a code for your phone to scan.

**The Android app.** On your phone, signed in to the Google account you gave us, open the Google Play test link from
the invitation. Accept the invitation, then follow its link to Google Play and tap Install. While Sidekick is in
testing, Play may show it under its package name instead of "Sidekick". If Play says you can't join, reply to the
invitation and tell us which Google account the phone uses.

**Pair them.** Open Sidekick on the phone, tap Get started, then Scan the code, and scan the code on your Mac.

**Reporting a problem.** Write to chetanpujari.sitit@gmail.com (or reply to the invitation) with: your Mac model and
macOS version, your phone model and Android version, the step you were on, the exact message you saw, and a
screenshot if you can — but never a screenshot or copy of your token. To leave the beta and have your details
deleted, reply "remove me".
