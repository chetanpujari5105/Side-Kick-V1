// The one-click download flow (launch log Part 7): a token pool the signer fills, the instant "You're in" result,
// repeat sign-ups that never show a token again, the daily cap and the kill switch, the public /download/mac route,
// "Email me a copy", and Android by manual batch. Every secret and token here is made up for this run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ORIGIN, T0, cookieOf, poolToken } from './helpers.mjs';
import { loadConfig } from '../server/config.mjs';
import { releaseProblems, publicReleases } from '../server/releases.mjs';
import releasesJson from '../data/releases.json' with { type: 'json' };

const DAY = 86400000;
const CAP = 'XXXX.DUMMY.TOKEN.XXXX';
const DIRECT = 'https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/v2.0.1/Sidekick-2.0.1-arm64.dmg';
const DRIVE = releasesJson.mac.betaDriveUrl;

const fill = async (h, n = 3, madeAt, days = 45) => {
  const tokens = Array.from({ length: n }, () => poolToken(madeAt ?? h.clock.now(), days));
  const r = await h.admin('/api/admin/pool-add', { tokens }, { key: 'signer' });
  assert.equal(r.status, 200, await r.clone().text());
  return tokens;
};
const status = async (h) => (await (await h.admin('/api/admin/pool-status', {}, { key: 'signer' })).json());
const macOnly = (o = {}) => ({ name: 'Asha Rao', email: 'asha@example.com', privacyAccepted: true, marketingOptIn: false, captchaToken: CAP, ...o });
const signupJson = (h, body, opts = {}) => h.call('POST', '/api/get-sidekick', { json: body, headers: { origin: ORIGIN }, ...opts });
const withDirect = () => { const r = JSON.parse(JSON.stringify(releasesJson)); r.mac.directUrl = DIRECT; return r; };

// ── configuration ─────────────────────────────────────────────────────────────
test('config: SIGNUP_DAILY_CAP defaults to 60, ANDROID_ACCESS to manual-batch, SITE_MODE=manual is the kill switch', () => {
  const base = { APP_ORIGIN: ORIGIN, SESSION_SECRET: 'x'.repeat(32) };
  const c = loadConfig(base);
  assert.equal(c.signupDailyCap, 60);
  assert.equal(c.androidAccess, 'manual-batch');
  assert.equal(c.signupClosed, false, 'unset SITE_MODE keeps signups open, as today');
  assert.equal(loadConfig({ ...base, SIGNUP_DAILY_CAP: '0' }).signupDailyCap, 0);
  assert.equal(loadConfig({ ...base, SIGNUP_DAILY_CAP: '5' }).signupDailyCap, 5);
  assert.ok(loadConfig({ ...base, SIGNUP_DAILY_CAP: 'lots' }).problems.includes('SIGNUP_DAILY_CAP'));
  assert.equal(loadConfig({ ...base, ANDROID_ACCESS: 'google-group' }).androidAccess, 'google-group');
  assert.ok(loadConfig({ ...base, ANDROID_ACCESS: 'carrier-pigeon' }).problems.includes('ANDROID_ACCESS'));
  assert.equal(loadConfig({ ...base, SITE_MODE: 'manual' }).signupClosed, true);
  assert.equal(loadConfig({ ...base, SITE_MODE: 'automated' }).signupClosed, false);
});

test('releases: mac.directUrl is null or the GitHub Release asset for the same file; it never reaches the public copy', () => {
  assert.deepEqual(releaseProblems(withDirect()), []);
  for (const bad of ['https://evil.example/Sidekick-2.0.1-arm64.dmg', 'http://github.com/chetanpujari5105/Side-Kick-V1/releases/download/v2.0.1/Sidekick-2.0.1-arm64.dmg',
    'https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/v2.0.1/Other.dmg', DIRECT + '?x=1']) {
    const r = withDirect(); r.mac.directUrl = bad;
    assert.ok(releaseProblems(r).some(p => p.startsWith('mac.directUrl')), bad);
  }
  assert.equal(publicReleases(withDirect()).mac.directUrl, undefined);
  assert.equal(releasesJson.mac.directUrl, null, 'null until the asset is verified (launch log P7-1)');
});

