// The one-click pages say the same as the server (launch log Part 7): the three install steps and the Android line of
// the result, the single "Get the Mac app" button, the one-line Android note, and Drive only as the fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SHORT_STEPS } from '../server/emails.mjs';
import { ANDROID_TEXT, signupFormHtml } from '../server/pages.mjs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Get Sidekick: the result page\'s three steps and Android lines are the server\'s, word for word', () => {
  const page = read('Get Sidekick.dc.html');
  const steps = page.match(/static STEPS = (\(file\) => \[[\s\S]*?\n {2}\]);/);
  const android = page.match(/static ANDROID = (\{[\s\S]*?\n {2}\});/);
  assert.ok(steps && android, 'the page defines STEPS and ANDROID');
  const plain = (x) => JSON.parse(JSON.stringify(x)); // values from another vm realm
  assert.deepEqual(plain(vm.runInNewContext(`(${steps[1]})`)('X.dmg')), SHORT_STEPS('X.dmg'));
  assert.deepEqual(plain(vm.runInNewContext(`(${android[1]})`)), ANDROID_TEXT);
});

test('Get Sidekick: one button "Get the Mac app", the one-line Android note, no chip question, Enter guard kept', () => {
  const page = read('Get Sidekick.dc.html');
  assert.ok(page.includes("'Get the Mac app'"));
  assert.ok(page.includes("Android: join the Google Play test, we\\'ll email you the link.") && page.includes("Android: join the Google Play test, we'll email you the link."));
  assert.ok(!/Your Mac's chip|name="macChip"/.test(page));
  assert.ok(page.includes('onKeyDown="{{ noEnter }}"') && page.includes('<button type="submit" disabled="{{ true }}" hidden="{{ true }}"'), 'Part 6 keyboard fix kept');
  assert.ok(page.includes('href="/download/mac"'), 'the result page links to /download/mac');
  assert.ok(page.includes('>More details</summary>'));
  assert.ok(!/drive\.google\.com/.test(page), 'no Drive address in the page itself (it comes from releases.js, as the fallback)');
  const noJs = signupFormHtml();
  assert.ok(noJs.includes('>Get the Mac app</button>') && noJs.includes('name="android"') && !noJs.includes('name="macChip"'));
});

test('Download page and check-email: the download is a normal /download/mac link (works without JavaScript)', () => {
  assert.match(read('Download.dc.html'), /<a id="dl-mac" href="\/download\/mac"/);
  assert.match(read('check-email.html'), /<a href="\/download\/mac">download the Mac app<\/a>/);
});
