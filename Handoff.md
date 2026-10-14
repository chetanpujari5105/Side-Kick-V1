# Sidekick website — developer handoff

Status: design + working front-end prototype. Pages are Design Components (`*.dc.html`) that open directly in a browser. Rebuild them as Astro or Next.js components using the tokens, structure and copy below. API calls go through `data/mock-api.js`, which is a **mock**.

---

## 1. Pages

| Page | File | Notes |
|---|---|---|
| Home | `Home.dc.html` | Hero 1a, feature tabs, how it works (violet), mosaic, Honest by design, What's next, FAQ, CTA |
| Get Sidekick (form) | `Get Sidekick.dc.html` | Every state is designed. The dashed "Design review" bar switches between them (remove it in prod). Tweaks: `mockOutcome`, `previewState` |
| Download | `Download.dc.html` | Shown only when a session exists, otherwise the expired-link state. Tweak: `previewState` (auto / valid / expired) |
| Roadmap | `Roadmap.dc.html` | Full roadmap, a notify-me form on every item, and Suggest a feature (`#suggest`) |
| Support hub | `Support.dc.html#setup` · `#help` · `#permissions` · `#privacy` · `#changelog` | One layout with five pages, switched by the URL hash |
| 404 / error | `404.dc.html` (404) · `404.dc.html#error` (500) | |
| Hero concepts (archive) | `Hero Concepts.dc.html` | The approved concept is 1a |

### Shared components
| Component | File | Props |
|---|---|---|
| SiteHeader | `SiteHeader.dc.html` | `active`: features / how / next / privacy / faq. Includes the skip link, a menu button below 960px, and Esc to close the menu |
| SiteFooter | `SiteFooter.dc.html` | none |
| RoadmapTrack | `RoadmapTrack.dc.html` | `limit` (items per phase, 0 = all), `showNotify`. Horizontal track at 880px+ container width, vertical below that |
| MacWindow | `MacWindow.dc.html` | `pane`: overview / mirror / notifications / messages / files / clipboard. Native size 1200×760; scale it with `transform` |
| PhoneScreen | `PhoneScreen.dc.html` | `screen`: devices / feed / consent / scan / install. Native size 390×820 |

Every app screen uses **fictional data**: Maya's Pixel, Studio MacBook, Sam Okafor, Lena Fischer, Priya Nair, the 555 number range, `.example` domains. There are no third-party logos. App tiles are neutral glyphs, matching the app's own handoff rules.

---

## 2. Tokens (CSS variables)

```css
:root{
  /* colour */
  --paper:#F6F3EC; --surface:#FFFFFF; --sunken:#EDE9DF;
  --ink:#17142E; --ink-2:#55526B; --hairline:rgba(23,20,46,.10);
  --violet:#5B3DF5; --violet-deep:#3A22B8; --lilac:#E8E2FF;
  --lime:#C6FF33;                 /* CTA fill + marker only; text on lime is --ink */
  --success:#1F9D6B; --warning:#E8A317; --error:#D9432F;
  --error-text:#B3341F;           /* #D9432F is 4.2:1 on white, so error TEXT uses this darker shade */
  --warning-bg:#FDF3DC; --error-bg:#FCEBE7;
  --on-violet:#FFFFFF; --on-violet-2:#ECE8FF; --on-ink-2:#C9C6DA;
  /* app UI (inside product shots only) */
  --app-bg:#0A0A0A; --app-chrome:#0F0F0F; --app-card:#161616; --app-control:#1A1A1A;
  --app-text:#F2F3F5; --app-text-2:#9A9CA8; --app-meta:#6B6E7A;
  /* type */
  --font-display:'Bricolage Grotesque',sans-serif;  /* 700/800, -0.03 to -0.045em, lh .96–1 */
  --font-body:Inter,sans-serif;                     /* 400/500/600, 17–19px, lh 1.55 */
  --font-mono:'JetBrains Mono',monospace;
  --fs-hero:clamp(46px,6.4vw,92px); --fs-h2:clamp(38px,4.8vw,68px); --fs-h3:30px; --fs-body:17px; --fs-lead:19px;
  /* shape */
  --r-panel:28px; --r-card:24px; --r-input:14px; --r-pill:999px;
  --btn-h:56px; --btn-h-header:46px; --btn-h-mobile:54px; --btn-border:1.5px solid var(--ink);
  --shadow-product:0 44px 70px -34px rgba(23,20,46,.55), 0 2px 6px rgba(23,20,46,.12);
  --blob-radius:46% 54% 40% 60% / 52% 44% 56% 48%;
  /* layout */
  --max:1440px; --gutter:clamp(20px,4.5vw,64px); --section-y:clamp(64px,8vw,120px);
  /* motion */
  --ease:cubic-bezier(.22,1,.36,1); --rise:850ms; --draw:900ms; --pulse:2400ms; --fade:200ms; --lift:150ms;
}
@media (prefers-reduced-motion:reduce){ /* turn off rise, draw, pulse, lift and crossfade */ }
```

