// Every internal link, fragment and email link form resolves (tools/check-links.mjs, offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks } from '../tools/check-links.mjs';

test('links: every internal link and every email link form resolves on the built site', async () => {
  const { rows, failures, checked } = await checkLinks();
  assert.ok(checked > 100, `only ${checked} links found: the extractor broke`);
  assert.ok(rows.some(r => r.area === 'email' && /access: page script reads/.test(r.what)), 'email walk ran');
  // The unlisted Beta page: noindex/nofollow, linked from nowhere, only the release-facts links, no APK.
  const beta = rows.filter(r => r.area === 'beta').map(r => r.what);
  for (const want of [/robots noindex, nofollow in the static <head>/, /X-Robots-Tag/, /no other file in dist\/ names it/, /no server page names it/, /no email names it/,
    /exactly the Drive and Play test links/, /no \.apk anywhere/, /SHA-256 from releases\.json/, /Download\.dc\.html carries neither/])
    assert.ok(beta.some(w => want.test(w)), `beta check missing: ${want}`);
  assert.deepEqual(failures.map(f => `${f.area} ${f.what} ${f.note}`), []);
});
