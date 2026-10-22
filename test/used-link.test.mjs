// Launch log Part 20: a tester confirmed the "Confirm Sidekick updates" link, pressed it again seconds later and was told
// "This link has expired" — and read that as their beta token having expired (it had 40 days left). A link that was
// used says so, every link page says the token is not affected, and the token's own end date is stated where the
// token is shown. The owner can send a person their own token again (admin resend-token).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ORIGIN, T0, poolToken } from './helpers.mjs';
import { emails, SHORT_STEPS } from '../server/emails.mjs';
import { linkPage, resultPage } from '../server/pages.mjs';
import releasesJson from '../data/releases.json' with { type: 'json' };

const CAP = 'XXXX.DUMMY.TOKEN.XXXX';
const NOTE = 'Your beta key is not affected';
const updatesLink = (h, to) => (h.repo.debugOutbox().filter(m => m.toEmail === to).map(m => m.text).join('\n').match(/confirm-email\?for=updates#t=([A-Za-z0-9_-]{43})/) || [])[1];
const post = (h, t, asPage = true) => h.call('POST', '/api/confirm-email', asPage
  ? { form: { t, 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN, accept: 'text/html' } }
  : { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } });

test('the updates link pressed twice: the second answer says it was already confirmed, never "expired"', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  const t = updatesLink(h, 'alex@example.com');
  assert.ok(t, 'the confirm email carries an updates link');
  const first = await post(h, t);
  assert.equal(first.status, 200);
  assert.match(await first.text(), /Updates confirmed/);
  const again = await post(h, t);
  assert.equal(again.status, 410, 'still refused: one use');
  const body = await again.text();
  assert.match(body, /This link has already been used\./);
  assert.match(body, /already confirmed Sidekick updates/);
  assert.doesNotMatch(body, /expired/i, 'a used link is not an expired one');
  assert.doesNotMatch(body, /Get Sidekick form/, 'a link that did its job never sends people back to the form');
  assert.ok(body.includes(NOTE), 'says the token is not affected');
  const json = await post(h, t, false);
  assert.deepEqual(await json.json(), { ok: false, error: 'LINK_USED' });
});

test('the confirm link pressed twice says the email is already confirmed; a session is not handed out again', async () => {
  const h = setup();
  await h.signup();
  const t = h.linkFrom('alex@example.com');
  assert.equal((await post(h, t)).status, 303);
  const again = await post(h, t);
  assert.equal(again.status, 410);
  assert.equal(again.headers.get('set-cookie'), null);
  const body = await again.text();
  assert.match(body, /This link has already been used\./);
  assert.match(body, /already confirmed your email/);
  assert.doesNotMatch(body, /expired/i);
  assert.doesNotMatch(body, /Get Sidekick form/);
  assert.ok(body.includes(NOTE));
});

test('a link past its time still says expired (and that the token is not affected); a cut-off link says incomplete', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  const t = updatesLink(h, 'alex@example.com');
  h.clock.advance(7 * 24 * 3600 * 1000 + 1);
  const late = await post(h, t);
  assert.equal(late.status, 410);
  const lb = await late.text();
  assert.match(lb, /This link has expired\./);
  assert.match(lb, /If you already did what this link was for, there's nothing else to do\. If you still need it, fill in the <a [^>]+>Get Sidekick form<\/a> again/, 'the form only for someone who still needs a new link');
  assert.ok(lb.includes(NOTE));
  assert.deepEqual(await (await post(h, t, false)).json(), { ok: false, error: 'LINK_EXPIRED' });
  for (const cut of ['', t.slice(0, 20)]) {
    const r = await post(h, cut);
    assert.equal(r.status, 410);
    const b = await r.text();
    assert.match(b, /This link is incomplete\./);
    assert.doesNotMatch(b, /expired/i);
    assert.doesNotMatch(b, /Get Sidekick form/);
    assert.ok(b.includes(NOTE));
  }
  assert.deepEqual(await (await post(h, 'x', false)).json(), { ok: false, error: 'LINK_INCOMPLETE' });
});