**Primary button:** lime fill, 1.5px ink border, pill shape. On hover it moves `translateY(-2px)` and gains `box-shadow:0 3px 0 var(--ink)` over 150ms.
**Secondary action:** violet text with a 1.5px underline at 6px offset. Hover colour is `--violet-deep`.
**Marker:** an absolute span behind one word: 0.3em tall, `bottom:.06em`, `rotate(-1.5deg)`, lime.
**Focus:** `outline:2px solid var(--violet); outline-offset:2px` everywhere. Inputs use a violet border plus a 4px lilac ring.

### Contrast (WCAG 2.2 AA; checked, not certified)
- Ink-2 on paper: 6.8:1. On sunken: 6.2:1. On lilac: 6.0:1.
- Violet on paper (links): 5.5:1.
- White on violet: 6.1:1. #ECE8FF on violet: 5.1:1.
- Error text #B3341F on white: 6.1:1.
- Lime is never used as text on light backgrounds. Lime buttons get an ink border so the button edge passes the 3:1 non-text rule.

---

## 3. Component inventory
Header (desktop nav / mobile menu) · Skip link · Footer with link motif · Primary button · Text link · Marker heading · Lilac blob + violet circle · Link line (draw + pulsing lime dot) · Product composition (Mac + phone) · Feature tabs (ARIA tablist with arrow keys, Home and End) · Connection diagram (draws in on scroll, the only scroll-linked effect) · Step cards · Security fact chips · Bento tiles (white / violet / lime ×1 / lilac) · Limits list · Roadmap track with filter chips, expandable items, status chips and notify form · FAQ accordion (button + region) · CTA band · Form field (label, hint, error with `aria-describedby`) · Segmented radio · Checkbox · Error summary (focus moves to it) · Alert banners (server error / rate limit) · Spinner · Download panel · Copyable hash · Token panel · Gatekeeper dialog illustration · Support sidebar nav · Q&A rows.

Status chips: **Next up** lime with ink border · **In design** violet with white text · **Exploring** lilac · **Later** ink outline. No dates and no estimates.

---

## 4. Copy deck (key strings; full copy lives in each file)
- **Hero:** "Your Android phone, on your **Mac**." / "Mirror your screen, answer notifications, move files and share your clipboard — over your own Wi-Fi. No cloud. No account." / CTA "Get Sidekick" / "See how it works" / "For Macs with Apple silicon on macOS 11.0 (Big Sur) or later, and Android 10 or later. Both apps required."
- **Tabs** (H2 "Do more without picking up your phone."): Mirror & control · Notifications & replies · Messages · Files & photos · Clipboard.
- **How it works:** "Two apps. One local connection." Steps: Install both apps → Scan the QR code once → Use it. Chips: TLS 1.3 · Certificate pinning · No cloud relay · No account.
- **Mosaic:** "The small stuff, handled." Reply from your Mac · Clipboard, both ways · See who's calling · Photos, saved to your Mac · A remote for what's playing · Ask the phone to open an app.
- **Honest by design:** seven limits (mirroring consent, secure screens, call audio, clipboard, files, network, battery).
- **Roadmap:** heading, subline and footnote are verbatim from the brief and live in `data/roadmap-data.js`.
- **Form errors:** "Enter your name." · "Enter an email address like name@example.com." · "Choose your Mac's chip, or Not sure." · "Confirm you've read the Privacy Policy to continue." · Server: "We couldn't save your details. Nothing was sent…" · 429: "Too many tries in a short time…"
- **Download:** "You're in, {first name}." · "For Macs with Apple silicon (M1 or later)." · Token panel · Install & connect (3 steps) · "Something not working?"

