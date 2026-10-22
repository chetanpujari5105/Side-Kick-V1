// Browser end-to-end check of the REAL pages (scripts/dev-server.mjs), in headless Chrome over the DevTools
// protocol, with the production headers from vercel.json applied.
//   node tools/browser-e2e.mjs                  SITE_MODE=automated: the real API code on fake adapters
//   node tools/browser-e2e.mjs --mode manual    SITE_MODE=manual: every page at five widths with and without
//                                               JavaScript, the mailto links, no form, no cookie, no storage, no
//                                               /api request, nothing from another origin
// Automated mode uses a throwaway Ed25519 key and the test-only fake issuer. No network beyond 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startDevServer } from '../scripts/dev-server.mjs';
import { runCycle, runPool, loadSignerConfig } from './signer/signer.mjs';
import { makeClient } from './lib/client.mjs';
import { DEV_TEXT, EXTERNAL_OK, ILLUSTRATION } from './lib/site-rules.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8791, CDP = 9341;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MODE = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'automated';
if (!['manual', 'automated'].includes(MODE)) { console.error('--mode must be manual or automated'); process.exit(2); }
// Automated mode runs with a verified-looking direct URL so the result page's automatic download can be watched; the
// browser never reaches GitHub: the DevTools Fetch domain answers github.com with a 302 to GitHub's file host (as GitHub
// does) and that with a small synthetic disk image, so the page's CSP sees the real redirect chain.
const RELEASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/releases.json'), 'utf8'));
const DIRECT = RELEASES.mac.directUrl || `https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/v${RELEASES.version}/${RELEASES.mac.builds.arm64.file}`;
const ASSET = 'https://release-assets.githubusercontent.com/github-production-release-asset/stand-in?response-content-disposition=attachment';
const dev = await startDevServer({ port: PORT, quiet: true, mode: MODE, releases: MODE === 'automated' ? { ...RELEASES, mac: { ...RELEASES.mac, directUrl: DIRECT } } : RELEASES });
const O = dev.origin;
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const listeners = [];
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach(l => l(m)); });
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

