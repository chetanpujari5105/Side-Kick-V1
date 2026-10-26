// Branded HTML emails (launch log Part 11): every signer email is sent as multipart HTML + plain text, rendered from the
// plain text the server queues, so the outbox, the Mail.app fallback and the old signer keep working unchanged.
// Short content: one download link (/download/mac), three install steps, no Drive folder, no SHA-256, no "full steps".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emails, SHORT_STEPS, firstName } from '../server/emails.mjs';
import { renderEmail, DUMMY_TOKEN, LOGO_URL } from '../server/email-html.mjs';
import releasesJson from '../data/releases.json' with { type: 'json' };

const SITE = 'https://sidekickapp.in';
const DL = SITE + '/download/mac';
const release = JSON.parse(JSON.stringify(releasesJson));
const TOKEN = 'SIDEKICK-TRIAL-1.' + 'A'.repeat(150) + '.' + 'b'.repeat(111); // 280 characters, token-shaped
const SHA = release.mac.builds.arm64.sha256;
const PLAY = release.android.playTestUrl;

// One of every email the signer can send.
const all = (name = 'chetan pujari') => [
  emails.copy({ name, token: TOKEN, downloadUrl: DL, release }),
  emails.copy({ name, token: null, downloadUrl: DL, release }),
  emails.android({ name, release, googleEmail: 'chetan@gmail.com' }),
  emails.confirm({ name, confirmUrl: SITE + '/c?t=1', updatesUrl: SITE + '/u?t=2', downloadUrl: DL, android: true }),
  emails.updates({ name, updatesUrl: SITE + '/u?t=2' }),
  emails.access({ name, downloadUrl: DL }),
  emails.waitlist({ name }),
  emails.invite({ name, downloadUrl: DL, release, googleEmail: 'chetan@gmail.com' }),
  emails.invite({ name, downloadUrl: DL, release }),
  emails.token({ name, token: TOKEN }),
  emails.announce({ subject: 'Sidekick 2.0.2', body: 'A new build is out.\n\nIt fixes pairing.', unsubscribeUrl: SITE + '/x?t=4' })
];

test('short content: no Drive folder, no SHA-256 block, no "full steps" link in any email (text and HTML)', () => {
  for (const m of all()) {
    const { html } = renderEmail(m);
    for (const body of [m.text, html]) {
      assert.ok(!/drive\.google\.com|Google Drive/i.test(body), `${m.kind}: no Drive`);
      assert.ok(!body.includes(SHA) && !/SHA-256|checksum/i.test(body), `${m.kind}: no SHA-256`);
      assert.ok(!/Support\.dc\.html|full steps/i.test(body), `${m.kind}: no full-steps link`);
    }
  }
});

test('one download link: every email that offers the Mac app links exactly /download/mac, once', () => {
  for (const m of all().filter(m => ['copy', 'confirm', 'access', 'invite'].includes(m.kind))) {
    assert.equal(m.text.split(DL).length - 1, 1, `${m.kind}: once in the text`);
    const { html } = renderEmail(m);
    assert.equal(html.split(`href="${DL}"`).length - 1, 1, `${m.kind}: once in the HTML`);
  }
});

test('first names are capitalised everywhere (emails and subjects)', () => {
  assert.equal(firstName('chetan pujari'), 'Chetan');
  assert.equal(firstName('élodie'), 'Élodie');
  assert.equal(firstName('  ana-maria  x'), 'Ana-maria');
  assert.equal(firstName(''), '');
  for (const m of all('chetan')) if (m.kind !== 'notify' && m.kind !== 'announce') {
    assert.ok(m.text.includes('Chetan') && !/\bchetan\b(?!@| pujari)/.test(m.text.replace(/chetan@gmail\.com/g, '').split(PLAY).join('')), `${m.kind}: capitalised in the text`);
    assert.ok(renderEmail(m).html.includes('Chetan'), `${m.kind}: capitalised in the HTML`);
  }
  assert.equal(emails.copy({ name: 'chetan', token: TOKEN, downloadUrl: DL, release }).subject, "You're in, Chetan: your Sidekick beta");
  assert.equal(emails.copy({ name: '', token: TOKEN, downloadUrl: DL, release }).subject, 'Your Sidekick beta');
});

