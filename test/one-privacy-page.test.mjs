// One privacy page (launch log Part 15): in automated mode no visitor-facing page links the owner's external privacy
// page; the footer's "Privacy" goes to this site's Support › Privacy, the page the sign-up form's required box links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stripRegions } from '../scripts/site-modes.mjs';

const ROOT = new URL('../', import.meta.url);
const EXTERNAL = /chetan-website-delta|vercel\.app\/sidekick/;
const pages = execFileSync('git', ['ls-files', '*.html', 'data/*.js', 'server/*.mjs'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

test('no automated page, script or server page links the external privacy page', () => {
  assert.ok(pages.length > 20, `only ${pages.length} files found`);
  const hits = pages.filter(f => EXTERNAL.test(stripRegions(fs.readFileSync(new URL(f, ROOT), 'utf8'), 'automated')));
  assert.deepEqual(hits, []);
});

test('the automated footer\'s Privacy link is Support.dc.html#privacy, like the form\'s', () => {
  const footer = stripRegions(fs.readFileSync(new URL('SiteFooter.dc.html', ROOT), 'utf8'), 'automated');
  assert.match(footer, /manual \? L\('Privacy','Support\.dc\.html#privacy'\) : \( *L\('Privacy','Support\.dc\.html#privacy'\) *\?\? *null\)/);
  assert.ok(fs.readFileSync(new URL('Get Sidekick.dc.html', ROOT), 'utf8').includes('<a href="Support.dc.html#privacy"'));
});