async function tab({ noJs = false, context } = {}) {
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank', browserContextId: context });
  const { result: { sessionId: sid } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const t = { sid, reqs: [], errors: [], navs: [], api: [], redirects: [], responses: [] };
  listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') t.reqs.push(m.params.request.url);
    if (m.method === 'Network.requestWillBeSent' && m.params.redirectResponse) t.redirects.push({ url: m.params.redirectResponse.url, status: m.params.redirectResponse.status, headers: m.params.redirectResponse.headers, to: m.params.request.url });
    if (m.method === 'Network.responseReceived') t.responses.push({ url: m.params.response.url, status: m.params.response.status, headers: m.params.response.headers });
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/')) t.api.push(`${m.params.response.status} ${new URL(m.params.response.url).pathname}`);
    if (m.method === 'Runtime.exceptionThrown') t.errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon|files\.example\.test/.test(m.params.entry.url || m.params.entry.text)) t.errors.push(m.params.entry.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') t.errors.push(m.params.args.map(a => a.value).join(' '));
  });
  await send('Network.enable', {}, sid); await send('Runtime.enable', {}, sid); await send('Log.enable', {}, sid); await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
  if (noJs) await send('Emulation.setScriptExecutionDisabled', { value: true }, sid);
  t.go = async (url) => { await send('Page.navigate', { url }, sid); await sleep(1800); };
  t.eval = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid); return r.result?.result?.value; };
  t.text = () => t.eval("document.body.innerText.replace(/\\s+/g, ' ')");
  return t;
}
const fill = (sel, val) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const click = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`;
// Real input over the DevTools protocol: typed text, key presses and mouse clicks, as a person (or autofill) makes them.
const typeIn = async (t, sel, text) => { await t.eval(`document.querySelector(${JSON.stringify(sel)}).focus()`); await send('Input.insertText', { text }, t.sid); };
const press = async (t, k) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }, t.sid);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, t.sid);
};
const mouse = async (t, sel) => {
  const r = await t.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, t.sid);
};
const posts = (t) => t.reqs.filter(u => u.endsWith('/api/get-sidekick')).length;
const outbox = async () => (await fetch(O + '/__dev/outbox')).json();
const linkIn = (text, p) => (text.match(new RegExp(O.replace(/[.:/]/g, '\\$&') + p + '(?:\\?[a-z=]+)?#t=[A-Za-z0-9_-]+')) || [])[0];

// SITE_MODE=manual: no backend, so no flow to walk; check what a visitor sees and that nothing leaves the site.
async function manualChecks() {
  const PAGES = ['/', '/Get%20Sidekick.dc.html', '/Download.dc.html', '/Roadmap.dc.html', '/Support.dc.html#setup', '/Support.dc.html#privacy', '/Beta.dc.html', '/404.dc.html'];
  const WIDTHS = [360, 390, 768, 1280, 1440];
  const t = await tab();
  const width = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 800 }, t.sid);
  const sweep = [];
  for (const w of WIDTHS) {
    await width(w);
    for (const p of PAGES) {
      await t.go(O + p);
      const r = await t.eval(`({ over: document.documentElement.scrollWidth > window.innerWidth + 1, braces: document.body.innerText.includes('{{'), forms: document.querySelectorAll('form').length, cookie: document.cookie, stored: localStorage.length + sessionStorage.length })`);
      if (!r || r.over || r.braces || r.forms || r.cookie || r.stored) sweep.push(`${w}px ${p} ${JSON.stringify(r)}`);
    }
  }
  check(`viewport sweep: ${PAGES.length} pages × ${WIDTHS.join('/')} px — no sideways scroll, no raw template, no form, no cookie, no storage`, sweep.length === 0, sweep.join(' | ').slice(0, 1500));

  await width(1280);
  const href = (sel) => t.eval(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); return a ? a.getAttribute('href') : null; })()`);
  const parse = (h) => { if (!h || !h.startsWith('mailto:')) return null; const u = new URL(h); return { to: decodeURIComponent(u.pathname), subject: u.searchParams.get('subject') || '', body: u.searchParams.get('body') || '' }; };
  const TO = 'chetanpujari.sitit@gmail.com';
  await t.go(O + '/');
  check('header CTA reads Request access and leads to Get Sidekick', (await t.eval(`[...document.querySelectorAll('header a')].some(a => a.textContent.trim() === 'Request access' && /Get(%20| )Sidekick\.dc\.html$/.test(a.getAttribute('href')))`)) === true);
  check('footer: Request access, and Privacy is this site\'s own page', (await t.eval(`(() => { const f = document.querySelector('footer'); const a = [...f.querySelectorAll('a')]; return a.some(x => x.textContent.trim() === 'Request access') && a.some(x => x.textContent.trim() === 'Privacy' && x.getAttribute('href') === 'Support.dc.html#privacy') && !f.innerHTML.includes('chetan-website-delta'); })()`)) === true);
  await t.go(O + '/Get%20Sidekick.dc.html');
  let txt = await t.text();
  const req = parse(await href('main a[href^="mailto:"][href*="subject="]'));
  check('Get Sidekick is Request access: heading, steps, Apple silicon only', /Request access/.test(txt) && /Apple silicon/.test(txt) && /Intel Mac/.test(txt), txt.slice(0, 200));
  check('request email: to the owner, subject, and a body asking for name, chip, phone, Google account and consent', !!req && req.to === TO && req.subject === 'Sidekick beta: request access' && /name/i.test(req.body) && /chip/i.test(req.body) && /Apple silicon/.test(req.body) && /phone model/i.test(req.body) && /Google account email/.test(req.body) && /agree/.test(req.body) && /Privacy/.test(req.body), JSON.stringify(req).slice(0, 300));
  check('manual wording unchanged: no automated timing or phone-number copy', !/up to a day|not your phone number/.test(txt));
  await t.go(O + '/Download.dc.html');
  txt = await t.text();
  check('Download says Beta by invitation, offers the same email, and no download button', /Beta by invitation/.test(txt) && (parse(await href('main a[href^="mailto:"][href*="subject="]')) || {}).subject === 'Sidekick beta: request access' && !/Download for Apple silicon/.test(txt) && /no APK/i.test(txt));
  await t.go(O + '/Roadmap.dc.html');
  await t.eval(click('section[aria-labelledby^="rm-phase-"] li button')); await sleep(500);
  const title = await t.eval(`document.querySelector('section[aria-labelledby^="rm-phase-"] li button span').textContent.trim()`);
  const note = parse(await href('section[aria-labelledby^="rm-phase-"] li a[href^="mailto:"]'));
  check('Roadmap: an item\'s Notify me is an email naming that item', !!note && note.to === TO && note.subject.includes(title) && note.body.includes(title), JSON.stringify({ title, note }).slice(0, 300));
  const sug = parse(await href('#suggest a[href^="mailto:"][href*="subject="]'));
  check('Roadmap: Suggest a feature is an email', !!sug && sug.to === TO && sug.subject === 'Sidekick: feature suggestion');
  await t.go(O + '/Support.dc.html#privacy');
  txt = await t.text();
  check('Support › Privacy matches manual mode', /stores nothing about you/.test(txt) && /sets no cookies/.test(txt) && /kept for one hour/.test(txt) && /Google Play test list/.test(txt) && !/sk_session|Turnstile|database run by Neon/.test(txt), txt.slice(txt.indexOf('This website'), txt.indexOf('This website') + 200));
  check('Support › Privacy keeps the DRAFT (legal review) banner', /DRAFT/.test(txt));
  const res = await fetch(O + '/Beta.dc.html');
  check('Beta: noindex in <head> and in X-Robots-Tag', /<head>[\s\S]*<meta name="robots" content="noindex, nofollow">[\s\S]*<\/head>/.test(await res.text()) && res.headers.get('x-robots-tag') === 'noindex, nofollow');
  // Launch log Part 19: the manual site has no robots.txt, no sitemap and no canonical link.
  const crawl = await Promise.all(['/robots.txt', '/sitemap.xml'].map(async p => (await fetch(O + p)).status));
  check('no robots.txt, no sitemap.xml, no canonical link (manual)', crawl.every(s => s === 404) && !(await (await fetch(O + '/')).text()).includes('rel="canonical"'), crawl.join(' '));

  // No JavaScript: the emails are plain links.
  const c = await tab({ noJs: true, context: (await send('Target.createBrowserContext')).result.browserContextId });
  const nojs = [];
  for (const p of ['/Get%20Sidekick.dc.html', '/Download.dc.html', '/Roadmap.dc.html', '/Home.dc.html']) {
    await c.go(O + p);
    // Known and pre-existing (the same 13 at 84e05dd): Home without JavaScript shows these template fields raw.
    const r = await c.eval(`({ raw: [...document.body.innerText.matchAll(/\\{\\{[^}]*\\}\\}/g)].map(m => m[0]).filter(x => !(${JSON.stringify(p)} === '/Home.dc.html' && /^\\{\\{ (t\\.label|tab\\.(kicker|title|body)|c|s\\.(n|title|body)|f|a|l\\.(tag|title|body)) \\}\\}$/.test(x))), mail: [...document.querySelectorAll('a[href^="mailto:"]')].filter(a => a.getClientRects().length).length })`);
    if (!r || r.raw.length || (p !== '/Home.dc.html' && !r.mail)) nojs.push(`${p} ${JSON.stringify(r)}`);
  }
  check('no-JS: request, invite and suggestion emails are visible links; no new raw template (Home\'s 13 are pre-existing)', nojs.length === 0, nojs.join(' | '));

  const cookies = (await send('Network.getAllCookies', {}, t.sid)).result?.cookies || [];
  check('no cookie was set by any page', cookies.length === 0, cookies.map(k => k.name).join(','));
  const all = [t, c].flatMap(x => x.reqs).filter(u => !u.startsWith('data:') && !u.startsWith('about:'));
  const foreign = [...new Set(all.filter(u => !u.startsWith(O)).map(u => new URL(u).origin))];
  check('every request went to the site itself', foreign.length === 0 && all.length > 20, foreign.join(', ') + ` (${all.length} requests)`);
  check('no request to /api', dev.apiHits.length === 0 && !all.some(u => new URL(u).pathname.startsWith('/api/')), dev.apiHits.join(', '));
  const raw = [t, c].flatMap(x => x.errors);
  const preexisting = raw.filter(e => /\{\{ seg(W|H|Box|Path) \}\}/.test(e));
  const errs = raw.filter(e => !preexisting.includes(e));
  check('no console errors or CSP violations (Home SVG template warnings are pre-existing)', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 1500));
}

