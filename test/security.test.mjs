import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, ORIGIN, fakeToken, throwaway } from './helpers.mjs';

const CAP = 'XXXX.DUMMY.TOKEN.XXXX';

test('admin HMAC: good signature works; bad signature, wrong secret, tampered body refused', async () => {
  const h = setup();
  assert.equal((await h.admin('/api/admin/stats')).status, 200);
  assert.equal((await h.admin('/api/admin/stats', {}, { secret: throwaway() })).status, 401);
  assert.equal((await h.admin('/api/admin/stats', { a: 1 }, { tamper: true })).status, 401);
  assert.equal((await h.call('POST', '/api/admin/stats', { json: {} })).status, 401, 'unsigned');
  assert.equal((await h.call('GET', '/api/admin/stats')).status, 405);
});

test('admin HMAC: old or future timestamps and replayed nonces are refused', async () => {
  const h = setup();
  assert.equal((await h.admin('/api/admin/stats', {}, { ts: h.clock.now() - 301000 })).status, 401);
  assert.equal((await h.admin('/api/admin/stats', {}, { ts: h.clock.now() + 301000 })).status, 401);
  const nonce = 'ab'.repeat(16);
  assert.equal((await h.admin('/api/admin/stats', {}, { nonce })).status, 200);
  assert.equal((await h.admin('/api/admin/stats', {}, { nonce })).status, 401, 'replay');
});

test('signer key can only reach the signer endpoints', async () => {
  const h = setup();
  for (const p of ['/api/admin/stats', '/api/admin/export', '/api/admin/delete', '/api/admin/set-state', '/api/admin/settings'])
    assert.equal((await h.admin(p, {}, { key: 'signer' })).status, 403, p);
  assert.equal((await h.admin('/api/admin/pending', {}, { key: 'signer' })).status, 200);
});

test('admin: CSV export, counts, delete cascades', async () => {
  const h = setup();
  await h.signup({ name: '=HYPERLINK("x")', email: 'csv@example.com' });
  await h.confirm('csv@example.com');
  await h.call('GET', '/api/download/mac/arm64', { cookie: (await h.confirm('csv@example.com')).cookie });
  const stats = await (await h.admin('/api/admin/stats')).json();
  assert.equal(stats.signups.approved, 1);
  const csv = await (await h.admin('/api/admin/export')).json();
  assert.match(csv.csv, /^id,created_at,state,name,email,mac_chip,phone_model/);
  assert.ok(csv.csv.includes("'=HYPERLINK"), 'formula injection neutralised in CSV');
  assert.ok(!csv.csv.includes('SIDEKICK-TRIAL'), 'no tokens in exports');
  const del = await h.admin('/api/admin/delete', { email: 'csv@example.com' });
  const dj = await del.json();
  assert.deepEqual([dj.ok, dj.deleted, dj.notify, dj.feedback], [true, 1, 0, 0]);
  assert.match(dj.signupId, /^[0-9a-f-]{36}$/);
  assert.equal(h.repo.debugCount('signups'), 0);
  assert.equal(h.repo.debugCount('downloads'), 0);
  assert.equal(h.repo.debugOutbox().length, 0);
  assert.equal(h.repo.debugCount('links'), 0);
  assert.equal((await h.admin('/api/admin/set-state', { email: 'csv@example.com', state: 'approved' })).status, 404);
  assert.equal((await h.admin('/api/admin/set-state', { email: 'x@example.com', state: 'root' })).status, 400);
});

test('security headers on every kind of response', async () => {
  const h = setup();
  const responses = [
    await h.call('GET', '/api/health'),
    await h.call('GET', '/api/releases'),
    await h.signup(),
    await h.call('GET', '/api/confirm-email'),
    await h.call('GET', '/api/download/mac/arm64', { headers: { accept: 'text/html' } }),
    await h.call('GET', '/api/nothing-here'),
    await h.admin('/api/admin/stats')
  ];
  for (const r of responses) {
    assert.equal(r.headers.get('cache-control'), 'no-store', r.url);
    assert.match(r.headers.get('strict-transport-security'), /max-age=63072000/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(r.headers.get('content-security-policy')), 'strict CSP on API responses');
  }
});

