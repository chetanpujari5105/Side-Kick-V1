// Short content on the pages (launch log Part 11): the result page, the Download page and the Beta page (automated
// site) stop offering the Drive folder and the "full steps" link; the checksum stays only under "More details"; first
// names are capitalised. The manual site is unchanged (its build stays byte-identical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, ORIGIN, poolToken } from './helpers.mjs';
import { stripRegions } from '../scripts/site-modes.mjs';
import releasesJson from '../data/releases.json' with { type: 'json' };

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SHA = releasesJson.mac.builds.arm64.sha256;
const CAP = 'XXXX.DUMMY.TOKEN.XXXX';

async function instant(form) {
  const h = setup();
  await h.admin('/api/admin/pool-add', { tokens: [poolToken(h.clock.now())] }, { key: 'signer' });
  return { h, res: await h.call('POST', '/api/get-sidekick', form ? { form: { name: 'asha rao', email: 'asha@example.com', privacyAccepted: 'on', 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN } } : { json: h.signupBody({ name: 'asha rao', email: 'asha@example.com' }), headers: { origin: ORIGIN } }) };
}

test('first names are capitalised on the pages: the API answer and the no-JS result page', async () => {
  const j = await instant(false);
  assert.equal((await j.res.json()).firstName, 'Asha');
  const p = await instant(true);
  const html = await p.res.text();
  assert.match(html, /<h1>You(&#39;|')re in, Asha\.<\/h1>/);
  const gs = read('Get Sidekick.dc.html');
  assert.match(gs, /resName: Component\.cap\(res\.firstName \|\| ''\)/, 'the JS result page capitalises too');
  assert.match(read('Download.dc.html'), /name: s \? Component\.cap\(\(s\.name \|\| ''\)\.split\(' '\)\[0\]\) : ''/);
});

test('result page (no JS): one download link, three steps, the checksum only under More details, no Drive', async () => {
  const html = await (await instant(true)).res.text();
  assert.ok(!/drive\.google\.com|Google Drive/.test(html), 'no Drive');
  const det = html.slice(html.indexOf('<details>'), html.indexOf('</details>'));
  assert.ok(det.includes(SHA), 'checksum under More details');
  assert.equal(html.split(SHA).length, 2, 'and nowhere else');
  assert.ok(!/Support\.dc\.html#setup|full steps/i.test(html), 'no full-steps link');
});

test('result page (JS): no Drive fallback, checksum only inside More details', () => {
  const gs = read('Get Sidekick.dc.html');
  const block = gs.slice(gs.indexOf('<sc-if value="{{ isIn }}">'), gs.indexOf('<sc-if value="{{ showForm }}"'));
  assert.ok(!/resDrive|Google Drive/.test(gs), 'no Drive on the page');
  const det = block.slice(block.indexOf('<details'), block.indexOf('</details>'));
  assert.ok(det.includes('{{ resSha }}') && block.split('{{ resSha }}').length === 2);
});

test('Download page: the checksum moves under More details; no Drive, no full-steps link', () => {
  const d = read('Download.dc.html');
  const det = d.slice(d.indexOf('<details id="more-details"'), d.indexOf('</details>'));
  assert.match(det, /<summary[^>]*>More details<\/summary>/);
  assert.ok(det.includes('{{ mac.sha }}'));
  assert.equal(d.split('{{ mac.sha }}').length - 1, det.split('{{ mac.sha }}').length - 1, 'the checksum only there');
  assert.ok(!/drive\.google|Google Drive|betaDriveUrl/.test(d));
});

test('Beta page (automated site): the direct download is the main button; no Drive, no SHA-256, no full-steps link; three steps', () => {
  const src = read('Beta.dc.html');
  const auto = stripRegions(src, 'automated');
  const block = auto.slice(auto.indexOf('<!-- NOSCRIPT:BETA-AUTOMATED'), auto.indexOf('<!-- /NOSCRIPT:BETA-AUTOMATED'));
  assert.ok(block.includes('<a href="/download/mac"'));
  assert.ok(!/drive\.google|SHA-256|shasum|Full setup guide|Support\.dc\.html/.test(block), 'no Drive, checksum or full-steps link');
  assert.equal((block.match(/<li>/g) || []).length, 3, 'three install steps');
  const js = auto.slice(auto.indexOf('<div data-js-only'), auto.indexOf('<!-- NOSCRIPT'));
  assert.ok(!/Full setup guide|t\.fallbackUrl|t\.checkTitle/.test(js), 'the JS page drops them too');
  assert.match(auto, /fallbackUrl: null, sha: null/);
  // The manual site keeps its own Beta page exactly (Drive is how it shares the file).
  assert.ok(stripRegions(src, 'manual').includes('Open the download folder (Google Drive)'));
});

test('privacy (automated): the Mac app is downloaded from GitHub; emails go out through our own Gmail', () => {
  const s = stripRegions(read('Support.dc.html'), 'automated');
  const auto = s.slice(s.indexOf("S('This website'"), s.indexOf("S('Who we are'"));
  const text = auto.slice(auto.indexOf(': [\n          \'This website runs no analytics'));
  assert.ok(!/Google Drive/.test(text), 'no Drive in the automated privacy text');
  assert.match(text, /downloads from this project\\?'s release on GitHub/);
  assert.match(text, /through Gmail/);
  // Manual privacy text unchanged.
  assert.ok(stripRegions(read('Support.dc.html'), 'manual').includes('The Mac app is shared from our Google Drive'));
});

test('the server-side Drive fallback of /download/mac stays (directUrl null), never shown to visitors', async () => {
  const r = JSON.parse(JSON.stringify(releasesJson)); r.mac.directUrl = null;
  const h = setup({ releases: r });
  const res = await h.call('GET', '/download/mac');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), releasesJson.mac.betaDriveUrl);
});
