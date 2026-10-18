# Drafts (not sent anywhere)

Written 2026-10-17. Nothing here has been posted or emailed. Facts come from `data/releases.json` (version
2.0.1); if that file changes, update the tester guide's steps and checksum.

## Announcement — option A (plain)

> Sidekick is in a small beta. Mirror your Android phone's screen on your Mac, answer notifications, move files and
> share your clipboard — over your own Wi-Fi. No cloud. No account. You need a Mac with Apple silicon (M1 or later, macOS 11 or later)
> and an Android phone (Android 10 or later). To join, fill in the short form at https://side-henna.vercel.app and
> confirm your email. We add you to the Google Play test and email your download links and your beta token, up to
> a day later. Places are limited.

## Announcement — option B (casual)

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