// ── the pool ──────────────────────────────────────────────────────────────────
test('pool-add takes only well-formed tokens from the signer; pool-status counts; the admin key may read too', async () => {
  const h = setup();
  await fill(h, 3);
  assert.deepEqual(await status(h), { ok: true, ready: 3, stale: 0, issuedToday: 0, dailyCap: 60 });
  const bad = await h.admin('/api/admin/pool-add', { tokens: ['SIDEKICK-TRIAL-1.bm90LWpzb24.' + 'A'.repeat(86)] }, { key: 'signer' });
  assert.equal(bad.status, 400, 'a payload that is not the issuer\'s JSON is refused');
  const dup = await h.admin('/api/admin/pool-add', { tokens: [(await fill(h, 1))[0]] }, { key: 'signer' });
  assert.equal((await dup.json()).added, 0, 'a token already in the pool is not added twice');
  const many = await h.admin('/api/admin/pool-add', { tokens: Array.from({ length: 41 }, () => poolToken()) }, { key: 'signer' });
  assert.equal(many.status, 400, 'at most 40 tokens per request');
  assert.equal((await h.admin('/api/admin/pool-status', {})).status, 200);
});

test('signup with a ready token: "You\'re in" at once, the token shown once, no confirm email, pool down by one', async () => {
  const h = setup();
  const [oldest] = await fill(h, 3, T0 - 2 * DAY);
  await fill(h, 2);
  const res = await signupJson(h, macOnly());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const b = await res.json();
  assert.equal(b.stage, 'in');
  assert.equal(b.firstName, 'Asha');
  assert.equal(b.token, oldest, 'the oldest ready token is handed out first');
  assert.deepEqual(b.download, { url: '/download/mac', auto: false, file: 'Sidekick-2.0.1-arm64.dmg', bytes: 121668061, sha256: releasesJson.mac.builds.arm64.sha256 });
  assert.equal(b.android, null);
  assert.ok(cookieOf(res), 'a session for "Email me a copy"');
  assert.equal((await status(h)).ready, 4);
  const s = await h.repo.getSignupByEmail('asha@example.com');
  assert.equal(s.state, 'delivered');
  assert.equal(s.tokenSource, 'pool');
  assert.equal(h.repo.debugOutbox().length, 0, 'no email: the confirmation email is no longer a gate');
  assert.ok(!h.logs.join('\n').includes(oldest.slice(17, 60)), 'the token never reaches the logs');
});

test('the download starts by itself only when a verified direct URL exists', async () => {
  const h = setup({ releases: withDirect() });
  await fill(h, 1);
  const b = await (await signupJson(h, macOnly())).json();
  assert.equal(b.download.auto, true);
});

test('expiry: a token older than 10 days, or with under 35 days left, is never handed out; prune discards it', async () => {
  const h = setup();
  await fill(h, 2, T0 - 11 * DAY);
  await fill(h, 1, T0, 40); // a 40-day token made today has under 35 days left in 6 days
  h.clock.advance(6 * DAY);
  assert.deepEqual(await status(h), { ok: true, ready: 0, stale: 3, issuedToday: 0, dailyCap: 60 });
  const b = await (await signupJson(h, macOnly())).json();
  assert.equal(b.stage, 'check_email', 'falls back to the email flow');
  assert.equal(b.token, undefined);
  const p = await (await h.admin('/api/admin/pool-prune', {}, { key: 'signer' })).json();
  assert.equal(p.discarded, 3);
  assert.equal((await status(h)).stale, 0);
});

test('pool empty: the existing email flow, honestly, never an error', async () => {
  const h = setup();
  const res = await signupJson(h, macOnly());
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.stage, 'check_email');
  assert.equal(b.token, undefined);
  assert.equal(h.repo.debugOutbox()[0].kind, 'confirm');
});

