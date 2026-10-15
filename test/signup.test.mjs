import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, cookieOf, ORIGIN } from './helpers.mjs';
import { MSG } from '../server/validate.mjs';

test('valid signup: 200 only after the row exists, form session cookie, confirm email queued', async () => {
  const h = setup();
  const res = await h.signup();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const sc = res.headers.get('set-cookie');
  assert.match(sc, /^sk_session=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=86400']) assert.ok(sc.includes(flag), flag);
  const row = await h.repo.getSignupByEmail('alex@example.com');
  assert.equal(row.state, 'pending_email');
  assert.equal(row.macChip, 'apple');
  assert.ok(h.linkFrom('alex@example.com'), 'a confirm link was queued');
});

test('400 field errors use the Handoff strings', async () => {
  const h = setup();
  const res = await h.signup({ name: ' ', email: 'alex@example', macChip: 'x64', phoneModel: '', privacyAccepted: false });
  assert.equal(res.status, 400);
  const b = await res.json();
  assert.equal(b.ok, false);
  assert.deepEqual(b.fieldErrors, { name: MSG.name, email: MSG.email, macChip: MSG.chip, phoneModel: MSG.phone, privacyAccepted: MSG.privacy });
  assert.equal(MSG.email, 'Enter an email address like name@example.com.');
  assert.equal(MSG.chip, "Choose your Mac's chip, or Not sure.");
  assert.equal((await h.signup({ email: '' })).status, 400);
  assert.equal((await h.signup({ macChip: 'intel' })).status, 400);
  assert.equal(h.repo.debugCount('signups'), 0, 'nothing written for invalid input');
});

test('idempotent: same email twice → one row, identical response, no leak', async () => {
  const h = setup();
  const a = await h.signup();
  const b = await h.signup({ name: 'Someone Else', email: '  ALEX@example.com ', phoneModel: 'Other' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(h.repo.debugCount('signups'), 1);
  const row = await h.repo.getSignupByEmail('alex@example.com');
  assert.equal(row.name, 'Alex Rivera', 'a second signup cannot change stored details');
  // An unknown email and a known one produce the same headers apart from the cookie value.
  const c = await h.signup({ email: 'new@example.com' });
  assert.equal(c.status, 200);
  assert.deepEqual([...b.headers.keys()].sort(), [...c.headers.keys()].sort());
});

test('rate limit per IP: 429 with retryAfter, nothing written', async () => {
  const h = setup({ env: { RATE_LIMIT_SIGNUP_IP: '2/3600' } });
  assert.equal((await h.signup({ email: 'a1@example.com' })).status, 200);
  assert.equal((await h.signup({ email: 'a2@example.com' })).status, 200);
  const r = await h.signup({ email: 'a3@example.com' });
  assert.equal(r.status, 429);
  const b = await r.json();
  assert.equal(b.error, 'RATE_LIMITED');
  assert.ok(Number.isInteger(b.retryAfter) && b.retryAfter > 0 && b.retryAfter <= 3600);
  assert.equal(r.headers.get('retry-after'), String(b.retryAfter));
  assert.equal(await h.repo.getSignupByEmail('a3@example.com'), null);
  // Another IP is unaffected; the window passes.
  assert.equal((await h.signup({ email: 'a4@example.com' }, { ip: '198.51.100.9' })).status, 200);
  h.clock.advance(3600 * 1000);
  assert.equal((await h.signup({ email: 'a5@example.com' })).status, 200);
});

test('rate limit per email applies to every address alike', async () => {
  const h = setup({ env: { RATE_LIMIT_SIGNUP_EMAIL: '2/3600' } });
  for (let i = 0; i < 2; i++) assert.equal((await h.signup({}, { ip: `198.51.100.${i}` })).status, 200);
  assert.equal((await h.signup({}, { ip: '198.51.100.50' })).status, 429);
});

for (const mode of ['fail', 'timeout', 'error', 'hostname', 'throw']) {
  test(`Turnstile ${mode} → fails closed (403), nothing written`, async () => {
    const h = setup();
    h.botCheck.mode = mode;
    const r = await h.signup();
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'BOT_CHECK_FAILED');
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(h.repo.debugCount('signups'), 0);
  });
}

test('missing captcha token fails closed', async () => {
  const h = setup();
  const r = await h.signup({ captchaToken: undefined });
  assert.equal(r.status, 403);
});

test('database failure → 5xx, no cookie, never a 200', async () => {
  const h = setup();
  h.repo.failNext = 'upsertSignup';
  const r = await h.signup();
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await r.json()).ok, false);
});

test('cross-site Origin is refused', async () => {
  const h = setup();
  const r = await h.call('POST', '/api/get-sidekick', { json: h.signupBody(), headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('wrong content type and oversized bodies are refused', async () => {
  const h = setup();
  assert.equal((await h.call('POST', '/api/get-sidekick', { raw: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await h.call('POST', '/api/get-sidekick', { raw: '{"a":"' + 'x'.repeat(20000) + '"}', headers: { 'content-type': 'application/json' } })).status, 413);
  assert.equal((await h.call('POST', '/api/get-sidekick', { raw: '{bad', headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await h.call('GET', '/api/get-sidekick')).status, 405);
});

test('no-JS form: errors come back as an accessible HTML page with the Handoff strings', async () => {
  const h = setup();
  const r = await h.call('POST', '/api/get-sidekick', { form: { name: '', email: 'nope', phoneModel: 'Pixel 8', 'cf-turnstile-response': 'x' }, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const page = await r.text();
  for (const m of [MSG.name, MSG.email, MSG.chip, MSG.privacy]) assert.ok(page.includes(m.replace(/'/g, '&#39;')), m);
  assert.match(page, /role="alert"/);
  assert.match(page, /aria-invalid="true"/);
  assert.match(page, /aria-describedby="e-email"/);
  assert.match(page, /value="Pixel 8"/, 'answers are kept');
  assert.match(page, /action="\/api\/get-sidekick"/);
});

test('no-JS form: Turnstile cannot run without JavaScript, so it fails closed with a plain explanation', async () => {
  const h = setup();
  h.botCheck.mode = 'fail';
  const r = await h.call('POST', '/api/get-sidekick', { form: { name: 'Alex', email: 'alex@example.com', macChip: 'apple', phoneModel: 'Pixel 8', googleEmail: 'alex@gmail.com', privacyAccepted: 'on' }, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(r.status, 403);
  const page = await r.text();
  assert.match(page, /needs JavaScript/);
  assert.equal(h.repo.debugCount('signups'), 0);
});

test('no-JS form: success is a 303 redirect to a fixed page with the session cookie', async () => {
  const h = setup();
  const r = await h.call('POST', '/api/get-sidekick', { form: { name: 'Alex', email: 'alex@example.com', macChip: 'unsure', phoneModel: 'Pixel 8', googleEmail: 'alex@gmail.com', privacyAccepted: 'on', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX', next: 'https://evil.example/' }, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/check-email.html');
  assert.ok(cookieOf(r));
});
