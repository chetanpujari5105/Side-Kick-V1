# Sidekick website — front-end package

Open `Home.dc.html` through any static server (e.g. `npx serve .`) — not via file://.

## Connecting your backend
1. In `data/site-config.js` set `mocksEnabled: false`.
2. `data/mock-api.js` then calls the real endpoints instead of the mocks:
   - `POST /api/get-sidekick` (form page)
   - `GET  /api/download/:platform/:arch` (download buttons — return a 302 to a signed URL, or JSON `{url}`)
   - `POST /api/roadmap-notify` (roadmap “Notify me”)
   - `POST /api/feedback` (Suggest a feature)
3. Replace `window.SK_RELEASES` in `data/site-config.js` with the response of `GET /api/releases`.
4. The Download page checks the session via `SK_API.session()` — swap it for a call that checks your signed HttpOnly cookie.

Request/response schemas, env vars, tokens and launch blockers: see `Handoff.md`.

## No-JavaScript copies
Home's FAQ and the Roadmap page include generated `<noscript>` copies. After editing the FAQ, `data/roadmap-data.js` or `data/site-config.js`, run `node tools/noscript.mjs` (and `node tools/noscript.mjs --check` before deploying).

## Files
- `*.dc.html` — pages and shared components (need `support.js` next to them)
- `data/` — config flags, release facts, roadmap data, API layer
- `fonts/` — self-hosted fonts
- `LOGOS/` — brand marks
