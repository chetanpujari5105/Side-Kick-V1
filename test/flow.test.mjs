import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, ORIGIN, fakeToken } from './helpers.mjs';
import { sealSession } from '../server/session.mjs';
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const CAP = 'XXXX.DUMMY.TOKEN.XXXX';

test('confirm link: GET is a page that changes nothing; POST confirms once; reuse and expiry fail', async () => {
  const h = setup();
  await h.signup();
  const t = h.linkFrom('alex@example.com');
  assert.ok(h.repo.debugOutbox().at(-1).text.includes(ORIGIN + '/api/confirm-email#t=' + t), 'the token rides in the fragment');
  const page = await h.call('GET', '/api/confirm-email');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /nonce-/);
  assert.equal((await h.repo.getSignupByEmail('alex@example.com')).state, 'pending_email', 'GET changed nothing');
  const ok = await h.call('POST', '/api/confirm-email', { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, stage: 'approved' });
  assert.ok(cookieOf(ok), 'an email-level session is set');
  const again = await h.call('POST', '/api/confirm-email', { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(again.status, 410, 'single use');

  const h2 = setup();
  await h2.signup();
  const t2 = h2.linkFrom('alex@example.com');
  h2.clock.advance(48 * 3600 * 1000 + 1);
  const late = await h2.call('POST', '/api/confirm-email', { json: { t: t2, captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(late.status, 410, 'expired');
  const bogus = await h2.call('POST', '/api/confirm-email', { json: { t: 'A'.repeat(43), captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(bogus.status, 410);
});

test('confirm needs Turnstile too (fails closed)', async () => {
  const h = setup();
  await h.signup();
  h.botCheck.mode = 'timeout';
  const r = await h.call('POST', '/api/confirm-email', { json: { t: h.linkFrom('alex@example.com'), captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(r.status, 403);
  assert.equal((await h.repo.getSignupByEmail('alex@example.com')).state, 'pending_email');
});

test('approval: cap, waitlist, allow and deny lists, promotion when room opens', async () => {
  const h = setup({ env: { BETA_CAP: '2' } });
  await h.admin('/api/admin/settings', { allow: ['@friends.example'], deny: ['spam@example.com'] });
  const people = ['p1@example.com', 'p2@example.com', 'p3@example.com', 'vip@friends.example', 'spam@example.com'];
  const stages = [];
  for (const [i, email] of people.entries()) {
    await h.signup({ email }, { ip: '192.0.2.' + i });
    const { res } = await h.confirm(email);
    stages.push((await res.json()).stage);
  }
  assert.deepEqual(stages, ['approved', 'approved', 'waitlisted', 'approved', 'waitlisted'], 'deny looks like waitlist to the visitor');
  assert.equal((await h.repo.getSignupByEmail('spam@example.com')).state, 'denied');
  assert.ok(h.linkFrom('p3@example.com', '/api/access') === null, 'waitlisted people get no access link');
  // Raise the cap: the oldest waitlisted person (p3) is promoted, never the denied one.
  await h.admin('/api/admin/settings', { betaCap: 4 });
  const pr = await h.admin('/api/admin/promote');
  assert.equal((await pr.json()).promoted, 1);
  assert.equal((await h.repo.getSignupByEmail('p3@example.com')).state, 'approved');
  assert.equal((await h.repo.getSignupByEmail('spam@example.com')).state, 'denied');
});

test('marketing is consent only after its own emailed link is used (double opt-in)', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  let row = await h.repo.getSignupByEmail('alex@example.com');
  assert.ok(row.marketingRequestedAt);
  assert.equal(row.marketingConfirmedAt, null);
  await h.confirm();
  row = await h.repo.getSignupByEmail('alex@example.com');
  assert.equal(row.marketingConfirmedAt, null, 'confirming the address is not consent to updates');
  const t = h.repo.debugOutbox().map(m => m.text).join('\n').match(/confirm-email\?for=updates#t=([A-Za-z0-9_-]+)/);
  assert.ok(t, 'a separate updates link was sent');
  const r = await h.call('POST', '/api/confirm-email', { json: { t: t[1], captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(r.status, 200);
  assert.ok((await h.repo.getSignupByEmail('alex@example.com')).marketingConfirmedAt);
});

test('session: form session cannot download; tampered, expired and foreign cookies are refused', async () => {
  const h = setup();
  const res = await h.signup();
  const form = cookieOf(res);
  const s = await h.call('GET', '/api/session', { cookie: form });
  assert.deepEqual(await s.json(), { ok: true, session: { firstName: 'Alex', stage: 'check_email' } });
  assert.equal((await h.call('GET', '/api/download/mac/arm64', { cookie: form })).status, 401);
  // Even a correctly signed form-level session that names a signup id never downloads.
  const sid = (await h.repo.getSignupByEmail('alex@example.com')).id;
  await h.admin('/api/admin/set-state', { signupId: sid, state: 'approved' });
  const formWithSid = 'sk_session=' + sealSession({ v: 1, k: 'form', sid, iat: 0, exp: 9e9 }, h.env.SESSION_SECRET);
  assert.equal((await h.call('GET', '/api/download/mac/arm64', { cookie: formWithSid })).status, 401);
  await h.admin('/api/admin/set-state', { signupId: sid, state: 'pending_email' });

  const { cookie } = await h.confirm();
  const [name, val] = cookie.split('=');
  const flipped = val.slice(0, -2) + (val.at(-2) === 'A' ? 'B' : 'A') + val.at(-1);
  assert.equal((await h.call('GET', '/api/session', { cookie: `${name}=${flipped}` })).status, 401);
  const forged = sealSession({ v: 1, k: 'email', sid: 'x', iat: 0, exp: 9e9 }, 'another-secret-another-secret-12345');
  assert.equal((await h.call('GET', '/api/session', { cookie: `sk_session=${forged}` })).status, 401);
  const payloadSwap = val.split('.')[0].slice(0, -1) + 'x' + '.' + val.split('.')[1];
  assert.equal((await h.call('GET', '/api/session', { cookie: `sk_session=${payloadSwap}` })).status, 401);
  assert.equal((await h.call('GET', '/api/session', { cookie })).status, 200);
  h.clock.advance(24 * 3600 * 1000 + 1000);
  assert.equal((await h.call('GET', '/api/session', { cookie })).status, 401, 'expired after 24 h');
});

test('session secret rotation: previous secret still verifies', async () => {
  const h = setup();
  await h.signup();
  const { cookie } = await h.confirm();
  const h2 = setup({ repo: h.repo, env: { SESSION_SECRET: 'n'.repeat(40), SESSION_SECRET_PREVIOUS: h.env.SESSION_SECRET } });
  h2.clock.set(h.clock.now());
  assert.equal((await h2.call('GET', '/api/session', { cookie })).status, 200);
});

test('download: needs email session AND approved; 302 to the storage URL; nothing about the person logged; link expires', async () => {
  const h = setup({ env: { BETA_CAP: '0' } });
  await h.signup();
  const { cookie } = await h.confirm();
  assert.equal((await h.call('GET', '/api/session', { cookie }).then(r => r.json())).session.stage, 'waitlisted');
  const w = await h.call('GET', '/api/download/mac/arm64', { cookie });
  assert.equal(w.status, 403, 'waitlisted cannot download');
  assert.equal(h.repo.debugCount('downloads'), 0);

  await h.admin('/api/admin/set-state', { email: 'alex@example.com', state: 'approved' });
  const r = await h.call('GET', '/api/download/mac/arm64', { cookie });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin, 'https://files.example.test', 'Location comes from the storage adapter');
  assert.equal(loc.pathname, '/Sidekick-2.0.1-arm64.dmg');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(h.repo.debugCount('downloads'), 0, 'no per-person download row (launch log Part 14)');
  assert.equal(h.storage.check(loc.href), true);
  h.clock.advance(601 * 1000);
  assert.equal(h.storage.check(loc.href), false, 'the signed link expires after ~10 minutes');
});

test('download: no session → 401 for fetch, 303 to the Download page for a browser; x64 and APK are never served', async () => {
  const h = setup();
  assert.equal((await h.call('GET', '/api/download/mac/arm64')).status, 401);
  const nav = await h.call('GET', '/api/download/mac/arm64', { headers: { accept: 'text/html,application/xhtml+xml' } });
  assert.equal(nav.status, 303);
  assert.equal(nav.headers.get('location'), '/Download.dc.html');
  await h.signup();
  const { cookie } = await h.confirm();
  assert.equal((await h.call('GET', '/api/download/mac/x64', { cookie })).status, 404);
  assert.equal((await h.call('GET', '/api/download/mac', { cookie })).status, 404);
  const a = await h.call('GET', '/api/download/android', { cookie });
  assert.equal(a.status, 404);
  assert.equal((await a.json()).error, 'NOT_AVAILABLE');
  assert.equal((await h.call('GET', '/api/download/windows/x64', { cookie })).status, 404);
  assert.equal(h.repo.debugCount('downloads'), 0);
});

test('download: android goes to the store URL from releases.json when there is one', async () => {
  const rel = JSON.parse(JSON.stringify((await import('../data/releases.json', { with: { type: 'json' } })).default));
  rel.android.storeUrl = 'https://play.google.com/store/apps/details?id=example.sidekick';
  const h = setup({ releases: rel });
  await h.signup();
  const { cookie } = await h.confirm();
  const r = await h.call('GET', '/api/download/android', { cookie });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), rel.android.storeUrl);
});

test('download is rate limited per person', async () => {
  const h = setup({ env: { RATE_LIMIT_DOWNLOAD: '2/3600' } });
  await h.signup();
  const { cookie } = await h.confirm();
  assert.equal((await h.call('GET', '/api/download/mac/arm64', { cookie })).status, 302);
  assert.equal((await h.call('GET', '/api/download/mac/arm64', { cookie })).status, 302);
  assert.equal((await h.call('GET', '/api/download/mac/arm64', { cookie })).status, 429);
});

test('re-signup with a confirmed address emails the download link to the inbox, not to the requester; old access links still work', async () => {
  const h = setup();
  await h.signup();
  await h.confirm();
  const before = h.repo.debugOutbox().length;
  const r = await h.signup();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, stage: 'already' }, 'the requester learns nothing else, and gets no session');
  assert.equal(cookieOf(r), null);
  assert.equal(h.repo.debugOutbox().length, before + 1);
  const mail = h.repo.debugOutbox().at(-1);
  assert.equal(mail.kind, 'access'); assert.equal(mail.toEmail, 'alex@example.com');
  assert.ok(mail.text.includes(ORIGIN + '/download/mac') && !mail.text.includes('/api/access'), 'the download link, no "Open your downloads" step');
  // An access link from an older email still opens the Download page (recovery).
  const { randomToken, sha256hex } = await import('../server/crypto.mjs');
  const t = randomToken(32);
  await h.repo.createLink({ hash: sha256hex(t), purpose: 'access', refId: (await h.repo.getSignupByEmail('alex@example.com')).id, expiresAt: h.clock.now() + 3600000, maxUses: 10 }, h.clock.now());
  const page = await h.call('GET', '/api/access');
  assert.equal(page.status, 200);
  const a = await h.call('POST', '/api/access', { form: { t, 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(a.status, 303);
  assert.equal(a.headers.get('location'), '/Download.dc.html');
  const ss = await h.call('GET', '/api/session', { cookie: cookieOf(a) });
  assert.equal((await ss.json()).session.stage, 'approved');
});

test('emails per address are capped, silently', async () => {
  const h = setup({ env: { RATE_LIMIT_MAIL_ADDRESS: '2/3600', RATE_LIMIT_SIGNUP_EMAIL: '50/3600' } });
  for (let i = 0; i < 5; i++) assert.equal((await h.signup({}, { ip: '192.0.2.' + i })).status, 200);
  assert.equal(h.repo.debugOutbox().filter(m => m.toEmail === 'alex@example.com').length, 2);
});

test('the whole pipeline: signup → confirm → signer token → token email → download', async () => {
  const h = setup();
  await h.signup();
  await h.confirm();
  const p = await h.admin('/api/admin/pending', {}, { key: 'signer' });
  const list = (await p.json()).pending;
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Alex Rivera');
  const token = fakeToken();
  const t = await h.admin('/api/admin/token', { signupId: list[0].signupId, token }, { key: 'signer' });
  assert.equal(t.status, 200);
  assert.equal((await h.admin('/api/admin/token', { signupId: list[0].signupId, token: fakeToken() }, { key: 'signer' })).status, 409, 'one token per person');
  assert.equal((await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json()).pending.length, 0);
  const ob = await (await h.admin('/api/admin/outbox', {}, { key: 'signer' })).json();
  const mail = ob.messages.find(m => m.kind === 'token');
  const invite = ob.messages.find(m => m.kind === 'invite');
  assert.ok(mail.text.includes(token), 'the token is in the email');
  assert.ok(!mail.text.includes('/api/access'), 'the token email carries no download link');
  assert.ok(invite.text.includes(ORIGIN + '/download/mac') && !invite.text.includes(token), 'the invitation links to the download, without the token');
  assert.equal((await h.admin('/api/admin/outbox-ack', { id: mail.id, ok: true }, { key: 'signer' })).status, 200);
  assert.equal((await h.repo.getSignupByEmail('alex@example.com')).state, 'issued', 'delivered only once both emails are sent');
  assert.equal((await h.admin('/api/admin/outbox-ack', { id: invite.id, ok: true }, { key: 'signer' })).status, 200);
  const row = await h.repo.getSignupByEmail('alex@example.com');
  assert.equal(row.state, 'delivered');
  assert.equal(h.repo.debugOutbox().find(m => m.id === mail.id).text, '', 'sent email text is erased');
  assert.equal((await h.call('GET', '/download/mac')).status, 302, 'the public download route');
});

test('signer claim expires so a crashed run is retried; bad tokens are refused', async () => {
  const h = setup();
  await h.signup();
  await h.confirm();
  const first = (await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json()).pending;
  assert.equal(first.length, 1);
  assert.equal((await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json()).pending.length, 0, 'claimed');
  h.clock.advance(16 * 60 * 1000);
  assert.equal((await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json()).pending.length, 1, 'claim expired');
  for (const bad of ['', 'not a token', 'SIDEKICK-TRIAL-1.abc.def', 'a'.repeat(64), fakeToken() + '\r\nBcc: x@example.com', fakeToken().replace('SIDEKICK-TRIAL-1', 'SIDEKICK-LICENCE-1')]) {
    assert.equal((await h.admin('/api/admin/token', { signupId: first[0].signupId, token: bad }, { key: 'signer' })).status, 400, JSON.stringify(bad.slice(0, 20)));
  }
});

test('emails per address are also capped per day', async () => {
  const h = setup({ env: { RATE_LIMIT_MAIL_ADDRESS: '100/3600', RATE_LIMIT_MAIL_ADDRESS_DAY: '4/86400', RATE_LIMIT_SIGNUP_EMAIL: '100/3600' } });
  for (let i = 0; i < 6; i++) { await h.signup({}, { ip: '192.0.2.' + i }); h.clock.advance(3600 * 1000); }
  assert.equal(h.repo.debugOutbox().filter(m => m.toEmail === 'alex@example.com').length, 4);
});

test('a waitlisted person who signs up again is told again (nothing else, same response)', async () => {
  const h = setup({ env: { BETA_CAP: '0' } });
  await h.signup();
  await h.confirm();
  const n = h.repo.debugOutbox().filter(m => m.kind === 'waitlist').length;
  const r = await h.signup({}, { ip: '192.0.2.77' });
  assert.equal(r.status, 200);
  assert.equal(h.repo.debugOutbox().filter(m => m.kind === 'waitlist').length, n + 1);
  assert.equal(h.repo.debugOutbox().filter(m => m.kind === 'access').length, 0, 'no access link while waitlisted');
});

test('link pages: the token never reaches the server on GET, and the page script clears it from the address bar', async () => {
  const h = setup();
  const page = await (await h.call('GET', '/api/confirm-email?for=updates')).text();
  assert.match(page, /Confirm Sidekick updates/);
  assert.match(page, /<input type="hidden" name="t" id="t" value="">/);
  assert.match(page, /location\.hash\.match/);
  assert.match(page, /history\.replaceState/);
  const nonce = page.match(/<script nonce="([^"]+)">\(function/)[1];
  assert.ok(nonce.length >= 16);
});

test('admin delete-my-data by email removes the sign-up, roadmap requests and feedback; unsubscribe stops every list', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  await h.repo.addNotify({ email: 'alex@example.com', featureId: roadmap.ids[0] }, h.clock.now()); // made before notify closed (Part 14)
  await h.call('POST', '/api/feedback', { json: { message: 'please add this', email: 'alex@example.com', captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }, headers: { origin: ORIGIN } });
  assert.equal(h.repo.debugCount('notify'), 1); assert.equal(h.repo.debugCount('feedback'), 1);

  const u = await (await h.admin('/api/admin/unsubscribe', { email: 'ALEX@example.com' })).json();
  assert.deepEqual([u.ok, u.updates, u.notify], [true, 1, 1]);
  assert.equal((await h.repo.getSignupByEmail('alex@example.com')).marketingRequestedAt, null);
  assert.equal((await h.admin('/api/admin/unsubscribe', { email: 'not an email' })).status, 400);

  const sid = (await h.repo.getSignupByEmail('alex@example.com')).id;
  const d = await (await h.admin('/api/admin/delete', { signupId: sid })).json();
  assert.deepEqual([d.ok, d.deleted, d.signupId, d.feedback], [true, 1, sid, 1], 'a signupId finds the address, and everything under it goes');
  assert.equal(h.repo.debugCount('signups'), 0); assert.equal(h.repo.debugCount('feedback'), 0);
  const again = await (await h.admin('/api/admin/delete', { email: 'alex@example.com' })).json();
  assert.deepEqual([again.ok, again.deleted, again.notify, again.feedback], [true, 0, 0, 0]);
  assert.ok(!h.logs.some(l => l.includes('alex@')), 'no address in the logs');
});
