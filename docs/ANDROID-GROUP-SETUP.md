# Android testers through a Google Group (optional, NOT tested against real Google)

Today (`ANDROID_ACCESS=manual-batch`, the default) you paste a daily batch of Google accounts into Play Console's
"Sidekick beta testers" email list (docs/OWNER-CLICKS.md §5). Email lists can only be edited in Play Console; the
Play Developer API can manage Google Groups as testers, not email lists. This page describes the automatic
alternative, `ANDROID_ACCESS=google-group`, which is **built but disabled**, and has been tested **only against a local
mock of Google's endpoints** (test/pool-signer.test.mjs). Nothing below has been created, and no call has been made
to real Google.

## How it would work

1. A visitor ticks Android on Get Sidekick and gives their Google account. The result page says their Play link comes
   by email.
2. On its next run, the signer on **your Mac** asks the site for waiting Google accounts, adds each one to your Google
   Group with the Cloud Identity Groups API, and only after Google accepts it (or says it's already a member) tells the
   site, which queues "Sidekick for Android: your Google Play link". Credentials never leave your Mac; Vercel never
   sees them.
3. In Play Console the group is the tester source of a **closed testing** track.

## What Play Console allows (checked read-only on 2026-10-18)

- **Internal testing**: email lists only (no Google Groups), up to 100 testers. So the group route needs a **closed**
  track.
- **Closed testing** (your "Closed testing - Alpha" track): "Email lists" or "Google Groups". The Alpha track is
  inactive with a draft release, and three old email lists (Musa, Reel People, sapna) are ticked on it — untick them
  before using that track.
- **Open testing**: locked until the developer account has production access.
- A closed track's release goes through Google's review before testers can install it (the Alpha track's setup shows
  "Send the release to Google for review").

## Why it needs a domain and Cloud Identity or Google Workspace

The Groups API manages groups that belong to a Google Cloud **organization**, and an organization exists only for a
domain you verify with **Cloud Identity** (Free or Premium) or **Google Workspace**. A consumer group made at
groups.google.com with your Gmail address cannot be managed through that API. Pricing and the exact limits of the free
Cloud Identity tier were not checked [unverified]: read cloud.google.com/identity/docs/editions before deciding.

## Setting it up (only if you decide to)

1. Have a domain (for example the one the site will use) and sign up for Cloud Identity Free or Workspace with it.
2. In admin.google.com: Apps › Google Workspace › Groups for Business › allow members **outside your organization**.
3. Create the group, e.g. `sidekick-beta@your-domain`, and in its settings allow **external members**.
4. In Google Cloud Console (a project in that organization): enable the **Cloud Identity API**; create a **service
   account**; create a JSON key for it and save it on your Mac only, e.g. `~/Documents/Sidekick-private/secrets/
   google-group-sa.json`, then `chmod 600` it. Make the service account a **manager** of the group (Groups ›
   the group › Members › add the service account's email as Manager) — the exact role needed was not verified
   [unverified]; Google's docs also describe granting it the Groups Admin role in admin.google.com.
5. Play Console › Sidekick › Closed testing › your track › Testers › **Google Groups** › enter the group's email ›
   Save. Roll out a release on that track and wait for review.
6. Turn it on:
   - Vercel Production: `ANDROID_ACCESS=google-group`, then redeploy (the result page then says "usually within the
     hour", and the signer may ask for waiting accounts).
   - The signer's launchd plist (`~/Library/LaunchAgents/com.sidekick.signer.plist`), EnvironmentVariables:
     `SK_ANDROID_ACCESS` = `google-group`, `SK_GOOGLE_GROUP` = the group's email, `SK_GOOGLE_CREDENTIALS_FILE` = the
     key file's path. Then `launchctl bootout gui/$(id -u)/com.sidekick.signer` and `launchctl bootstrap gui/$(id -u)
     ~/Library/LaunchAgents/com.sidekick.signer.plist`.
   - Optional for testing against something else: `SK_GOOGLE_API_BASE` (default `https://cloudidentity.googleapis.com`)
     and `SK_GOOGLE_TOKEN_URL` (default `https://oauth2.googleapis.com/token`).
7. Check: the signer log shows `signer android-group: {"pending":N,"added":N,"failed":0}`; a refusal is logged with
   Google's HTTP status and leaves that person waiting (nothing is marked, no email goes out).

## Undo

Set `ANDROID_ACCESS` back to `manual-batch` (redeploy) and remove `SK_ANDROID_ACCESS` from the plist (restart the job).
People already in the group stay there until you remove them at groups.google.com.