test('health and releases: no data; nulls stay null; Apple silicon only', async () => {
  const h = setup();
  assert.deepEqual(await (await h.call('GET', '/api/health')).json(), { ok: true });
  const r = await (await h.call('GET', '/api/releases')).json();
  assert.equal(r.mac.builds.arm64.sha256, null);
  assert.equal(r.mac.builds.arm64.bytes, null);
  assert.deepEqual(Object.keys(r.mac.builds), ['arm64']);
  assert.ok(!JSON.stringify(r).includes('x64'));
  assert.equal(r._comment, undefined);
  assert.equal(r.android.storeUrl, null);
});

test('misconfiguration fails closed and names variables only', async () => {
  const h = setup({ env: { SESSION_SECRET: 'short' } });
  const r = await h.call('GET', '/api/health');
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, error: 'MISCONFIGURED' });
  assert.equal((await h.signup()).status, 503);
});

test('open redirect: no endpoint redirects to anything taken from the request', async () => {
  const h = setup();
  const probes = [
    ['GET', '/api/download/mac/arm64?next=https://evil.example', { headers: { accept: 'text/html' } }],
    ['GET', '/api/download/mac/arm64?url=//evil.example', { headers: { accept: 'text/html' } }],
    ['POST', '/api/access?next=https://evil.example', { form: { t: 'x', next: 'https://evil.example', 'cf-turnstile-response': CAP }, headers: { accept: 'text/html', origin: ORIGIN } }],
    ['POST', '/api/get-sidekick?redirect=https://evil.example', { form: { name: 'A', email: 'a@example.com', macChip: 'apple', phoneModel: 'P', privacyAccepted: 'on', 'cf-turnstile-response': CAP, redirect: 'https://evil.example' }, headers: { accept: 'text/html', origin: ORIGIN, host: 'evil.example' } }]
  ];
  for (const [m, p, o] of probes) {
    const r = await h.call(m, p, o);
    const loc = r.headers.get('location');
    if (loc) assert.ok(loc.startsWith('/') && !loc.startsWith('//'), `${p} → ${loc}`);
  }
});

