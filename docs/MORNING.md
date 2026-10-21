# Morning: open, check, merge (written overnight, 2026-10-15)

The site now has two modes, chosen by one Vercel variable, `SITE_MODE`:

- **`manual`** (set for Preview and Production last night): an email-only beta. No database, no Turnstile, no
  cookies, no forms that send anything. "Get Sidekick" becomes **Request access**: a button that opens your
  visitor's email app with a message to chetanpujari.sitit@gmail.com asking for name, Mac chip (Apple silicon only),
  phone model, the Google account for the Play test list, and consent to Privacy. The build needs no secret.
- **`automated`**: the full signup → confirm → token → download flow, unchanged, for when the accounts exist
  (`docs/OWNER-SETUP.md`).

The unlisted `/Beta.dc.html` page (Drive link, SHA-256, install steps, Play link, no APK) is exactly as before, and
nothing links to it.

Facts marked **[V]** were checked last night (output, file, or a doc read on 2026-10-15); **[A]** is an assumption.

---

## 1. Open the preview

**https://side-git-site-closeout-2026-10-15-chetanpujari5105s-projects.vercel.app**

It always shows the newest commit on the branch. Previews sit behind Vercel's login, so open it in the browser where
you're signed in to Vercel. The small Vercel toolbar you may see is Vercel's preview tool, not part of the site; it
isn't on production [V https://vercel.com/docs/vercel-toolbar].

## 2. Look at these ten things

1. **Header:** the green button reads **Request access**.
2. **Request access page:** click the button. Three steps, then **Email us to request access**. Click it: Mail opens a
   new message to you with the subject "Sidekick beta: request access" and the four questions plus the consent line.
   Close it without sending (or send it to yourself to see what visitors send).
3. **Download page** (`/Download.dc.html`): "Beta by invitation", the same email button, no download button, "There
   is no APK download".
4. **Roadmap:** open any item: **Email me when this ships** (the subject names the item). At the bottom, **Email a
   suggestion**.
5. **Support › Privacy**, section "This website": read it and check every sentence is true for how you run the beta
   (your Gmail inbox, the Play test list, tokens made on your Mac, Vercel logs kept one hour on the Hobby plan). The
   **DRAFT** banner at the top must still be there.
6. **Footer:** "Request access", and **Privacy** goes to Support › Privacy, no longer to your other site.
7. **`/Beta.dc.html`** (type it into the address bar): the Drive link opens your folder, the SHA-256 is
   `a03b3390…f71284`, the Play link is there, and so is "There is no APK download".
8. **Phone width:** make the window narrow, or open the preview on your phone (it needs your Vercel login there too).
   Nothing should run off the side.
9. **Your Drive folder's sharing:** the Drive link is in a public repo and on the site. If the folder is "Anyone with
   the link", the DMG is effectively public (the token still decides who can use the app). Restrict it if you prefer.
10. **Vercel › side › Deployments:** the newest Preview is **Ready**, and its build log says
    `build-site: … (SITE_MODE=manual) … no API, no Turnstile, no cookies`.

## 3. Merge the pull request

GitHub › Side-Kick-V1 › **Pull requests** › "Site: an email-only beta mode, ready to host without accounts" ›
**Merge pull request** › **Confirm merge**.

What happens next:

- Vercel builds `main` for Production with `SITE_MODE=manual` (already set for Production) and, when the build
  succeeds, serves it at **sidekickapp.in** [V: "when you merge to or make commits to your production branch …
  Vercel will automatically promote the changes to Production", https://vercel.com/docs/deployments/promoting-a-deployment].
- If that build fails, the current production site keeps serving. This is **[A]**: Vercel only promotes a finished
  build, and last night's failed preview didn't touch production, but a failed *production* build was not tested.
- Check **Deployments**: the new Production row should be Ready. Then open sidekickapp.in and repeat checks 1–6.
- In manual mode the `/api/*` function still deploys and answers "misconfigured" (503) to anything; no page calls it.
  The daily cleanup job (`/api/cron/retention`) will get the same answer, which is harmless.

## 4. If something is wrong: roll back

- **Fastest: Vercel Instant Rollback.** Project **side** › Overview › Production Deployment tile › **Instant
  Rollback** › choose the previous deployment › **Continue** › **Confirm Rollback**. On Hobby you can go back only to
  the immediately previous deployment. After a rollback, new pushes to `main` don't go live until you click **Undo
  Rollback** on the same tile [V https://vercel.com/docs/instant-rollback].
- **Revert the pull request:** on the merged PR, click **Revert**, then merge the revert PR. Vercel builds the old
  site again.
- **Re-deploy:** Deployments › ⋯ next to a deployment › **Redeploy**.
- **Undo last night's Vercel change:** Settings › Environment Variables › `SITE_MODE` › ⋯ › Remove. A build with no
  `SITE_MODE` still builds the manual site, with a warning in the log.

## 5. Later: switch to automated

Follow `docs/OWNER-SETUP.md` in its order. **§1, prove the token in the Mac app, comes first**, then the accounts
(§3), the variables (§4), the tables (§5), the signer (§6–7). Set `SITE_MODE=automated` **for Preview only** first and
test there (§8). Only then set it for Production and redeploy. To go back, set `SITE_MODE=manual` and redeploy.

## 6. Making the repo private (optional)

GitHub › Side-Kick-V1 › **Settings** › General › Danger Zone › **Change repository visibility** › Private.

- **What it can't undo:** the repo has been public. Everything pushed (all commits, `docs/`, the Drive and Play
  links, and the commit author address `cpujari12@gmail.com` on every commit) may already have been copied, cloned or
  cached. Making it private stops new readers; it doesn't take back what's out.
- **Vercel on Hobby with a private repo:** Vercel's guide says that for a private repository the person pushing "has
  to be a member of the Pro team or the owner of the Hobby team"
  [V https://vercel.com/kb/guide/why-aren-t-commits-triggering-deployments-on-vercel, read 2026-10-15]. That is you,
  so deployments should keep working. Whether Vercel counts commits authored as `cpujari12@gmail.com` as you is
  **[U]**: after switching, push one small commit and check that a deployment starts.
- Hobby is for "non-commercial, personal use only" [V https://vercel.com/docs/plans/hobby].

## 7. What the privacy page still needs

- **A legal review** of Support › Privacy, both modes, and of `docs/external-privacy-page-draft.md`. Points to raise:
  manual mode keeps request emails "until you ask us to delete them"; deletion includes removing the Google account
  from the Play test list; there's no children's clause and no governing law.
- **After the review:** update `policyEffectiveDate` (the automated region of `data/site-config.js`; it says
  19 October 2026 since launch log Part 16, set by the owner while the review is still open) to the reviewed text's date.
- **Keep it true:** if you move to Vercel Pro, runtime logs are kept 1 day, not 1 hour [V
  https://vercel.com/docs/logs/runtime], so change that sentence. If you add analytics, a form or any third-party
  script, the manual privacy text and the build guard both need changing.
- **Your other site's policy page** (chetan-website-delta.vercel.app/sidekick/privacy) still has the sentences listed
  as wrong in the draft. Manual mode no longer links to it; automated mode still does.

## What changed in Vercel overnight

Exactly one thing: `SITE_MODE = manual`, type Config, for **Preview and Production**. When Vercel offered
"Redeploy", I dismissed it. No other setting, domain, variable or deployment was touched.
