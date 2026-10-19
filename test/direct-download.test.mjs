// The direct download (launch log Part 8): once mac.directUrl is verified, the result page starts the download by
// itself in a hidden frame and never navigates away from the page that shows the token; "Download again" stays; without
// JavaScript it is a normal link; Drive is named only "if the download fails"; /download/mac answers 302 to the asset;
// the Android note shows once on the form and once on the result; every email downloads through /download/mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setup, ORIGIN, poolToken } from './helpers.mjs';
import { emails } from '../server/emails.mjs';
import releasesJson from '../data/releases.json' with { type: 'json' };

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const CAP = 'XXXX.DUMMY.TOKEN.XXXX';
const DIRECT = 'https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/v2.0.1/Sidekick-2.0.1-arm64.dmg';
const DRIVE = releasesJson.mac.betaDriveUrl;
const withDirect = () => { const r = JSON.parse(JSON.stringify(releasesJson)); r.mac.directUrl = DIRECT; return r; };
const noDirect = () => { const r = JSON.parse(JSON.stringify(releasesJson)); r.mac.directUrl = null; return r; };
const page = () => read('Get Sidekick.dc.html');
// The result block of the JavaScript page (what a visitor sees after "You're in").
const resultBlock = () => { const p = page(); return p.slice(p.indexOf('<sc-if value="{{ isIn }}">'), p.indexOf('<sc-if value="{{ showForm }}"')); };
const formBlock = () => { const p = page(); return p.slice(p.indexOf('<sc-if value="{{ showForm }}"'), p.indexOf('</form>')); };
const noJsResult = async (releases) => {
  const h = setup(releases ? { releases } : {});
  await h.admin('/api/admin/pool-add', { tokens: [poolToken(h.clock.now())] }, { key: 'signer' });
  const res = await h.call('POST', '/api/get-sidekick', { form: { name: 'Asha Rao', email: 'asha@example.com', privacyAccepted: 'on', android: 'on', phoneModel: 'Pixel 8', googleEmail: 'asha.rao@gmail.com', 'cf-turnstile-response': CAP }, headers: { origin: ORIGIN } });
  assert.equal(res.status, 200);
  return (await res.text()).replace(/&#39;/g, "'");
};

// A stand-in document: records what the page's auto-start does, and fails the test if it touches the location.
const fakeDoc = () => {
  const made = [];
  const nav = () => { throw new Error('navigated away from the page with the token'); };
  const doc = {
    made,
    createElement: (tag) => { const el = { tag, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }; made.push(el); return el; },
    body: { children: [], appendChild(el) { this.children.push(el); return el; } },
    get location() { return { assign: nav, replace: nav, set href(_) { nav(); } }; },
    set location(_) { nav(); }
  };
  return doc;
};
const autoStart = () => {
  const m = page().match(/static AUTO_DOWNLOAD = (\(url, doc\) => \{[\s\S]*?\n {2}\});/);
  assert.ok(m, 'the page defines AUTO_DOWNLOAD(url, doc)');
  return vm.runInNewContext(`(${m[1]})`);
};

test('(a) with a verified direct URL the JavaScript result page starts the download by itself, in a hidden frame', () => {
  const doc = fakeDoc();
  autoStart()('/download/mac', doc);
  const frames = doc.body.children.filter(el => el.tag === 'iframe');
  assert.equal(frames.length, 1, 'one hidden frame');
  assert.equal(frames[0].src, '/download/mac', 'it loads /download/mac (302 to the asset)');
  assert.ok(frames[0].hidden === true || frames[0].style.display === 'none', 'not visible');
  assert.match(page(), /if \(r\.download && r\.download\.auto\) this\.dlTimer = setTimeout\(\(\) => Component\.AUTO_DOWNLOAD\(r\.download\.url, document\), 1500\);/,
    'used only when the API says auto (a verified direct URL)');
  assert.match(resultBlock(), /<sc-if value="\{\{ resAuto \}\}"><a id="dl-again" href="\/download\/mac"[^>]*>Download again<\/a><\/sc-if>/, '"Download again" stays visible');
});

test('(a) the frame may follow /download/mac → github.com → GitHub\'s file host (static page CSP)', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const csp = vercel.headers.find(h => h.source === '/((?!api/).*)').headers.find(x => x.key === 'Content-Security-Policy').value;
  const frameSrc = (csp.match(/frame-src ([^;]+)/) || [])[1].split(' ');
  for (const s of ["'self'", 'https://github.com', 'https://release-assets.githubusercontent.com', 'https://objects.githubusercontent.com', 'https://challenges.cloudflare.com']) assert.ok(frameSrc.includes(s), `frame-src has ${s}`);
  assert.match(csp, /frame-ancestors 'none'/, 'nobody may frame our pages');
});

test('(a) without JavaScript the result page has a normal download link and starts nothing by itself', async () => {
  const html = await noJsResult(withDirect());
  assert.ok(!html.includes('http-equiv="refresh"'), 'no meta refresh');
  assert.match(html, /<a class="btn" href="\/download\/mac" target="_blank" rel="noopener">Download the Mac app<\/a>/);
  assert.ok(!html.includes('starts in a moment'), 'it does not promise an automatic start');
});