test('"Your Sidekick beta": headline, big Download for Mac button, token card, three numbered steps', () => {
  const m = emails.copy({ name: 'chetan', token: TOKEN, downloadUrl: DL, release });
  assert.match(m.text, /^You're in, Chetan\.\n/);
  assert.ok(m.text.includes(`\n${TOKEN}\n`), 'the token on its own line in the plain text');
  assert.ok(m.text.includes('Select and copy the whole line'));
  for (const s of SHORT_STEPS(release.mac.builds.arm64.file)) assert.ok(m.text.includes(s), s);
  const { html, text } = renderEmail(m);
  assert.equal(text, m.text, 'the plain-text alternative is the queued text');
  assert.match(html, /<h1[^>]*>You(&#39;|’|')re in, Chetan\.<\/h1>/);
  const btn = html.match(/<td[^>]*bgcolor="#C6FF33"[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  assert.ok(btn, 'a lime table-cell button');
  assert.deepEqual([btn[1], btn[2]], [DL, 'Download for Mac']);
  const card = html.slice(html.indexOf('data-sk="token"'), html.indexOf('data-sk="token-end"'));
  assert.ok(card.replace(/<wbr>/g, '').includes(TOKEN), 'the whole token in the card');
  assert.match(card, /font-family:[^;"]*monospace/);
  assert.match(card, /word-break:break-all/);
  assert.match(card, /Select and copy the whole line/);
  assert.equal((html.match(/data-sk="step"/g) || []).length, 3, 'three step rows');
  for (const n of ['1', '2', '3']) assert.match(html, new RegExp(`data-sk="badge"[^>]*>${n}</td>`));
});

test('copy without a token (erased after 46 days): no token card, says where it was', () => {
  const m = emails.copy({ name: 'chetan', token: null, downloadUrl: DL, release });
  assert.ok(!/SIDEKICK-TRIAL-1\./.test(m.text.replace('from SIDEKICK-TRIAL-1', '')));
  assert.ok(!renderEmail(m).html.includes('data-sk="token"'));
});

test('"Sidekick for Android": button to the Play test link, the Google-account line, three steps to install and pair', () => {
  const m = emails.android({ name: 'chetan', release, googleEmail: 'chetan@gmail.com' });
  assert.equal(m.subject, 'Sidekick for Android: your Google Play link');
  assert.match(m.text, /only works with the Google account you entered: chetan@gmail\.com/);
  const { html } = renderEmail(m);
  assert.match(html, new RegExp(`bgcolor="#C6FF33"[^>]*>\\s*<a href="${PLAY.replace(/[.?]/g, '\\$&')}"`));
  assert.equal((html.match(/data-sk="step"/g) || []).length, 3);
  assert.match(m.text, /Scan the code/);
  const none = emails.android({ name: 'chetan', release: { ...release, android: { ...release.android, playTestUrl: null } }, googleEmail: 'chetan@gmail.com' });
  assert.ok(!renderEmail(none).html.includes('bgcolor="#C6FF33"'), 'no button without a Play link');
});

test('confirm-your-email and updates opt-in: their own buttons (double opt-in kept)', () => {
  const c = renderEmail(emails.confirm({ name: 'chetan', confirmUrl: SITE + '/c?t=1', updatesUrl: SITE + '/u?t=2', downloadUrl: DL }));
  assert.match(c.html, /bgcolor="#C6FF33"[^>]*>\s*<a href="https:\/\/sidekickapp\.in\/c\?t=1"[^>]*>Confirm my email<\/a>/);
  assert.match(c.html, /<a href="https:\/\/sidekickapp\.in\/u\?t=2"[^>]*>Yes, send me updates<\/a>/);
  const u = renderEmail(emails.updates({ name: 'chetan', updatesUrl: SITE + '/u?t=2' }));
  assert.match(u.html, /bgcolor="#C6FF33"[^>]*>\s*<a href="https:\/\/sidekickapp\.in\/u\?t=2"[^>]*>Yes, send me updates<\/a>/);
});

test('template rules: tables with role=presentation, inline styles, preheader, dark mode, logo, footer, size', () => {
  for (const m of all()) {
    const { html } = renderEmail(m);
    assert.ok(Buffer.byteLength(html) < 60 * 1024, `${m.kind}: under 60 KB (${Buffer.byteLength(html)})`);
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /<meta name="supported-color-schemes" content="light dark">/);
    assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    for (const t of html.match(/<table\b[^>]*>/g)) assert.match(t, /role="presentation"/, `${m.kind}: ${t}`);
    // Every visible element carries its own style (the <style> block only adds dark-mode and phone overrides).
    for (const el of html.slice(html.indexOf('<body')).match(/<(td|a|p|h1|div|span|img|table)\b[^>]*>/g)) assert.match(el, /style="[^"]+"/, `${m.kind}: inline style on ${el}`);
    assert.match(html, /<div[^>]*style="[^"]*display:none[^"]*"[^>]*>[^<]{10,}/, `${m.kind}: hidden preheader`);
    assert.ok(!/<script|<link|<form|<iframe|javascript:/i.test(html), `${m.kind}: no script, stylesheet link, form or frame`);
    for (const img of html.match(/<img\b[^>]*>/g)) {
      assert.match(img, /alt="[^"]+"/); assert.match(img, /width="\d+"/); assert.match(img, /height="\d+"/);
      assert.match(img, /src="https:\/\/sidekickapp\.in\//);
    }
    assert.ok(html.includes(`src="${LOGO_URL}"`), `${m.kind}: the logo`);
    for (const href of html.match(/href="[^"]*"/g)) assert.match(href, /^href="(https:\/\/|mailto:chetanpujari\.sitit@gmail\.com")/, `${m.kind}: absolute links only: ${href}`);
    assert.match(html, /bgcolor="#F6F3EC"/, 'cream background attribute');
    assert.match(html, /font-family:[^;"]*Arial, sans-serif/, 'web-safe font stack');
    assert.ok(!/font-size:(1[0-5]|[0-9])px;[^"]*" data-sk="body"/.test(html), 'body text is 16px or more');
    assert.match(html, /You got this email because|You get this because/, `${m.kind}: why you got it`);
  }
  for (const m of all().filter(m => m.kind !== 'announce' && m.kind !== 'notify')) assert.match(renderEmail(m).html, /remove me/, `${m.kind}: reply to remove`);
});

test('buttons are bulletproof table cells at least 44 px tall', () => {
  const { html } = renderEmail(emails.copy({ name: 'chetan', token: TOKEN, downloadUrl: DL, release }));
  const a = html.match(/bgcolor="#C6FF33"[^>]*>\s*<a [^>]*style="([^"]+)"/)[1];
  const pad = Number(a.match(/padding:(\d+)px/)[1]), lh = Number(a.match(/line-height:(\d+)px/)[1]);
  assert.ok(2 * pad + lh >= 44, `button height ${2 * pad + lh}px`);
});

test('the renderer escapes everything it is given (a name cannot inject HTML)', () => {
  const m = emails.copy({ name: '<img src=x onerror=alert(1)>', token: TOKEN, downloadUrl: DL, release });
  const { html } = renderEmail(m);
  assert.ok(!html.includes('<img src=x'), 'escaped');
  const a = renderEmail(emails.announce({ subject: 'S', body: 'Hi <b>all</b> & "friends"', unsubscribeUrl: SITE + '/x' }));
  assert.ok(a.html.includes('Hi &lt;b&gt;all&lt;/b&gt; &amp; &quot;friends&quot;'));
  assert.match(a.html, /<a href="https:\/\/sidekickapp\.in\/x"/, 'the unsubscribe link');
});

test('the preview token is a dummy: never token-shaped, so it can never pass for a real one', async () => {
  const { isTokenShaped } = await import('../server/validate.mjs');
  assert.equal(DUMMY_TOKEN, 'SIDEKICK-TRIAL-1.PREVIEW-ONLY');
  assert.equal(isTokenShaped(DUMMY_TOKEN), false);
  const { html } = renderEmail(emails.copy({ name: 'chetan', token: DUMMY_TOKEN, downloadUrl: DL, release }));
  assert.ok(html.includes('data-sk="token"'), 'still shown in a token card in previews');
});