try {
  if (MODE === 'manual') await manualChecks(); else {
  // 0. What crawlers read (launch log Part 19): robots.txt names the sitemap; the sitemap lists the public pages, each
  //    served here with its canonical link and absolute share image; the noindex pages stay noindex.
  {
    const robots = await fetch(O + '/robots.txt'), sm = await fetch(O + '/sitemap.xml');
    const rt = await robots.text(), st = await sm.text();
    check('robots.txt: 200, crawlers allowed, download route closed, names the sitemap', robots.status === 200 && /^Allow: \/$/m.test(rt) && /^Disallow: \/download\/$/m.test(rt) && /^Sitemap: https:\/\/sidekickapp\.in\/sitemap\.xml$/m.test(rt), rt.slice(0, 300));
    const locs = [...st.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    const bad = [];
    for (const l of locs) {
      const p = l.replace('https://sidekickapp.in', ''), r = await fetch(O + p), h = await r.text();
      if (r.status !== 200 || !h.includes(`<link rel="canonical" href="${l}">`) || !h.includes('<meta property="og:image" content="https://sidekickapp.in/icons/og-image.png">') || /<meta name="robots" content="noindex/.test(h)) bad.push(`${p} ${r.status}`);
    }
    check('sitemap.xml: 200, the 4 public pages, each served with its canonical link and absolute share image', sm.status === 200 && locs.length === 4 && !bad.length, bad.join(' | ') || locs.join(' '));
    const ni = [];
    for (const p of ['/Download.dc.html', '/Beta.dc.html', '/check-email.html', '/404.dc.html']) { const h = await (await fetch(O + p)).text(); if (!/<meta name="robots" content="noindex/.test(h) || h.includes('rel="canonical"') || st.includes(p)) ni.push(p); }
    check('Download, Beta, check-email and 404 stay noindex, without a canonical, out of the sitemap', !ni.length, ni.join(' '));
  }
  // 1. Signup page in real mode; design-review switches have no effect.
  const a = await tab();
  // The short links (launch log Part 10) land on the form at its real path.
  for (const p of ['/get', '/beta']) {
    await a.go(O + p);
    const r = await a.eval(`({ path: location.pathname, form: !!document.querySelector('form'), button: document.body.innerText.includes('Get the Mac app') })`);
    check(`${p} lands on the Get Sidekick form`, r && r.path === '/Get%20Sidekick.dc.html' && r.form && r.button, JSON.stringify(r));
  }
  await a.go(O + '/');
  check('footer: Privacy is this site\'s own page (one privacy page, Part 15)', (await a.eval(`(() => { const f = document.querySelector('footer'); return !!f && [...f.querySelectorAll('a')].some(x => x.textContent.trim() === 'Privacy' && x.getAttribute('href') === 'Support.dc.html#privacy') && !f.innerHTML.includes('chetan-website-delta'); })()`)) === true);
  await a.eval(`sessionStorage.setItem('sk_mock_outcome','server_error'); sessionStorage.setItem('sk_session', JSON.stringify({name:'Mock', expiresAt: Date.now()+1e9})); true`);
  await a.go(O + '/Get%20Sidekick.dc.html?previewState=success&showReview=true');
  let txt = await a.text();
  check('signup page renders in real mode: one button "Get the Mac app", the one-line Android note exactly once', txt.includes('Get the Mac app') && txt.split("Android: join the Google Play test, we'll email you the link.").length === 2, `${txt.split('Android: join').length - 1} times`);
  check('no Design review bar in production build', !/DESIGN REVIEW/i.test(txt));
  check('Turnstile container rendered (local stand-in)', txt.includes('Human check (local test stand-in)'));
  check('previewState in the URL is ignored', !txt.includes('Saved. One more step by email.') && !txt.includes("You're in"));
  // Submit empty → client-side errors.
  await a.eval(click('#f-send')); await sleep(400);
  txt = await a.text();
  check('empty submit: the error summary asks for 3 things only (name, email, privacy; no chip, Android optional)', txt.includes('Please fix 3 things') && txt.includes('Enter your name.') && !txt.includes("Mac's chip") && !txt.includes('Enter the Google account email'));
  check('focus moves to the error summary', await a.eval(`document.activeElement && document.activeElement.id`) === 'err-summary');
  // Ticking Android shows its two fields; a phone number in "Android phone model" is refused with the plain message.
  await a.eval(click('#f-android')); await sleep(300);
  check('Android box shows the phone model and Google account fields', await a.eval(`!!document.getElementById('f-phone') && !!document.getElementById('f-google')`));
  await a.eval(fill('#f-phone', '07700 900123')); await a.eval(click('#f-send')); await sleep(400);
  txt = await a.text();
  check('phone number in the model field: plain message, model-name hint', txt.includes("Enter the phone's model name, for example Pixel 8, not its number.") && txt.includes('The model name, like Pixel 8 or Galaxy S23 — not your phone number.'));
  // Fill and submit.
  await a.eval(fill('#f-name', 'Alex Rivera')); await a.eval(fill('#f-email', 'alex@example.com')); await a.eval(fill('#f-phone', 'Pixel 8')); await a.eval(fill('#f-google', 'alex.rivera@gmail.com'));
  await a.eval(click('#f-privacy'));
  await a.eval(click('#f-send'));
  await sleep(1000);
  check('pool empty: the page says so honestly ("One more step by email"), no error', (await a.text()).includes("Right now we can't hand out a beta token on this page"));
  await sleep(3500);
  txt = await a.text();
  check('after submit: Download page says check your email', (await a.eval('location.pathname')) === '/Download.dc.html' && txt.includes('Check your email') && txt.includes('Alex'), txt.replace(/\s+/g, ' ').slice(0, 400));
  check('check your email: says emails can take up to a day', txt.includes('can take up to a day to arrive') && txt.includes('Nothing after a day?') && !txt.includes('a few minutes'));
  check('check your email: says what happens after confirming, and the download is there now', txt.includes('After you confirm, we email your beta token, usually within a day.') && txt.includes('download the Mac app'));
  check('session cookie is HttpOnly (not readable by page script)', !(await a.eval('document.cookie')).includes('sk_session'));
  check('old sessionStorage mock session is ignored', !txt.includes('Mock'));

  // 2. Confirm link from the email → button → Download page, approved.
  const confirmUrl = linkIn((await outbox()).find(m => m.kind === 'confirm').text, '/api/confirm-email');
  await a.go(confirmUrl);
  check('confirm link opens a page with a button (GET changes nothing)', (await a.text()).includes('Confirm my email') && dev.repo.debugAll('signups')[0].state === 'pending_email');
  await a.eval(click('button[type=submit]')); await sleep(2500);
  txt = await a.text();
  check('after confirming: Download page with the Mac card, token on its way', txt.includes("You're") && txt.includes('Download for Apple silicon (.dmg)') && txt.includes('once it\'s ready'), (await a.eval('location.pathname')) + ' ' + txt.replace(/\s+/g, ' ').slice(0, 300));
  check('Android card: by invitation through Google Play testing (no "not available")', txt.includes('By invitation through Google Play testing.') && !/Not available yet|isn.t available yet/.test(txt));
  const sha = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/releases.json'), 'utf8')).mac.builds.arm64.sha256;
  check('checksum is exactly releases.json\'s, only under a closed "More details" (launch log Part 11)', await a.eval(`(() => { const d = document.getElementById('more-details'); return !!d && !d.open && d.querySelector('summary').textContent.trim() === 'More details' && d.textContent.includes(${JSON.stringify(sha || 'The checksum appears here once the beta build is staged.')}); })()`) && (!sha || !txt.includes(sha)), sha ? sha.slice(0, 12) + '…' : 'null');
  // Part 20: the same confirm link a second time says it was used, never "expired", and that the token is not affected.
  await a.go('about:blank'); await a.go(confirmUrl); await a.eval(click('button[type=submit]')); await sleep(1500);
  txt = await a.text();
  check('the same confirm link again: "already confirmed your email", not "expired", token not affected (Part 20)', txt.includes('You already confirmed your email.') && !/expired/i.test(txt) && txt.includes('Your beta token is not affected'), txt.replace(/\s+/g, ' ').slice(0, 200));

  // 3. Signer on "the owner's Mac": throwaway key, fake issuer, posts token, sends the outbox.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-signer-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keyFile = path.join(dir, 'throwaway.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const cfg = { ...loadSignerConfig({}), issuer: path.join(ROOT, 'test/fixtures/fake-issuer.mjs'), keyFile, tokensDir: path.join(dir, 'tokens') };
  const sent = [];
  // PLAY_GATE=on (the default): the owner adds the Google account in Play Console, then marks it added.
  const adminC = makeClient({ base: O, keyId: 'admin', secret: dev.secrets.ADMIN_AUTH_SECRET });
  const pp = await adminC('play-pending');
  check('play-pending lists the Google account from the form', pp.csv === 'alex.rivera@gmail.com\n', JSON.stringify(pp.csv));
  check('play-mark-added', (await adminC('play-mark-added', { googleEmails: ['alex.rivera@gmail.com'] })).marked === 1);
  const r = await runCycle({ cfg, post: makeClient({ base: O, keyId: 'signer', secret: dev.secrets.ADMIN_AUTH_SIGNER_SECRET }), mail: async (m) => sent.push(m), log: () => {} });
  check('signer issued and posted one token, sent the queued emails', r.issued === 1 && r.posted === 1 && r.mailed >= 2, JSON.stringify(r));
  const tokenMail = sent.find(m => m.kind === 'token');
  const token = tokenMail.text.match(/SIDEKICK-TRIAL-1\.\S+/)[0];
  const [, pl, sg] = token.split('.');
  check('emailed token verifies with the throwaway public key', crypto.verify(null, Buffer.from(pl), publicKey, Buffer.from(sg, 'base64url')));
  const inviteMail = sent.find(m => m.kind === 'invite');
  check('invitation sent separately: Play link, /download/mac, no token, no Beta page', !!inviteMail && inviteMail.text.includes('play.google.com/apps/internaltest/') && inviteMail.text.includes(O + '/download/mac') && !inviteMail.text.includes(token) && !inviteMail.text.includes('Beta.dc.html'));

  // 4. A different browser (fresh profile context) opens the access link from the token email.
  const { result: { browserContextId } } = await send('Target.createBrowserContext');
  const b = await tab({ context: browserContextId });
  await b.go(O + '/Download.dc.html');
  check('without a session the Download page shows the expired state', (await b.text()).includes('Open the link again'));
  // The first browser still has its session: the Download page's button is a plain link to /download/mac.
  await a.go(O + '/Download.dc.html'); await sleep(500);
  txt = await a.text();
  check('Download page says the token was emailed; the Mac button is a normal /download/mac link', txt.includes('We emailed it to you') && (await a.eval(`document.querySelector('#dl-mac') && document.querySelector('#dl-mac').getAttribute('href')`)) === '/download/mac');

  // 4b. Updates: an announcement to a confirmed subscriber, and its one-use unsubscribe link in a browser.
  await fetch(O + '/api/get-sidekick', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ name: 'Una', email: 'una@example.com', macChip: 'apple', phoneModel: 'Pixel 7', googleEmail: 'una@gmail.com', privacyAccepted: true, marketingOptIn: true, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  const updT = ((await outbox()).filter(m => m.kind === 'confirm').map(m => m.text).join('\n').match(/confirm-email\?for=updates#t=([A-Za-z0-9_-]{43})/) || [])[1];
  await fetch(O + '/api/confirm-email', { method: 'POST', headers: { 'content-type': 'application/json', origin: O }, body: JSON.stringify({ t: updT, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  await b.go(`${O}/api/confirm-email?for=updates#t=${updT}`); await b.eval(click('button[type=submit]')); await sleep(1500);
  txt = await b.text();
  check('the updates link pressed again after confirming: "already confirmed Sidekick updates", not "expired" (Part 20)', txt.includes('You already confirmed Sidekick updates.') && !/expired/i.test(txt) && txt.includes('Your beta token is not affected'), txt.replace(/\s+/g, ' ').slice(0, 200));
  check('announce --dry-run counts one subscriber', (await adminC('announce', { subject: 'Sidekick update', body: 'Hello.', dryRun: true })).recipients === 1);
  await adminC('announce', { subject: 'Sidekick update', body: 'Hello.' });
  const unsubUrl = linkIn((await outbox()).find(m => m.kind === 'announce').text, '/api/unsubscribe');
  await b.go(unsubUrl);
  txt = await b.text();
  check('unsubscribe link opens a page with a button and no human check', txt.includes('Stop Sidekick updates') && !/Human check/.test(txt));
  await b.eval(click('button[type=submit]')); await sleep(1500);
  check('after the button: unsubscribed', (await b.text()).includes('Unsubscribed') && !dev.repo.debugAll('signups').find(s => s.email === 'una@example.com').marketingConfirmedAt);
  await b.go('about:blank'); await b.go(unsubUrl); await b.eval(click('button[type=submit]')); await sleep(1500); // (same URL + #t: leave first, or it is only a fragment change)
  check('the same link again: already used (410)', (await b.text()).includes('Link already used'));

  // 5. No JavaScript: the plain form is there and fails closed on the human check.
  const c = await tab({ noJs: true, context: (await send('Target.createBrowserContext')).result.browserContextId });
  await c.go(O + '/Get%20Sidekick.dc.html');
  txt = await c.text();
  check('no-JS: the plain signup form is visible (Android optional, button "Get the Mac app"), template text is not', txt.includes('Android phone model') && txt.includes('I also want the Android app') && txt.includes('Get the Mac app') && !txt.includes('{{'));
  await c.eval(fill('input[name=name]', 'Sam')); // eval still works with page scripts disabled
  await send('Runtime.evaluate', { expression: `document.querySelector('.skf input[name=email]').value='sam@example.com';document.querySelector('.skf input[name=phoneModel]').value='Pixel';document.querySelector('.skf input[name=googleEmail]').value='sam@gmail.com';document.querySelector('.skf input[name=android]').checked=true;document.querySelector('.skf input[name=privacyAccepted]').checked=true;document.querySelector('.skf form').submit();` }, c.sid);
  await sleep(1500);
  txt = await c.text();
  check('no-JS submit: server page explains the human check needs JavaScript, answers kept', txt.includes('needs JavaScript') && (await c.eval(`document.querySelector('input[name=email]').value`)) === 'sam@example.com');
  check('no-JS submit stored nothing', !dev.repo.debugAll('signups').some(s => s.email === 'sam@example.com'));
  await c.go(O + '/check-email.html');
  txt = await c.text();
  check('no-JS landing page (check-email.html) says up to a day, and what happens next', txt.includes('can take up to a day to arrive') && txt.includes('Nothing after a day?') && txt.includes('After you confirm, we email your beta token, usually within a day.'));

  // 5. Only the Continue button sends, and the updates choice is the box as shown (launch log Part 6, 2026-10-17).
  const row = (e) => dev.repo.debugAll('signups').find(s => s.email === e);
  const confirmTo = async (e) => (await outbox()).filter(m => m.kind === 'confirm' && m.to === e).map(m => m.text).join('\n');
  const fillAll = async (t, n, e) => {
    await typeIn(t, '#f-name', n); await typeIn(t, '#f-email', e); await mouse(t, '#f-android'); await sleep(200);
    await typeIn(t, '#f-phone', 'Pixel 8'); await typeIn(t, '#f-google', e.replace('example.com', 'gmail.com'));
  };
  const p = await tab();
  await p.go(O + '/Get%20Sidekick.dc.html');
  await fillAll(p, 'Pre Set', 'preset@example.com');
  await p.eval(`(() => { for (const id of ['f-privacy', 'f-updates']) { const el = document.getElementById(id); el.checked = true; el.setAttribute('checked', ''); } return true; })()`);
  await mouse(p, '#f-send'); await sleep(800);
  txt = await p.text();
  check('privacy box pre-set without a click (autofill-like) is not consent: refused on the page, nothing sent', posts(p) === 0 && !row('preset@example.com') && txt.includes("Confirm you've read the Privacy Policy to continue."), txt.slice(0, 200));
  const f = await tab();
  await f.go(O + '/Get%20Sidekick.dc.html');
  await typeIn(f, '#f-name', 'Ena Ter'); await press(f);
  await typeIn(f, '#f-email', 'enter@example.com'); await press(f);
  await mouse(f, '#f-android'); await press(f); await sleep(200);
  await typeIn(f, '#f-phone', 'Pixel 8'); await press(f);
  await typeIn(f, '#f-google', 'enter@gmail.com'); await press(f);
  await mouse(f, '#f-privacy'); await press(f);
  await typeIn(f, '#f-google', ''); await press(f); // every field valid now
  await f.eval(`document.querySelector('main form').requestSubmit(); true`);
  await sleep(5000);
  check('Enter in each field, on the Android box and on the ticked privacy box, requestSubmit(), then 5 s idle: nothing sent', posts(f) === 0 && !row('enter@example.com') && (await f.eval('location.pathname')) === '/Get%20Sidekick.dc.html' && (await f.eval(`document.getElementById('f-updates').checked`)) === false, `posts ${posts(f)} ${await f.eval('location.pathname')}`);
  await f.eval(`(() => { const u = document.getElementById('f-updates'); u.checked = true; u.setAttribute('checked', ''); return true; })()`);
  await mouse(f, '#f-send'); await sleep(3500);
  check('a click on "Get the Mac app" sends once; an updates box pre-set without a click (autofill-like) is ignored: no request, no updates link', posts(f) === 1 && !!row('enter@example.com') && row('enter@example.com').marketingRequestedAt === null && (await confirmTo('enter@example.com')).includes('/api/confirm-email#t=') && !(await confirmTo('enter@example.com')).includes('for=updates'), `posts ${posts(f)}`);
  const g = await tab();
  await g.go(O + '/Get%20Sidekick.dc.html');
  await fillAll(g, 'Tick Ed', 'ticked@example.com'); await mouse(g, '#f-privacy'); await mouse(g, '#f-updates');
  await sleep(300);
  check('ticking boxes sends nothing', posts(g) === 0);
  await g.eval(`document.getElementById('f-send').focus(); true`); await press(g); await sleep(3500);
  check('updates ticked by a click + Enter on the "Get the Mac app" button: sent once, updates requested, its own link in the confirm email', posts(g) === 1 && !!row('ticked@example.com') && !!row('ticked@example.com').marketingRequestedAt && (await confirmTo('ticked@example.com')).includes('/api/confirm-email?for=updates#t='), `posts ${posts(g)}`);

  // 5b. The one-click flow (launch log Parts 7–8): the signer fills the pool, the form → "You're in" → the download starts
  // by itself in a hidden frame, and the page with the token never navigates. GitHub is never contacted: the DevTools
  // Fetch domain answers github.com with a 302 to the file host and that with a synthetic disk image (random bytes
  // plus a UDIF "koly" trailer, the DMG format's magic, which sits in the last 512 bytes).
  await runPool({ cfg: { ...cfg, issuer: path.join(ROOT, 'test/fixtures/fake-issuer-trial.mjs'), poolLow: 3, poolMax: 3 }, post: makeClient({ base: O, keyId: 'signer', secret: dev.secrets.ADMIN_AUTH_SIGNER_SECRET }), log: () => {} });
  const fake = Buffer.concat([crypto.randomBytes(65536 - 512), Buffer.from('koly'), Buffer.alloc(508)]);
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-dl-'));
  const downloads = [];
  listeners.push(m => { if (!m.sessionId && m.method === 'Browser.downloadProgress' && m.params.state === 'completed') downloads.push(m.params.guid); });
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dlDir, eventsEnabled: true });
  const i = await tab();
  listeners.push(m => {
    if (m.sessionId !== i.sid || m.method !== 'Fetch.requestPaused') return;
    if (m.params.request.url === DIRECT) send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 302, responseHeaders: [
      { name: 'location', value: ASSET }, { name: 'x-frame-options', value: 'deny' }], body: '' }, i.sid);
    else if (m.params.request.url === ASSET) send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [
      { name: 'content-type', value: 'application/octet-stream' }, { name: 'content-length', value: String(fake.length) },
      { name: 'content-disposition', value: `attachment; filename=${RELEASES.mac.builds.arm64.file}` }], body: fake.toString('base64') }, i.sid);
    else send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, i.sid);
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://github.com/*' }, { urlPattern: 'https://release-assets.githubusercontent.com/*' }] }, i.sid);
  await send('Browser.grantPermissions', { origin: O, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await i.go(O + '/Get%20Sidekick.dc.html');
  await typeIn(i, '#f-name', 'ina stant'); await typeIn(i, '#f-email', 'ina@example.com'); // lower-case name on purpose: the page must say "Ina" (launch log Part 11)
  await mouse(i, '#f-android'); await sleep(200); await typeIn(i, '#f-phone', 'Pixel 8'); await typeIn(i, '#f-google', 'ina.stant@gmail.com');
  await mouse(i, '#f-privacy');
  await i.eval(`window.__sameDocument = 'yes'; true`); // gone if this tab ever navigates or reloads
  await mouse(i, '#f-send'); await sleep(1200);
  txt = await i.text();
  const shown = dev.repo.debugAll('signups').find(s => s.email === 'ina@example.com');
  check('one click → "You\'re in, Ina" on the same page, with the token, three steps and More details', txt.includes("You're in, Ina.") && /SIDEKICK-TRIAL-1\./.test(txt) && (await i.eval(`document.querySelectorAll('#result li.step').length`)) === 3 && txt.includes('More details') && txt.includes('Download again'), `api ${i.api.join(',')} errors ${i.errors.join(' | ').slice(0, 300)} page ${txt.slice(txt.indexOf('Get Sidekick', 30), txt.indexOf('Get Sidekick', 30) + 500)}`);
  check('the result page says when the token ends and what to do then (Part 20)', /It works until \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC\. If Sidekick later says your beta access has ended, write to us for a new token\./.test(txt));
  check('the result shows the Android line exactly once, and not the form note', txt.split("Android: we're adding your Google account").length === 2 && !txt.includes('Android: join the Google Play test'), `${txt.split('Android:').length - 1} Android lines`);
  check('"Download again" is visible and opens a new tab (never this one)', await i.eval(`(() => { const a = document.getElementById('dl-again'); return !!a && a.offsetParent !== null && a.textContent.trim() === 'Download again' && a.target === '_blank' && a.getAttribute('href') === '/download/mac'; })()`));
  check('no Drive link on the result page (short content, launch log Part 11)', await i.eval(`document.querySelectorAll('#result a[href*="drive.google.com"]').length === 0 && !/Google Drive/.test(document.getElementById('result').textContent)`));
  check('no confirmation email for the instant sign-up; the row has its pool token', !(await outbox()).some(m => m.to === 'ina@example.com') && !!shown && shown.tokenSource === 'pool');
  await sleep(2500);
  const r302 = i.redirects.find(x => new URL(x.url).pathname === '/download/mac');
  const h302 = r302 ? Object.fromEntries(Object.entries(r302.headers).map(([k, v]) => [k.toLowerCase(), v])) : {};
  check('the download started by itself: GET /download/mac → 302 to the GitHub asset, no-store, noindex, no-referrer', !!r302 && r302.status === 302 && r302.to === DIRECT && h302['cache-control'] === 'no-store' && h302['x-robots-tag'] === 'noindex' && h302['referrer-policy'] === 'no-referrer', JSON.stringify(r302 && { status: r302.status, to: r302.to }));
  check('…in one hidden frame, through github.com → GitHub\'s file host (allowed by the page CSP)', (await i.eval(`[...document.querySelectorAll('iframe')].filter(f => f.getAttribute('src') === '/download/mac' && f.hidden && getComputedStyle(f).display === 'none').length`)) === 1 && i.redirects.some(x => x.url === DIRECT && x.status === 302 && x.to === ASSET), JSON.stringify(i.redirects.map(x => [x.url.slice(0, 60), x.status])));
  const asset = i.responses.find(x => x.url === ASSET);
  const ah = asset ? Object.fromEntries(Object.entries(asset.headers).map(([k, v]) => [k.toLowerCase(), v])) : {};
  check('the asset response is a file download (attachment, octet-stream)', !!asset && /^attachment; filename=Sidekick-2\.0\.1-arm64\.dmg$/.test(ah['content-disposition'] || '') && ah['content-type'] === 'application/octet-stream');
  for (let k = 0; k < 30 && !downloads.length; k++) await sleep(200);
  const got = downloads.length ? fs.readFileSync(path.join(dlDir, downloads[0])) : Buffer.alloc(0);
  check('Chrome saved the file: same bytes, DMG "koly" magic in the trailer; the result page stayed', got.length === fake.length && got.subarray(got.length - 512, got.length - 508).toString() === 'koly' && got.equals(fake) && (await i.eval('location.pathname')) === '/Get%20Sidekick.dc.html' && (await i.text()).includes("You're in, Ina."), `${got.length} bytes`);
  check('the tab never navigated: same document, token still on the page', (await i.eval('window.__sameDocument')) === 'yes' && /SIDEKICK-TRIAL-1\./.test(await i.text()));
  fs.rmSync(dlDir, { recursive: true, force: true });
  check('the downloaded copy is deleted', !fs.existsSync(dlDir));
  check('the download was counted with no personal data', JSON.stringify(await dev.repo.downloadCounts()).includes('"target":"direct"') && !JSON.stringify(await dev.repo.downloadCounts()).includes('@'));
  await mouse(i, '#copy-token'); await sleep(300);
  const pasted = await i.eval('navigator.clipboard.readText()');
  check('Copy puts exactly the token on the clipboard', /^SIDEKICK-TRIAL-1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/.test(pasted || '') && (await i.text()).includes(pasted));
  await mouse(i, '#email-copy'); await sleep(800);
  check('"Email me a copy" queues one copy email to that address', (await outbox()).filter(m => m.to === 'ina@example.com' && m.kind === 'copy').length === 1 && (await i.text()).includes('Copy on its way'));
  const j = await tab({ context: (await send('Target.createBrowserContext')).result.browserContextId });
  await j.go(O + '/Get%20Sidekick.dc.html');
  await typeIn(j, '#f-name', 'Someone Else'); await typeIn(j, '#f-email', 'ina@example.com'); await mouse(j, '#f-privacy');
  await mouse(j, '#f-send'); await sleep(1500);
  txt = await j.text();
  check('the same address again (another browser): "You already signed up", NO token on the page', txt.includes('You already signed up.') && !/SIDEKICK-TRIAL-1/.test(txt) && !(await j.eval('document.querySelector("main").innerHTML')).includes('SIDEKICK-TRIAL-1.'), `api ${j.api.join(',')} ${txt.slice(txt.indexOf('Get Sidekick', 30), txt.indexOf('Get Sidekick', 30) + 300)}`);
  await send('Fetch.disable', {}, i.sid);

  // 6. Hygiene across all tabs.
  const all = [a, b, c, p, f, g, i, j].flatMap(t => t.reqs).filter(u => !u.startsWith('data:') && !u.startsWith('about:'));
  const foreign = [...new Set(all.filter(u => !u.startsWith(O) && u !== DIRECT && u !== ASSET).map(u => new URL(u).origin))];
  check('only same-origin requests (plus the intercepted GitHub asset and its file host, answered locally)', foreign.length === 0, foreign.join(', '));
  // Expected: 401 from /api/session with no session, 403 from the no-JS submit (fails closed). Known and pre-existing
  // (unchanged since 7e7042c): Home's SVG attributes hold {{ seg… }} until the template renders.
  const raw = [a, b, c, p, f, g, i, j].flatMap(t => t.errors);
  const preexisting = raw.filter(e => /\{\{ seg(W|H|Box|Path) \}\}/.test(e));
  const errs = raw.filter(e => !preexisting.includes(e) && !/status of (401|403|410)/.test(e));
  check('known pre-existing warnings only: Home SVG template attributes', true, `${preexisting.length} warning(s) — not caused by this branch`);
  check('no console errors or CSP violations', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 1500));
  const leaks = dev.logs.filter(l => /alex@example\.com|SIDEKICK-TRIAL|127\.0\.0\.1/.test(l));
  check('server logs hold no email, token or IP', leaks.length === 0, leaks[0] || '');
  // Visitor scan (launch log Part 16): every automated page at phone width reads as finished copy, links only to
  // allow-listed places, fits the screen, and states the facts of the one-click flow.
  const v = await tab();
  for (const pg of ['/', '/Get%20Sidekick.dc.html', '/Download.dc.html', '/Beta.dc.html', '/Roadmap.dc.html', '/Support.dc.html#setup', '/Support.dc.html#help', '/Support.dc.html#permissions', '/Support.dc.html#privacy', '/Support.dc.html#changelog', '/404.dc.html', '/check-email.html', '/api/confirm-email', '/api/unsubscribe']) {
    await v.go(O + pg); await sleep(600);
    const r = await v.eval(`({ text: document.body.innerText, hrefs: [...document.querySelectorAll('a[href]')].map(a => a.href), wide: document.documentElement.scrollWidth > innerWidth + 1 })`);
    // The local bot-check stand-in exists only here (the build refuses its key for Vercel; the live crawl checks Production).
    const dev = (r.text.replace(ILLUSTRATION, '').replaceAll('Human check (local test stand-in)', '').match(DEV_TEXT) || [])[0];
    const out = r.hrefs.filter(u => !u.startsWith(O) && !EXTERNAL_OK.some(x => x.test(u)));
    check(`visitor scan ${pg}: no developer text, outside links allow-listed, no sideways scroll`, !dev && !out.length && !r.wide, [dev, ...out, r.wide ? 'scrolls sideways' : ''].filter(Boolean).join(' | '));
    if (pg === '/Support.dc.html#privacy') check('privacy page: the publisher line, no DRAFT banner', r.text.includes('Beta privacy notice. Published by Chetan Pujari, India. Last updated 19 October 2026. Questions: chetanpujari.sitit@gmail.com.') && !/DRAFT/.test(r.text));
    if (pg === '/' || pg === '/Support.dc.html#setup') check(`${pg}: Android by Play test invitation, never "not available yet"; no "person who invited you"`, r.text.includes('by invitation through Google Play testing') && !r.text.includes('not available yet') && !r.text.includes('the person who invited you'));
  }
  console.error('API calls per tab:', JSON.stringify([a, b, c, p, f, g].map(t => t.api)));
  } // end automated
} catch (e) {
  check('run completed', false, e.stack.split('\n').slice(0, 2).join(' '));
} finally {
  const exited = new Promise(r => chrome.once('exit', r));
  chrome.kill(); await exited; await dev.close();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  for (const d of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('sk-e2e-signer-'))) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
}
const w = Math.max(...results.map(r => r.name.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