---

## 5. Assets
- `LOGOS/head_logo.png` (mask, transparent). **Optimised 2026-10-15:** 144×77, 18 KB (was 512×275, 165 KB; the 895 KB original is the unused `LOGOS/head_logo1.png`, kept out of the deployment). 144 px is 3× its largest use (48 CSS px). An SVG would still be better.
- `LOGOS/main_logo.png` (app tile, used in the Gatekeeper illustration at 44 px). **Optimised 2026-10-15:** 132×132, 21 KB (was 1254×1254, 1.1 MB). The full-size originals are in git history and the app repo.
- `fonts/` holds self-hosted, subset woff2 files (latin + latin-ext) for Bricolage Grotesque, Inter, JetBrains Mono and a Material Symbols Rounded subset of about 70 icons. `fonts/fonts.css` uses `font-display: swap` (the icon font uses `block`). Licences: OFL / Apache 2.0, so ship the licence files.
- **Placeholders added 2026-10-15** (replace with designed assets when ready): `favicon.ico` (16/32/48) and `icons/favicon-32.png` — the mask on the app tile's cream; `icons/apple-touch-icon.png` (180×180, opaque); `icons/og-image.png` (1200×630, rendered from the site's own fonts and colours). Every page links the icons in its static `<head>`; Home, Get Sidekick, Roadmap and Support also carry Open Graph and Twitter card tags. **`og:image` is relative until the domain is set** — most link previews need it absolute (`https://<domain>/icons/og-image.png`).
- App screens are built in HTML, not screenshots. If you swap in real captures, they must contain only fictional data.

---

## 6. Data files
- `data/site-config.js`: flags `releaseState`, `tokenRequired`, `notarized`, `mocksEnabled`, plus the placeholders for domain, support email and publisher. `SK_RELEASES` has the 2.0.1 facts for the single Apple silicon build (`Sidekick-2.0.1-arm64.dmg`); its size and SHA-256 stay `null` until the staged DMG exists. It should be replaced by `GET /api/releases`.
- `data/roadmap-data.js`: the only roadmap source, with fields `{id, phase, category, title, benefit, note?}`. Phase status and label come from `phases[]`.
- `data/mock-api.js`: **MOCK.** Set `sessionStorage.sk_mock_outcome` to `success | server_error | rate_limited | invalid`.

---

## 7. Endpoints

```
POST /api/get-sidekick
  body {name:string(1..120), email:string(email), macChip:'apple'|'unsure',
        phoneModel:string(1..120), privacyAccepted:true, marketingOptIn:boolean, captchaToken:string}
  200 {ok:true}  + Set-Cookie sk_session (HttpOnly, Secure, SameSite=Lax, signed, ~24h)
  400 {ok:false, fieldErrors:{[field]:message}}
  429 {ok:false, error:'RATE_LIMITED', retryAfter:seconds}
  5xx {ok:false, error}
  Rules: verify captcha → rate limit per IP + email → write row → THEN 200. Never 200 before the write commits.
  marketingOptIn=true sends a double-opt-in email; it is not stored as consented until confirmed.

GET /api/download/:platform(/:arch)   platform=mac|android, arch=arm64
  requires sk_session; 302 → signed R2/S3 URL (TTL ~10 min); logs {signupId, platform, arch, ts}
  401 → client shows the expired-link state

GET /api/releases
  {version, mac:{minOS, notarized, builds:{arm64:{file,bytes,sha256}}},
   android:{minOS, build:{file,bytes,sha256,signed}, storeUrl|null}, changelog:[{version,date,items[]}]}

POST /api/roadmap-notify {email, featureId}   → 202; sends a confirm email; one notification per feature
POST /api/feedback {message(3..2000), email?} → 202
Admin (auth required, never public): GET /admin/signups(.csv), PATCH /admin/signups/:id {tokenSentAt}
```

**Token process (phase 1).** The owner issues each token on their own Mac from the signup list. The signing key never touches the server. The Download page says the token arrives by email. Hook: `issueToken(signup)` is a no-op stub for automating this later. Setting `tokenRequired:false` hides the token panel, the FAQ entry and token mentions in the copy.