test('header injection: CR/LF and display-name tricks in email or name never reach a message header', async () => {
  const h = setup();
  for (const email of ['a@example.com\r\nBcc: victim@example.org', 'a@example.com\nBcc:x@example.org', '"Evil" <a@example.com>', 'a@example.com, b@example.com', 'a@exa mple.com'])
    assert.equal((await h.signup({ email }, { ip: '192.0.2.' + email.length })).status, 400, JSON.stringify(email));
  assert.equal((await h.signup({ name: 'Alex\r\nBcc: x@example.org' })).status, 400);
  assert.equal(h.repo.debugOutbox().length, 0);
  // Links in emails come from APP_ORIGIN even if the Host header lies.
  await h.call('POST', '/api/get-sidekick', { json: h.signupBody({ email: 'host@example.com' }), headers: { origin: ORIGIN, host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
  const msg = h.repo.debugOutbox().find(m => m.toEmail === 'host@example.com');
  assert.ok(msg.text.includes(ORIGIN + '/api/confirm-email#t='));
  assert.ok(!msg.text.includes('evil.example'));
  assert.ok(!/[\r\n]/.test(msg.subject));
});

test('roadmap notify and feedback: 202, Turnstile, no enumeration, one notification per feature', async () => {
  const h = setup();
  const n = (o = {}) => h.call('POST', '/api/roadmap-notify', { json: { email: 'n@example.com', featureId: (h.app.roadmapIds || [])[0], captchaToken: CAP, ...o }, headers: { origin: ORIGIN } });
  const ids = (await import('../server/roadmap-ids.json', { with: { type: 'json' } })).default.ids;
  const first = await h.call('POST', '/api/roadmap-notify', { json: { email: 'n@example.com', featureId: ids[0], captchaToken: CAP }, headers: { origin: ORIGIN } });
  const second = await h.call('POST', '/api/roadmap-notify', { json: { email: 'n@example.com', featureId: ids[0], captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(first.status, 202); assert.equal(second.status, 202);
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(h.repo.debugCount('notify'), 1);
  assert.equal((await h.call('POST', '/api/roadmap-notify', { json: { email: 'n@example.com', featureId: 'not-a-feature', captchaToken: CAP }, headers: { origin: ORIGIN } })).status, 400);
  h.botCheck.mode = 'fail';
  assert.equal((await h.call('POST', '/api/roadmap-notify', { json: { email: 'm@example.com', featureId: ids[0], captchaToken: CAP }, headers: { origin: ORIGIN } })).status, 403);
  assert.equal((await h.call('POST', '/api/feedback', { json: { message: 'Please add dark mode', captchaToken: CAP }, headers: { origin: ORIGIN } })).status, 403);
  h.botCheck.mode = 'pass';
  assert.equal((await h.call('POST', '/api/feedback', { json: { message: 'Please add dark mode', captchaToken: CAP }, headers: { origin: ORIGIN } })).status, 202);
  assert.equal((await h.call('POST', '/api/feedback', { json: { message: 'x', captchaToken: CAP }, headers: { origin: ORIGIN } })).status, 400);
  assert.equal(h.repo.debugCount('feedback'), 1);
  // The notify confirmation link confirms the subscription.
  const t = h.linkFrom('n@example.com');
  const c = await h.call('POST', '/api/confirm-email', { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(c.status, 200);
  assert.deepEqual(await c.json(), { ok: true, stage: 'subscribed' });
  assert.equal(c.headers.get('set-cookie'), null, 'a notify confirmation is not a login');
  void n;
});

test('cron retention: needs CRON_SECRET; deletes stale unconfirmed rows; clears old tokens', async () => {
  const h = setup();
  await h.signup({ email: 'stale@example.com' });
  await h.signup({ email: 'kept@example.com' }, { ip: '192.0.2.200' });
  await h.confirm('kept@example.com');
  const id = (await h.repo.getSignupByEmail('kept@example.com')).id;
  await h.admin('/api/admin/pending', {}, { key: 'signer' });
  await h.admin('/api/admin/token', { signupId: id, token: fakeToken() }, { key: 'signer' });
  assert.equal((await h.call('GET', '/api/cron/retention')).status, 401);
  assert.equal((await h.call('GET', '/api/cron/retention', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  h.clock.advance(47 * 24 * 3600 * 1000);
  const r = await h.call('GET', '/api/cron/retention', { headers: { authorization: 'Bearer ' + h.env.CRON_SECRET } });
  assert.equal(r.status, 200);
  assert.equal(await h.repo.getSignupByEmail('stale@example.com'), null);
  const kept = await h.repo.getSignupByEmail('kept@example.com');
  assert.ok(kept);
  assert.equal(kept.token, null, 'token text cleared after 46 days');
});

test('no secret, token, email or IP in any log line or public response', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true }, { ip: '203.0.113.77' });
  await h.signup({ email: 'bad' });
  const { cookie } = await h.confirm();
  const id = (await h.repo.getSignupByEmail('alex@example.com')).id;
  await h.admin('/api/admin/pending', {}, { key: 'signer' });
  const token = fakeToken();
  await h.admin('/api/admin/token', { signupId: id, token }, { key: 'signer' });
  h.storage.failNext = true;
  await h.call('GET', '/api/download/mac/arm64', { cookie });
  await h.call('GET', '/api/download/mac/arm64', { cookie });
  h.repo.failNext = 'upsertSignup';
  await h.signup({ email: 'boom@example.com' });
  await h.admin('/api/admin/stats', {}, { secret: throwaway() });
  assert.ok(h.logs.length > 5, 'events were logged');
  const secrets = [h.env.SESSION_SECRET, h.env.ADMIN_AUTH_SECRET, h.env.ADMIN_AUTH_SIGNER_SECRET, h.env.CRON_SECRET, token];
  const forbidden = [...secrets, 'alex@example.com', 'boom@example.com', '203.0.113.77', '203.0.113.7', 'SIDEKICK-TRIAL-1'];
  for (const line of h.logs) for (const f of forbidden) assert.ok(!line.includes(f), `log leaks ${f.slice(0, 12)}…: ${line}`);
  // Public responses (everything except the signer's own outbox pull) carry no secret or token.
  const pub = h.bodies.filter(b => !b.includes('"messages"'));
  for (const b of pub) for (const s of secrets) assert.ok(!b.includes(s), 'response leaks a secret');
});

test('server-rendered pages never use no-referrer (Chrome would then send Origin: null on their own form posts)', async () => {
  const h = setup();
  await h.signup();
  const page = await h.call('GET', '/api/confirm-email');
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin');
  const nul = await h.call('POST', '/api/confirm-email', { form: { t: h.linkFrom('alex@example.com'), 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' }, headers: { origin: 'null', accept: 'text/html' } });
  assert.equal(nul.status, 403, 'an opaque origin is still refused');
});