test('a refused unsubscribe link says the beta key is not affected too', async () => {
  const h = setup();
  const r = await h.call('POST', '/api/unsubscribe', { form: { t: 'A'.repeat(43) }, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(r.status, 410);
  assert.ok((await r.text()).includes(NOTE));
});

test('every link page that refuses says the token is not affected', () => {
  for (const purpose of ['confirm', 'updates', 'access']) for (const reason of ['used', 'expired', 'incomplete', undefined]) {
    const page = linkPage({ purpose, nonce: 'n', siteKey: 'k', valid: false, reason });
    assert.ok(page.includes(NOTE), `${purpose}/${reason}`);
  }
});

// A pool token minted at T0 (2026-10-15) for 45 days ends at 2026-11-29 00:00 UTC — whenever it is handed out.
const END = '29 Nov 2026, 00:00 UTC';
const release = JSON.parse(JSON.stringify(releasesJson));

test('emails state the token\'s own end date and what to do when it ends; privacy wording unchanged', () => {
  const token = poolToken(T0, 45);
  for (const m of [emails.copy({ name: 'Asha', token, downloadUrl: ORIGIN + '/download/mac', release }), emails.token({ name: 'Asha', token })]) {
    assert.ok(m.text.includes(`It works until ${END}.`), m.kind);
    assert.ok(!m.text.includes('45 days from the day it was made'), `${m.kind}: no "from the day it was made" for a token whose end is known`);
    assert.ok(m.text.includes('It is yours: please don\'t share it. Sidekick checks it on your Mac and sends it nowhere.'), `${m.kind}: privacy sentence kept word for word`);
    assert.ok(m.text.includes('If Sidekick says your beta access has ended, reply to this email for a new token.'), m.kind);
  }
  const odd = 'SIDEKICK-TRIAL-1.' + 'A'.repeat(80) + '.' + 'B'.repeat(86); // not the issuer's layout: no end date to read
  assert.ok(emails.token({ name: 'Asha', token: odd }).text.includes('It works for 45 days from the day it was made.'));
});

test('the result page (server and JSON) states the token\'s end date and what to do when it ends', async () => {
  const token = poolToken(T0, 45);
  const html = resultPage({ nonce: 'n', firstName: 'Asha', token, download: { url: '/download/mac', auto: false, file: 'X.dmg' }, release, android: null });
  assert.ok(html.includes(`It works until ${END}.`));
  assert.ok(html.includes('If Sidekick later says your beta access has ended, write to us for a new token.'));
  const h = setup();
  await h.admin('/api/admin/pool-add', { tokens: [poolToken(h.clock.now(), 45)] }, { key: 'signer' });
  const r = await h.signup({ email: 'asha@example.com' });
  const j = await r.json();
  assert.equal(j.stage, 'in');
  assert.equal(j.tokenUntil, END);
  assert.ok(SHORT_STEPS('X.dmg').length === 3);
});

test('Get Sidekick shows the end date the API sends, under the token', async () => {
  const page = (await import('node:fs')).readFileSync(new URL('../Get Sidekick.dc.html', import.meta.url), 'utf8');
  assert.ok(page.includes('{{ resUntil }}'), 'the page renders resUntil');
  assert.ok(/resUntil: res\.tokenUntil \? `It works until \$\{res\.tokenUntil\}\. If Sidekick later says your beta access has ended, write to us for a new token\.` : ''/.test(page));
});

test('admin resend-token: shows the email with the token blanked, queues nothing without yes; with yes, one email to the sign-up\'s own address', async () => {
  const h = setup();
  const tok = poolToken(h.clock.now(), 45);
  await h.admin('/api/admin/pool-add', { tokens: [tok] }, { key: 'signer' });
  await h.signup({ email: 'asha@example.com', name: 'Asha' });
  const before = h.repo.debugOutbox().length;
  const preview = await h.admin('/api/admin/resend-token', { email: 'asha@example.com' });
  assert.equal(preview.status, 200);
  const p = await preview.json();
  assert.equal(p.queued, 0);
  assert.equal(p.to, 'asha@example.com');
  assert.equal(p.tokenUntil, END);
  assert.ok(p.text.includes('[token]') && !p.text.includes(tok) && !JSON.stringify(p).includes(tok), 'the token never comes back to the CLI');
  assert.ok(p.text.includes(`It works until ${END}.`));
  assert.equal(h.repo.debugOutbox().length, before, 'nothing queued without yes');
  const sent = await (await h.admin('/api/admin/resend-token', { email: 'asha@example.com', yes: true })).json();
  assert.equal(sent.queued, 1);
  assert.ok(!JSON.stringify(sent).includes(tok));
  const out = h.repo.debugOutbox().slice(before);
  assert.equal(out.length, 1);
  assert.equal(out[0].toEmail, 'asha@example.com');
  assert.equal(out[0].kind, 'copy');
  assert.ok(out[0].text.includes(tok), 'the email itself carries the person\'s own token');
  assert.ok(!h.logs.join('\n').includes(tok), 'no token in the logs');
  assert.equal((await h.admin('/api/admin/resend-token', { email: 'nobody@example.com', yes: true })).status, 404);
  await h.signup({ email: 'bo@example.com', name: 'Bo' }); // the pool is empty now: the email flow, no token yet
  assert.equal((await h.admin('/api/admin/resend-token', { email: 'bo@example.com', yes: true })).status, 409);
  const signer = await h.admin('/api/admin/resend-token', { email: 'asha@example.com' }, { key: 'signer' });
  assert.equal(signer.status, 403, 'the signer key cannot call it');
});