### Environment variables
`DATABASE_URL`, `SESSION_SECRET`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `DOWNLOAD_URL_TTL`, `EMAIL_PROVIDER_KEY`, `EMAIL_FROM`, `ADMIN_AUTH_*`, `ANALYTICS_SITE_ID`, `RATE_LIMIT_*`, flags `RELEASE_STATE`, `TOKEN_REQUIRED`, `NOTARIZED`, `MOCKS_ENABLED`.

---

## 8. Build notes
- The prototype switches responsive layouts in JS (inline styles only). In production, use CSS media and container queries and render on the server so content reads **without JS**. FAQ answers and roadmap items should be server-rendered `<details>` or open by default.
  - **Interim (2026-10-15):** Home's FAQ and the Roadmap page carry a generated `<noscript>` copy (FAQ as `<details>`, roadmap as lists by phase), and a `<noscript>` style hides their `data-js-only` templates. Run `node tools/noscript.mjs` after editing the FAQ array, `data/roadmap-data.js` or `data/site-config.js`; `--check` exits 1 if a copy is stale. Everything else still needs JS: header and footer (`dc-import`), Home's feature tabs, steps, security chips, app tiles and limits list, all of Support, the forms, the Download page's valid state and 404's text.
- Test at 360 / 390 / 768 / 1024 / 1440 and at 200% zoom. There is no horizontal overflow. The tab list scrolls sideways on its own row.
- Motion: hero rise and line draw play once. The pulse runs only on the lime dot. Tabs crossfade over 200ms. The diagram draws when it scrolls into view. Everything is off under `prefers-reduced-motion`.
- Never put the real file URLs in page source.

---

## 9. Launch blockers / open questions
1. **Domain** — placeholder `[sidekick-domain.example]`.
2. **Support email** — placeholder.
3. **Privacy policy publisher details** — legal name, postal address, effective date, how changes are announced, data retention period, analytics provider, email provider. Needs a legal review.
4. **Signing / notarization** — the Mac 2.0.0 build is ad-hoc signed and not notarized, so the site shows the Gatekeeper steps. The **APK is unsigned and cannot be installed**, and its size and SHA-256 are placeholders until the signed build exists.
5. **Intel** — decided 2026-10-15: Apple silicon only. No x64 build is offered and the form has no Intel option.
6. **Token process** — how tokens are delivered (pasted string or file?), how long it takes, whether one token works on more than one Mac, and its expiry. The repo mentions a 45-day trial; the site doesn't mention it until you confirm.
7. **Real download files** uploaded to R2/S3, plus `SHA256SUMS.txt`.
8. Pricing — nothing on the site mentions it.

## 10. Couldn't verify / deliberate deviations
- **Call audio:** the brief says "use Bluetooth", but `docs/permissions.md` and the Figma handoff **retract** that remedy (measured 2026-09-14, the voice link never opened). The site says "Call audio stays on the phone" and offers no Bluetooth remedy. Confirm before changing this.
- The macOS dialog text in the step 1 illustration copies the current Gatekeeper wording. Check it against the macOS version testers use.
- "Settings › About" as the place to re-enter the token comes from the brief, not the repo.
- The "Photos and videos" and "Accessibility service" permission labels are inferred from the README and handoff. Check them against the Android manifest.
- The OEM battery paths (Samsung, Xiaomi) come from the README, not from on-device checks across brands.
- Android app labels used ("Connect your Mac", "Allow from this source", "Start now") match the repo checklist and stock Android, but may differ by OEM skin.

## 11. Follow-ups
- ~~**Self-host React to remove unpkg.**~~ **Done 2026-10-15.** `support.js` now loads `vendor/react-18.3.1/react.production.min.js` and `react-dom.production.min.js` from this site (byte-identical to unpkg's, still checked against the same SRI hashes; React's MIT licence is in `vendor/react-18.3.1/LICENSE`). Its Babel loader is disabled — no page uses a JSX x-import — so no page contacts a third-party origin. `support.js` is generated: re-apply the patch (marked at the top of the file) if it is regenerated. Support › Privacy no longer mentions unpkg.