test('(b) the download never navigates away from the page that shows the token', async () => {
  const doc = fakeDoc();
  assert.doesNotThrow(() => autoStart()('/download/mac', doc), 'the auto-start leaves the location alone');
  const p = page();
  assert.ok(!/location\.href = r\.download|location\.(assign|replace)\(r\.download/.test(p), 'no top-level navigation to the download');
  for (const a of resultBlock().match(/<a [^>]*href="\/download\/mac"[^>]*>/g)) assert.match(a, /target="_blank" rel="noopener"/, `JS result: ${a}`);
  for (const html of [await noJsResult(withDirect()), await noJsResult(noDirect())]) {
    assert.ok(!html.includes('http-equiv="refresh"'));
    for (const a of html.match(/<a [^>]*href="\/download\/mac"[^>]*>/g)) assert.match(a, /target="_blank" rel="noopener"/, `no-JS result: ${a}`);
  }
});

test('(c) the result pages never show the Drive folder (short content, launch log Part 11); /download/mac falls back by itself', async () => {
  assert.ok(!/resDrive|Google Drive/.test(resultBlock()), 'no Drive link on the JS result page');
  for (const html of [await noJsResult(withDirect()), await noJsResult(noDirect())]) assert.ok(!html.includes(DRIVE) && !/Google Drive/.test(html), 'nor on the no-JS one');
});

test('(d) GET and HEAD /download/mac answer 302 to the verified asset (the Vercel rewrite form too)', async () => {
  const h = setup({ releases: withDirect() });
  for (const [m, p] of [['GET', '/download/mac'], ['HEAD', '/download/mac'], ['GET', '/api/index?__route=download-mac']]) {
    const r = await h.call(m, p);
    assert.equal(r.status, 302, `${m} ${p}`);
    assert.equal(r.headers.get('location'), DIRECT);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.ok(JSON.parse(read('vercel.json')).rewrites.some(r => r.source === '/download/mac' && r.destination === '/api/index?__route=download-mac'));
});

test('(e) the Android note appears exactly once on the form and once on the result page', async () => {
  const note = "Android: join the Google Play test, we'll email you the link.";
  const p = page();
  const shown = (s) => s.split(note).length - 1 + s.split(note.replace("'", "\\'")).length - 1;
  assert.equal(shown(p), 1, 'the page source holds the form note once');
  assert.equal(shown(formBlock()), 1, 'on the form, under the Android box');
  const res = resultBlock();
  assert.equal((res.match(/\{\{ resAndroid \}\}/g) || []).length, 2, 'the result: one line (sc-if + its text)');
  assert.equal(shown(res), 0);
  const html = await noJsResult(withDirect());
  assert.equal(html.split('Android: ').length - 1, 1, 'the no-JS result page: one Android line');
});

test('(f) every email that offers the Mac app links /download/mac; none names the Drive folder', () => {
  const downloadUrl = ORIGIN + '/download/mac', release = releasesJson;
  const all = [
    emails.confirm({ name: 'Asha', confirmUrl: ORIGIN + '/c', downloadUrl }),
    emails.access({ name: 'Asha', downloadUrl }),
    emails.copy({ name: 'Asha', token: 'SIDEKICK-TRIAL-1.x.y', downloadUrl, release }),
    emails.invite({ name: 'Asha', downloadUrl, release, googleEmail: 'a@gmail.com' }),
    emails.invite({ name: 'Asha', downloadUrl, release })
  ];
  for (const m of all) {
    assert.ok(m.text.includes('\n' + downloadUrl + '\n'), `${m.kind}: /download/mac on its own line`);
    assert.ok(!m.text.includes(DRIVE) && !/Google Drive/.test(m.text), `${m.kind}: no Drive`);
  }
  for (const k of ['token', 'updates', 'android', 'waitlist']) assert.ok(!(emails[k].toString().includes('betaDriveUrl')), `${k}: no Drive`);
});

test('(d) the release tag is v<version> or sidekick-mac-<version> of this version; nothing else', async () => {
  const { releaseProblems } = await import('../server/releases.mjs');
  const base = 'https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/';
  const at = (tag, file = 'Sidekick-2.0.1-arm64.dmg') => { const r = withDirect(); r.mac.directUrl = base + tag + '/' + file; return releaseProblems(r).filter(p => p.startsWith('mac.directUrl')); };
  assert.deepEqual(at('v2.0.1'), []);
  assert.deepEqual(at('sidekick-mac-2.0.1'), []);
  for (const tag of ['v2.0.2', 'sidekick-mac-2.0.2', 'sidekick-mac-v2.0.1', 'latest', 'sidekick-2.0.1', 'untagged-1f371627e9ee170df609']) assert.equal(at(tag).length, 1, tag);
  assert.equal(at('sidekick-mac-2.0.1', 'Sidekick-2.0.1.dmg').length, 1, 'the arm64 file only');
});

test('(d) releases.json: mac.directUrl is the verified sidekick-mac-2.0.1 asset (launch log P8R2)', () => {
  assert.equal(releasesJson.mac.directUrl, 'https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/sidekick-mac-2.0.1/Sidekick-2.0.1-arm64.dmg');
  assert.equal(releasesJson.mac.builds.arm64.bytes, 121668061);
  assert.equal(releasesJson.mac.builds.arm64.sha256, 'a03b3390db4a81b1602deefd25825c16d0b72dc654c7a45ba52f9d5834f71284');
});