test('a repeat sign-up NEVER shows the token again: "already signed up", and the copy goes to that address', async () => {
  const h = setup();
  const [t] = await fill(h, 2);
  await signupJson(h, macOnly());
  const res = await signupJson(h, macOnly({ name: 'Someone Else' }), { ip: '198.51.100.9' });
  const text = await res.clone().text();
  assert.ok(!text.includes('SIDEKICK-TRIAL-1'), 'no token in the answer');
  assert.equal(JSON.parse(text).stage, 'already');
  assert.equal((await status(h)).ready, 1, 'no second token used');
  const mails = h.repo.debugOutbox();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].kind, 'copy');
  assert.equal(mails[0].toEmail, 'asha@example.com');
  assert.ok(mails[0].text.includes(t) && mails[0].text.includes(ORIGIN + '/download/mac'));
  assert.ok(!/drive\.google\.com/.test(mails[0].text.split('If the download')[0]), 'Drive is only the fallback');
  // The no-JavaScript page says the same and shows no token either.
  const page = await h.call('POST', '/api/get-sidekick', { form: { ...macOnly(), privacyAccepted: 'on', 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN }, ip: '198.51.100.10' });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes('You already signed up') && !html.includes('SIDEKICK-TRIAL-1'));
});

test('daily cap: SIGNUP_DAILY_CAP reached → the email flow; 0 turns instant tokens off; a new UTC day starts again', async () => {
  const h = setup({ env: { SIGNUP_DAILY_CAP: '1' } });
  await fill(h, 3);
  assert.equal((await (await signupJson(h, macOnly())).json()).stage, 'in');
  assert.equal((await (await signupJson(h, macOnly({ email: 'b@example.com' }), { ip: '198.51.100.2' })).json()).stage, 'check_email');
  h.clock.advance(DAY);
  assert.equal((await (await signupJson(h, macOnly({ email: 'c@example.com' }), { ip: '198.51.100.3' })).json()).stage, 'in');
  const off = setup({ env: { SIGNUP_DAILY_CAP: '0' } });
  await fill(off, 1);
  assert.equal((await (await signupJson(off, macOnly())).json()).stage, 'check_email');
});

test('per-IP: at most 3 instant tokens per IP per hour (RATE_LIMIT_INSTANT_IP), then the email flow', async () => {
  const h = setup();
  // Email-flow sign-ups while the pool is empty do not use up this IP's instant allowance.
  for (let i = 0; i < 3; i++) await signupJson(h, macOnly({ email: `early${i}@example.com` }));
  await fill(h, 6);
  const stages = [];
  for (let i = 0; i < 4; i++) stages.push((await (await signupJson(h, macOnly({ email: `p${i}@example.com` }))).json()).stage);
  assert.deepEqual(stages, ['in', 'in', 'in', 'check_email']);
});

test('beta cap and the deny list still apply: those sign-ups take the email flow', async () => {
  const h = setup({ env: { BETA_CAP: '1' } });
  await fill(h, 3);
  assert.equal((await (await signupJson(h, macOnly())).json()).stage, 'in');
  assert.equal((await (await signupJson(h, macOnly({ email: 'b@example.com' }), { ip: '198.51.100.2' })).json()).stage, 'check_email');
  const d = setup();
  await fill(d, 1);
  await d.admin('/api/admin/settings', { deny: ['@blocked.example'] });
  assert.equal((await (await signupJson(d, macOnly({ email: 'x@blocked.example' }))).json()).stage, 'check_email');
});

test('kill switch: SITE_MODE=manual closes the signup API; nothing is stored', async () => {
  const h = setup({ env: { SITE_MODE: 'manual' } });
  await fill(h, 1);
  const j = await signupJson(h, macOnly());
  assert.equal(j.status, 503);
  assert.equal((await j.json()).error, 'SIGNUP_CLOSED');
  const f = await h.call('POST', '/api/get-sidekick', { form: { ...macOnly(), privacyAccepted: 'on', 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN } });
  assert.equal(f.status, 303);
  assert.equal(f.headers.get('location'), '/Get%20Sidekick.dc.html');
  assert.equal(h.repo.debugCount('signups'), 0);
  assert.equal((await status(h)).ready, 1);
});

