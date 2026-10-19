// Pre-launch site audit (launch log Part 16): what a visitor of the automated site sees is finished copy. The privacy
// page names its publisher (no DRAFT banner, no file names), the server-rendered and static pages carry no developer
// text and link only to allow-listed places, the claims match the one-click flow, and small page fixes stay fixed.
// The rendered (JavaScript) pages get the same text and link scan in tools/browser-e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripRegions } from '../scripts/site-modes.mjs';
import { linkPage, messagePage, signupFormPage, resultPage, alreadyPage } from '../server/pages.mjs';
import releases from '../data/releases.json' with { type: 'json' };

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const automated = (f) => stripRegions(read(f), 'automated');
const config = (mode) => { const w = {}; vm.runInNewContext(stripRegions(read('data/site-config.js'), mode), { window: w }); return w.SK_CONFIG; };

import { DEV_TEXT, EXTERNAL_OK, ILLUSTRATION } from '../tools/lib/site-rules.mjs';
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
const links = (html) => [...html.matchAll(/\s(?:href|src|action)="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
const external = (u) => /^(https?:|mailto:|\/\/)/.test(u);

test('automated config: the publisher facts are filled in (a placeholder fails); the manual build keeps its own file', () => {
  const c = config('automated');
  for (const k of ['publisher', 'publisherAddress', 'supportEmail', 'policyEffectiveDate']) assert.ok(c[k] && !/^\[/.test(c[k]), `${k} is a placeholder: ${c[k]}`);
  assert.match(c.policyEffectiveDate, /^\d{1,2} [A-Z][a-z]+ 20\d\d$/);
  assert.equal(c.supportEmail, 'chetanpujari.sitit@gmail.com');
  assert.equal(stripRegions(read('data/site-config.js'), 'manual').includes('19 October 2026'), false, 'the manual build is unchanged');
});

test('automated privacy page: a short publisher line, never a file name; the placeholder banner logic stays', () => {
  const s = automated('Support.dc.html');
  assert.ok(s.includes("`Beta privacy notice. Published by ${C.publisher}, ${C.publisherAddress}. Last updated ${C.policyEffectiveDate}. Questions: ${email}.`"));
  assert.ok(s.includes('policyDraft = [C.publisher, C.publisherAddress, C.supportEmail, C.policyEffectiveDate].some(unset)'), 'a placeholder still turns the banner on');
  assert.ok(!/'[^']*data\/site-config[^']*' : ''/.test(s.replace(/'DRAFT — [^']*' : ''/, '')) && s.includes("'Draft: this notice is still being finalised.' ||"), 'the automated banner text names no file');
});

test('server-rendered pages and static automated pages: no developer text, only allow-listed outside links, a favicon', () => {
  const R = JSON.parse(JSON.stringify(releases));
  const pages = {
    ...Object.fromEntries(['confirm', 'updates', 'access', 'unsubscribe'].flatMap(p => [[`link ${p}`, linkPage({ purpose: p, nonce: 'n', siteKey: 'k', valid: true })], [`link ${p} expired`, linkPage({ purpose: p, nonce: 'n', siteKey: 'k', valid: false })]])),
    message: messagePage({ nonce: 'n', title: 'On its way', text: 'We\'ll email you a copy.' }).body,
    form: signupFormPage({ nonce: 'n', siteKey: 'k', errors: { name: 'Enter your name.' } }),
    result: resultPage({ nonce: 'n', firstName: 'Ada', token: 'SIDEKICK-TRIAL-1.abc.def', download: { url: '/download/mac', auto: true, file: R.mac.builds.arm64.file, bytes: R.mac.builds.arm64.bytes, sha256: R.mac.builds.arm64.sha256 }, release: R, android: 'manual-batch' }),
    already: alreadyPage({ nonce: 'n' })
  };
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(!DEV_TEXT.test(visible(html)), `${name}: ${visible(html).match(DEV_TEXT)}`);
    assert.ok(html.includes('<link rel="icon" href="/favicon.ico"'), `${name}: favicon`);
    for (const u of links(html).filter(external)) assert.ok(EXTERNAL_OK.some(r => r.test(u)), `${name}: outside link ${u}`);
  }
  for (const f of ['check-email.html', '404.html', '404.dc.html', 'Home.dc.html', 'Get Sidekick.dc.html', 'Download.dc.html', 'Beta.dc.html', 'Roadmap.dc.html', 'Support.dc.html']) {
    const html = automated(f).replace(/\{\{[^}]*\}\}/g, ' '); // the page runtime's own templates
    const text = visible(html).replace(ILLUSTRATION, '');
    assert.ok(!DEV_TEXT.test(text), `${f}: ${text.match(DEV_TEXT)}`);
    for (const u of links(html).filter(external)) assert.ok(EXTERNAL_OK.some(r => r.test(u)), `${f}: outside link ${u}`);
  }
});

test('404.html (automated): no inline script the CSP would block; it forwards with a meta refresh and has a favicon', () => {
  const h = automated('404.html');
  assert.ok(!/<script>[^<]/.test(h), 'no inline script');
  assert.ok(h.includes('<meta http-equiv="refresh" content="0; url=/404.dc.html">') && h.includes('name="viewport"') && h.includes('rel="icon"'));
  assert.ok(stripRegions(read('404.html'), 'manual').includes("<script>location.replace('/404.dc.html');</script>"), 'manual build unchanged');
});

test('public automated pages have a meta description', () => {
  for (const f of ['Home.dc.html', 'Get Sidekick.dc.html', 'Roadmap.dc.html', 'Support.dc.html']) assert.match(automated(f), /<meta name="description" content="[^"]{40,}">/, f);
});

test('claims match the one-click flow in automated mode (Android by Play test invitation; token on the page)', () => {
  const home = automated('Home.dc.html'), sup = automated('Support.dc.html');
  assert.ok(!home.includes('If you were invited, the person who invited you sends you a private download link and your beta token.'), 'Home call to action');
  const ANDROID = 'by invitation through Google Play testing';
  assert.ok(home.includes(ANDROID) && sup.includes(ANDROID), 'Android wording');
  for (const s of ['(!manual && "No. There\'s nothing to sign in to in either app. For the beta you fill in a short form: the Mac app downloads right away and your beta token is on the page.', "(!manual && 'The Mac app asks for a beta token the first time it opens. It is on the page right after the Get Sidekick form",
    "(!invite && '— the Mac app from the Get Sidekick form (it downloads right away). ' + androidLine)", "(!invite && '— it is on the page right after the Get Sidekick form.')", "(!invite && 'Use the token shown on the page right after the Get Sidekick form"])
    assert.ok(home.includes(s) || sup.includes(s), s);
  assert.ok(!/\b(25|50) (people|places|testers|spots)\b/.test(home + sup), 'no beta size number');
});

test('Turnstile: compact in a container narrower than its 300 px widget (the Roadmap card at 375 px)', async () => {
  const src = read('data/api-client.js');
  const renders = [];
  const run = async (width) => {
    const w = { SK_CONFIG: { turnstileSiteKey: '0x4AAAAAAAreal-looking-key' }, turnstile: { render: (el, o) => { renders.push(o.size || 'normal'); return 1; }, remove() {} } };
    vm.runInNewContext(src, { window: w, document: {}, fetch: () => {} });
    w.SK_BOT.ensure({}, { clientWidth: width, textContent: '' });
    await new Promise(r => setTimeout(r, 0));
  };
  await run(255); await run(330);
  assert.deepEqual(renders, ['compact', 'normal']);
});
