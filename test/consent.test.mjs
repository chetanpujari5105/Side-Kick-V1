// The updates (marketing) choice is the one in the submission being handled: an unticked box never produces an
// updates link or a stored request, in the JSON and the no-JS path, and only the updates link itself confirms it.
// Launch log Part 6 (2026-10-17): a second, unticked submission still emailed the first one's updates link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ORIGIN } from './helpers.mjs';
import { MSG } from '../server/validate.mjs';

const CAP = 'XXXX.DUMMY.TOKEN.XXXX';
const UPDATES = /confirm-email\?for=updates#t=([A-Za-z0-9_-]{43})/;
const confirms = (h, to = 'alex@example.com') => h.repo.debugOutbox().filter(m => m.toEmail === to && m.kind === 'confirm');
const last = (h, to) => { const c = confirms(h, to); return c[c.length - 1]; };
const row = (h, e = 'alex@example.com') => h.repo.getSignupByEmail(e);
const noJs = (h, o = {}) => {
  const form = Object.fromEntries(Object.entries({ name: 'Alex', email: 'alex@example.com', macChip: 'apple', phoneModel: 'Pixel 8', googleEmail: 'alex@gmail.com', privacyAccepted: 'on', 'cf-turnstile-response': CAP, ...o }).filter(([, v]) => v !== undefined));
  return h.call('POST', '/api/get-sidekick', { form, headers: { origin: ORIGIN, accept: 'text/html' } });
};
const useLink = (h, t) => h.call('POST', '/api/confirm-email', { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } });

test('unticked updates (JSON): no stored request, and the confirm email has no updates link', async () => {
  const h = setup();
  assert.equal((await h.signup({ marketingOptIn: false })).status, 200);
  assert.equal((await row(h)).marketingRequestedAt, null);
  assert.ok(!UPDATES.test(last(h).text));
  for (const v of [undefined, null, '', 'off', 'false', 0, '0', 'no']) {
    const e = `v${String(v)}@example.com`.replace(/[^a-z0-9@.]/gi, 'x');
    await h.signup({ email: e, marketingOptIn: v });
    assert.equal((await row(h, e)).marketingRequestedAt, null, `marketingOptIn ${JSON.stringify(v)}`);
    assert.ok(!UPDATES.test(last(h, e).text), `no link for ${JSON.stringify(v)}`);
  }
});

test('ticked updates (JSON): a request and a separate updates link; the confirm link does not confirm updates', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  assert.ok((await row(h)).marketingRequestedAt);
  const t = last(h).text.match(UPDATES);
  assert.ok(t, 'updates link sent');
  await h.confirm();
  assert.equal((await row(h)).marketingConfirmedAt, null, 'confirming the address is not consent to updates');
  assert.equal((await useLink(h, t[1])).status, 200);
  assert.ok((await row(h)).marketingConfirmedAt, 'only the updates link confirms (double opt-in)');
});

test('no-JS form: updates only when the box is sent ticked ("on"); absent means no', async () => {
  const h = setup();
  assert.equal((await noJs(h)).status, 303);
  assert.equal((await row(h)).marketingRequestedAt, null);
  assert.ok(!UPDATES.test(last(h).text));
  const h2 = setup();
  assert.equal((await noJs(h2, { marketingOptIn: 'on' })).status, 303);
  assert.ok((await row(h2)).marketingRequestedAt);
  assert.ok(UPDATES.test(last(h2).text));
});

test('sending the form again unticked withdraws an unconfirmed request: no updates link, and the old one no longer works', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  const old = last(h).text.match(UPDATES)[1];
  await h.signup({ marketingOptIn: false });
  assert.equal(confirms(h).length, 2, 'a second confirm email was queued');
  assert.ok(!UPDATES.test(last(h).text), 'the unticked submission\'s email has no updates link');
  assert.equal((await row(h)).marketingRequestedAt, null, 'no stored request after an unticked submission');
  await useLink(h, old);
  assert.equal((await row(h)).marketingConfirmedAt, null, 'the earlier updates link cannot confirm any more');
  // The same through the no-JS form (box absent).
  const g = setup();
  await noJs(g, { marketingOptIn: 'on' });
  await noJs(g);
  assert.ok(!UPDATES.test(last(g).text));
  assert.equal((await row(g)).marketingRequestedAt, null);
});

test('sending the form again ticked (while unconfirmed) asks for updates then, with its own link', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: false });
  await h.signup({ marketingOptIn: true });
  assert.ok((await row(h)).marketingRequestedAt);
  const t = last(h).text.match(UPDATES);
  assert.ok(t, 'the ticked submission\'s email carries the updates link');
  assert.equal((await useLink(h, t[1])).status, 200);
  assert.ok((await row(h)).marketingConfirmedAt);
});

test('an unticked submission never sets anything, and does not touch consent already confirmed by its own link', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: true });
  await useLink(h, last(h).text.match(UPDATES)[1]);
  const before = (await row(h)).marketingConfirmedAt;
  assert.ok(before);
  await h.signup({ marketingOptIn: false });
  assert.ok(!UPDATES.test(last(h).text), 'no updates link');
  assert.deepEqual((await row(h)).marketingConfirmedAt, before, 'withdrawal of confirmed consent stays with unsubscribe and delete-my-data');
});

test('a confirmed address signing up again: access email, never an updates link, ticked or not', async () => {
  const h = setup();
  await h.signup({ marketingOptIn: false });
  await h.confirm();
  await h.signup({ marketingOptIn: true });
  const mails = h.repo.debugOutbox().filter(m => m.toEmail === 'alex@example.com');
  assert.equal(mails[mails.length - 1].kind, 'access');
  assert.ok(!mails.some(m => UPDATES.test(m.text)));
  assert.equal((await row(h)).marketingRequestedAt, null, 'no request without a link to confirm it');
});

test('privacy unticked is refused in both paths: 400, nothing stored, no email', async () => {
  const h = setup();
  for (const p of [false, undefined, '', 'off']) {
    const r = await h.signup({ privacyAccepted: p, marketingOptIn: true });
    assert.equal(r.status, 400, `privacyAccepted ${JSON.stringify(p)}`);
    assert.equal((await r.json()).fieldErrors.privacyAccepted, MSG.privacy);
  }
  const r = await noJs(h, { privacyAccepted: undefined, marketingOptIn: 'on' });
  assert.equal(r.status, 400);
  assert.equal(h.repo.debugCount('signups'), 0);
  assert.equal(h.repo.debugCount('outbox'), 0);
});