test('no JavaScript: the form post answers with the result page itself — token, normal download link, three steps, details', async () => {
  const h = setup({ releases: withDirect() });
  const [t] = await fill(h, 1);
  const res = await h.call('POST', '/api/get-sidekick', { form: { name: 'Asha Rao', email: 'asha@example.com', privacyAccepted: 'on', android: 'on', phoneModel: 'Pixel 8', googleEmail: 'asha.rao@gmail.com', 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN } });
  assert.equal(res.status, 200);
  const html = (await res.text()).replace(/&#39;/g, "'");
  assert.ok(html.includes("You're in, Asha"));
  assert.ok(html.includes(t), 'the token, shown once');
  assert.match(html, /<meta http-equiv="refresh" content="2;url=\/download\/mac">/, 'the download starts by itself, without JavaScript');
  assert.match(html, /<a [^>]*href="\/download\/mac"[^>]*>Download again<\/a>/);
  assert.equal((html.match(/<li class="step">/g) || []).length, 3, 'three install steps');
  assert.ok(html.includes('<details>') && html.includes('More details') && html.includes(releasesJson.mac.builds.arm64.sha256));
  assert.ok(html.includes("Android: we're adding your Google account to the test list. Your Google Play link comes by email, usually within a day."));
  assert.match(html, /<form [^>]*action="\/api\/email-copy"/, '"Email me a copy" works without JavaScript');
  assert.match(res.headers.get('content-security-policy'), /script-src 'nonce-/);
  // Without a verified direct URL there is no automatic start: the Drive folder would replace the page holding the token.
  const g = setup();
  await fill(g, 1);
  const html2 = await (await g.call('POST', '/api/get-sidekick', { form: { name: 'Asha Rao', email: 'asha@example.com', privacyAccepted: 'on', 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN } })).text();
  assert.ok(!html2.includes('http-equiv="refresh"'));
  assert.match(html2, /href="\/download\/mac"[^>]*target="_blank"/);
});

test('Android is optional: Mac-only needs no Google account; ticked, it needs a Google account and a model name (not a number)', async () => {
  const h = setup();
  assert.equal((await signupJson(h, macOnly())).status, 200);
  const r1 = await (await signupJson(h, macOnly({ email: 'b@example.com', android: true, phoneModel: 'Pixel 8' }), { ip: '198.51.100.2' })).json();
  assert.ok(r1.fieldErrors.googleEmail);
  const r2 = await (await signupJson(h, macOnly({ email: 'b@example.com', android: true, phoneModel: '+91 98765 43210', googleEmail: 'b@gmail.com' }), { ip: '198.51.100.2' })).json();
  assert.ok(r2.fieldErrors.phoneModel);
  const s = await h.repo.getSignupByEmail('asha@example.com');
  assert.equal(s.googleEmail, null);
  assert.equal(s.phoneModel, null);
  // An older page sends the Google account without the box: that still means Android.
  await signupJson(h, macOnly({ email: 'old@example.com', macChip: 'apple', phoneModel: 'Pixel 8', googleEmail: 'old@gmail.com' }), { ip: '198.51.100.3' });
  assert.equal((await h.repo.getSignupByEmail('old@example.com')).googleEmail, 'old@gmail.com');
});

test('updates stay double opt-in: ticked in this submission → one confirm-updates email; unticked → no email at all', async () => {
  const h = setup();
  await fill(h, 2);
  await signupJson(h, macOnly({ marketingOptIn: true }));
  const m = h.repo.debugOutbox();
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, 'updates');
  assert.ok(h.linkFrom('asha@example.com'), 'its own updates link');
  assert.equal((await h.repo.getSignupByEmail('asha@example.com')).marketingConfirmedAt, null);
  await signupJson(h, macOnly({ email: 'b@example.com' }), { ip: '198.51.100.2' });
  assert.equal(h.repo.debugOutbox().length, 1);
});

test('"Email me a copy" queues ONE email, only for the browser that saw the result', async () => {
  const h = setup();
  const [t] = await fill(h, 1);
  const cookie = cookieOf(await signupJson(h, macOnly()));
  assert.equal((await h.call('POST', '/api/email-copy', { json: {}, headers: { origin: ORIGIN } })).status, 401);
  const r1 = await h.call('POST', '/api/email-copy', { json: {}, cookie, headers: { origin: ORIGIN } });
  assert.equal(r1.status, 202);
  const r2 = await h.call('POST', '/api/email-copy', { json: {}, cookie, headers: { origin: ORIGIN } });
  assert.equal((await r2.json()).stage, 'already_sent');
  const copies = h.repo.debugOutbox().filter(x => x.kind === 'copy');
  assert.equal(copies.length, 1);
  assert.ok(copies[0].text.includes(t));
  assert.equal((await h.call('POST', '/api/email-copy', { json: {}, cookie, headers: { origin: 'https://evil.example' } })).status, 403);
  const f = await h.call('POST', '/api/email-copy', { form: {}, cookie, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(f.status, 200, 'the no-JavaScript button gets a page');
});

// ── /download/mac ─────────────────────────────────────────────────────────────
test('GET /download/mac: 302 to the Drive folder while directUrl is null, counted with no personal data', async () => {
  const h = setup();
  const r = await h.call('GET', '/download/mac');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), DRIVE);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.deepEqual(await h.repo.downloadCounts(), [{ day: '2026-10-15', platform: 'mac', target: 'drive', count: 1 }]);
  assert.equal((await h.call('GET', '/api/index?__route=download-mac')).status, 302, 'the Vercel rewrite form');
  assert.equal((await h.call('POST', '/download/mac')).status, 405);
});

test('GET /download/mac: 302 to the verified GitHub asset; rate-limited per IP with a page that needs no JavaScript', async () => {
  const h = setup({ releases: withDirect(), env: { RATE_LIMIT_DOWNLOAD_IP: '2/3600' } });
  assert.equal((await h.call('GET', '/download/mac')).headers.get('location'), DIRECT);
  await h.call('GET', '/download/mac');
  const r = await h.call('GET', '/download/mac');
  assert.equal(r.status, 429);
  assert.ok(r.headers.get('retry-after'));
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.deepEqual((await h.repo.downloadCounts()).map(c => [c.target, c.count]), [['direct', 2]]);
  assert.equal((await h.call('GET', '/download/mac', { ip: '198.51.100.99' })).status, 302, 'another visitor is not affected');
});

test('a database failure never blocks the download: the hit is not counted, the redirect still happens', async () => {
  const h = setup();
  h.repo.failNext = 'countDownload';
  const r = await h.call('GET', '/download/mac');
  assert.equal(r.status, 302);
});

// ── Android: manual batch ─────────────────────────────────────────────────────
test('manual-batch: instant rows with a Google account are pending; marking them queues the Android invitation once', async () => {
  const h = setup();
  await fill(h, 2);
  const b = await (await signupJson(h, macOnly({ android: true, phoneModel: 'Pixel 8', googleEmail: 'Asha.Rao@gmail.com' }))).json();
  assert.equal(b.android, 'manual-batch');
  await signupJson(h, macOnly({ email: 'mac@example.com' }), { ip: '198.51.100.2' });
  const pp = await (await h.admin('/api/admin/play-pending', {})).json();
  assert.equal(pp.count, 1);
  assert.equal(pp.csv, 'asha.rao@gmail.com\n');
  assert.equal((await (await h.admin('/api/admin/queue', {}, { key: 'signer' })).json()).androidPending, 1);
  const m = await (await h.admin('/api/admin/play-mark-added', { googleEmails: ['asha.rao@gmail.com'] })).json();
  assert.equal(m.marked, 1);
  const inv = h.repo.debugOutbox().filter(x => x.kind === 'android');
  assert.equal(inv.length, 1);
  assert.equal(inv[0].toEmail, 'asha@example.com');
  assert.ok(inv[0].text.includes('play.google.com/apps/internaltest/') && inv[0].text.includes('asha.rao@gmail.com') && !inv[0].text.includes('SIDEKICK-TRIAL-1'));
  assert.equal((await (await h.admin('/api/admin/play-mark-added', { googleEmails: ['asha.rao@gmail.com'] })).json()).marked, 0, 'twice marks nothing');
  assert.equal(h.repo.debugOutbox().filter(x => x.kind === 'android').length, 1);
  assert.equal((await (await h.admin('/api/admin/play-pending', {})).json()).count, 0);
});

test('google-group: the signer may list and mark Android accounts only when ANDROID_ACCESS=google-group', async () => {
  const off = setup();
  assert.equal((await off.admin('/api/admin/android-pending', {}, { key: 'signer' })).status, 404);
  const h = setup({ env: { ANDROID_ACCESS: 'google-group' } });
  await fill(h, 1);
  const b = await (await signupJson(h, macOnly({ android: true, phoneModel: 'Pixel 8', googleEmail: 'asha.rao@gmail.com' }))).json();
  assert.equal(b.android, 'google-group');
  const p = await (await h.admin('/api/admin/android-pending', {}, { key: 'signer' })).json();
  assert.equal(p.pending.length, 1);
  assert.equal(p.pending[0].googleEmail, 'asha.rao@gmail.com');
  const r = await (await h.admin('/api/admin/android-added', { signupId: p.pending[0].signupId }, { key: 'signer' })).json();
  assert.equal(r.marked, 1);
  assert.equal(h.repo.debugOutbox().filter(x => x.kind === 'android').length, 1);
  assert.equal((await (await h.admin('/api/admin/android-pending', {}, { key: 'signer' })).json()).pending.length, 0);
});

test('delete-my-data removes the issued token\'s pool record with the row', async () => {
  const h = setup();
  await fill(h, 2);
  await signupJson(h, macOnly());
  assert.equal(h.repo.debugCount('pool'), 2);
  const d = await (await h.admin('/api/admin/delete', { email: 'asha@example.com' })).json();
  assert.equal(d.deleted, 1);
  assert.equal(h.repo.debugCount('pool'), 1, 'the issued token went with the row; the unissued one stays');
  assert.equal((await status(h)).ready, 1);
});

test('the queue (signer --status) reports the pool and the Android backlog; counts only', async () => {
  const h = setup();
  await fill(h, 2);
  const q = await (await h.admin('/api/admin/queue', {}, { key: 'signer' })).json();
  assert.equal(q.poolReady, 2);
  assert.equal(q.androidPending, 0);
  assert.ok(!JSON.stringify(q).includes('@'));
});

test('old-flow sign-ups without Android are not stuck behind the Play gate', async () => {
  const h = setup({ env: { PLAY_GATE: 'on' } });
  await signupJson(h, macOnly());
  await h.confirm('asha@example.com');
  const p = await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json();
  assert.equal(p.pending.length, 1, 'no Google account to add, so the signer may issue the token');
});

test('the invitation and access emails point at /download/mac, with Drive only as the fallback', async () => {
  const h = setup({ env: { STORAGE_PROVIDER: 'static' } });
  await signupJson(h, macOnly());
  await h.confirm('asha@example.com');
  const id = (await h.repo.getSignupByEmail('asha@example.com')).id;
  await h.admin('/api/admin/token', { signupId: id, token: poolToken() }, { key: 'signer' });
  const inv = h.repo.debugOutbox().find(m => m.kind === 'invite');
  assert.ok(inv.text.includes(ORIGIN + '/download/mac'));
  const drive = inv.text.indexOf('drive.google.com');
  assert.ok(drive === -1 || inv.text.slice(0, drive).includes("If the download doesn't start"), 'Drive is never the way to download');
  assert.ok(!inv.text.includes('Beta.dc.html'));
  const conf = h.repo.debugOutbox().find(m => m.kind === 'confirm');
  assert.ok(!/Drive/i.test(conf.text));
});

test('result pages after the old confirm link still work (recovery): Download page session sees the stage', async () => {
  const h = setup();
  await fill(h, 1);
  const res = await signupJson(h, macOnly());
  const s = await (await h.call('GET', '/api/session', { cookie: cookieOf(res) })).json();
  assert.deepEqual(s.session, { firstName: 'Asha', stage: 'token_shown' });
});
