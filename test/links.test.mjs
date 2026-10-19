// Every internal link, fragment, email link form and mailto resolves (tools/check-links.mjs, offline), in both
// SITE_MODEs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { checkLinks, mailtoProblem } from '../tools/check-links.mjs';

after(() => execFileSync(process.execPath, ['scripts/build-site.mjs', '--local'], { stdio: 'ignore' }));

const BETA_CHECKS = [/robots noindex, nofollow in the static <head>/, /X-Robots-Tag/, /no other file in dist\/ names it/, /no server page names it/,
  /no \.apk anywhere/, /Download\.dc\.html carries neither/];
// The manual site shares the file through Drive with its checksum; the automated one does not (launch log Part 11).
const BETA_MANUAL = [/exactly the Drive and Play test links/, /SHA-256 from releases\.json/];
const BETA_AUTOMATED = [/exactly the Play test link/, /no SHA-256 and no Drive folder/];

test('links (automated): every internal link and every email link form resolves on the built site', async () => {
  const { rows, failures, checked, external } = await checkLinks({ mode: 'automated' });
  assert.ok(checked > 100, `only ${checked} links found: the extractor broke`);
  assert.ok(rows.some(r => r.area === 'email' && /access: page script reads/.test(r.what)), 'email walk ran');
  // The unlisted Beta page: noindex/nofollow, linked from nowhere, only the release-facts links, no APK.
  const beta = rows.filter(r => r.area === 'beta').map(r => r.what);
  for (const want of [...BETA_CHECKS, ...BETA_AUTOMATED, /no email names it/]) assert.ok(beta.some(w => want.test(w)), `beta check missing: ${want}`);
  assert.ok(rows.some(r => r.area === 'email' && /\(HTML\): image \/email\/logo\.png/.test(r.what)), 'the HTML emails\' logo is served');
  assert.ok(!external.some(u => /chetan-website-delta/.test(u)), 'automated mode does not link the external privacy page (Part 15)');
  assert.deepEqual(failures.map(f => `${f.area} ${f.what} ${f.note}`), []);
});

test('links (manual): every internal link resolves, every mailto is ours, and the Beta page is still unlisted', async () => {
  const { rows, failures, checked, external } = await checkLinks({ mode: 'manual' });
  assert.ok(checked > 80, `only ${checked} links found: the extractor broke`);
  assert.ok(!rows.some(r => r.area === 'email' || r.area === 'server' || r.area === 'redirect'), 'no API sections in manual mode');
  const beta = rows.filter(r => r.area === 'beta').map(r => r.what);
  for (const want of [...BETA_CHECKS, ...BETA_MANUAL]) assert.ok(beta.some(w => want.test(w)), `beta check missing: ${want}`);
  const manual = rows.filter(r => r.area === 'manual').map(r => r.what);
  for (const want of [/Get Sidekick\.dc\.html: the request-access email/, /Download\.dc\.html: the request-access email/, /Roadmap\.dc\.html: the suggestion email/, /Notify link/, /Beta by invitation/, /consent/])
    assert.ok(manual.some(w => want.test(w)), `manual check missing: ${want}`);
  assert.ok(!external.some(u => /chetan-website-delta/.test(u)), 'manual mode does not link the external privacy page');
  assert.deepEqual(failures.map(f => `${f.area} ${f.what} ${f.note}`), []);
});

test('mailtoProblem: only our address, only subject and body, percent-encoded', () => {
  const to = 'owner@example.com';
  assert.equal(mailtoProblem('mailto:owner@example.com', to), '');
  assert.equal(mailtoProblem('mailto:owner@example.com?subject=Hi%20there&body=a%0D%0Ab', to), '');
  assert.match(mailtoProblem('mailto:someone@else.com?subject=x', to), /addressed to/);
  assert.match(mailtoProblem('mailto:owner@example.com?cc=x@y.com&subject=x', to), /unexpected field cc/);
  assert.match(mailtoProblem('mailto:owner@example.com?subject=two words', to), /not percent-encoded/);
  assert.match(mailtoProblem('https://example.com', to), /not a mailto/);
});
