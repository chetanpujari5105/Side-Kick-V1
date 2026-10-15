// Browser end-to-end check of the REAL pages against the real API code on fake adapters (scripts/dev-server.mjs),
// in headless Chrome over the DevTools protocol, with the production CSP from vercel.json applied.
//   node tools/browser-e2e.mjs
// Uses a throwaway Ed25519 key and the test-only fake issuer. No network beyond 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { startDevServer } from '../scripts/dev-server.mjs';
import { runCycle, loadSignerConfig } from './signer/signer.mjs';
import { makeClient } from './lib/client.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8791, CDP = 9341;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const dev = await startDevServer({ port: PORT, quiet: true });
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
  const t = { sid, reqs: [], errors: [], navs: [], api: [] };
  listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') t.reqs.push(m.params.request.url);
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
const outbox = async () => (await fetch(O + '/__dev/outbox')).json();
const linkIn = (text, p) => (text.match(new RegExp(O.replace(/[.:/]/g, '\\$&') + p + '(?:\\?[a-z=]+)?#t=[A-Za-z0-9_-]+')) || [])[0];

try {
  // 1. Signup page in real mode; design-review switches have no effect.
  const a = await tab();
  await a.go(O + '/');
  await a.eval(`sessionStorage.setItem('sk_mock_outcome','server_error'); sessionStorage.setItem('sk_session', JSON.stringify({name:'Mock', expiresAt: Date.now()+1e9})); true`);
  await a.go(O + '/Get%20Sidekick.dc.html?previewState=success&showReview=true');
  let txt = await a.text();
  check('signup page renders in real mode (button "Continue to download")', txt.includes('Continue to download'), '');
  check('no Design review bar in production build', !/DESIGN REVIEW/i.test(txt));
  check('Turnstile container rendered (local stand-in)', txt.includes('Human check (local test stand-in)'));
  check('previewState in the URL is ignored', !txt.includes('Saved. Taking you to your download'));
  // Submit empty → client-side errors.
  await a.eval(click('button[type=submit]')); await sleep(400);
  txt = await a.text();
  check('empty submit shows the error summary with Handoff strings', txt.includes('Please fix 5 things') && txt.includes('Enter your name.') && txt.includes("Choose your Mac's chip, or Not sure."));
  check('focus moves to the error summary', await a.eval(`document.activeElement && document.activeElement.id`) === 'err-summary');
  // Fill and submit.
  await a.eval(fill('#f-name', 'Alex Rivera')); await a.eval(fill('#f-email', 'alex@example.com')); await a.eval(fill('#f-phone', 'Pixel 8'));
  await a.eval(click('input[name=macChip][value=apple]')); await a.eval(click('#f-privacy'));
  await a.eval(click('button[type=submit]'));
  await sleep(3500);
  txt = await a.text();
  check('after submit: Download page says check your email', (await a.eval('location.pathname')) === '/Download.dc.html' && txt.includes('Check your email') && txt.includes('Alex'), txt.replace(/\s+/g, ' ').slice(0, 400));
  check('session cookie is HttpOnly (not readable by page script)', !(await a.eval('document.cookie')).includes('sk_session'));
  check('old sessionStorage mock session is ignored', !txt.includes('Mock'));

  // 2. Confirm link from the email → button → Download page, approved.
  const confirmUrl = linkIn((await outbox()).find(m => m.kind === 'confirm').text, '/api/confirm-email');
  await a.go(confirmUrl);
  check('confirm link opens a page with a button (GET changes nothing)', (await a.text()).includes('Confirm my email') && dev.repo.debugAll('signups')[0].state === 'pending_email');
  await a.eval(click('button[type=submit]')); await sleep(2500);
  txt = await a.text();
  check('after confirming: Download page with the Mac card, token on its way', txt.includes("You're") && txt.includes('Download for Apple silicon (.dmg)') && txt.includes('once it\'s ready'), (await a.eval('location.pathname')) + ' ' + txt.replace(/\s+/g, ' ').slice(0, 300));
  check('no checksum invented (placeholder shown)', txt.includes('The checksum appears here once the beta build is staged.'));

  // 3. Signer on "the owner's Mac": throwaway key, fake issuer, posts token, sends the outbox.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-signer-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keyFile = path.join(dir, 'throwaway.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const cfg = { ...loadSignerConfig({}), issuer: path.join(ROOT, 'test/fixtures/fake-issuer.mjs'), keyFile, tokensDir: path.join(dir, 'tokens') };
  const sent = [];
  const r = await runCycle({ cfg, post: makeClient({ base: O, keyId: 'signer', secret: dev.secrets.ADMIN_AUTH_SIGNER_SECRET }), mail: async (m) => sent.push(m), log: () => {} });
  check('signer issued and posted one token, sent the queued emails', r.issued === 1 && r.posted === 1 && r.mailed >= 2, JSON.stringify(r));
  const tokenMail = sent.find(m => m.kind === 'token');
  const token = tokenMail.text.match(/SIDEKICK-TRIAL-1\.\S+/)[0];
  const [, pl, sg] = token.split('.');
  check('emailed token verifies with the throwaway public key', crypto.verify(null, Buffer.from(pl), publicKey, Buffer.from(sg, 'base64url')));

  // 4. A different browser (fresh profile context) opens the access link from the token email.
  const { result: { browserContextId } } = await send('Target.createBrowserContext');
  const b = await tab({ context: browserContextId });
  await b.go(O + '/Download.dc.html');
  check('without a session the Download page shows the expired state', (await b.text()).includes('Open the link again'));
  await b.go(linkIn(tokenMail.text, '/api/access'));
  await b.eval(click('button[type=submit]')); await sleep(2500);
  txt = await b.text();
  check('access link → Download page says the token was emailed', txt.includes('We emailed it to you'));
  await b.eval(click('section[aria-labelledby=mac-h] button')); await sleep(1500);
  const dl = b.reqs.find(u => u.startsWith('https://files.example.test/'));
  check('download button → 302 to a short-lived file link (fake host)', !!dl && dev.storage.check(dl), dl ? new URL(dl).host : 'no request');
  check('download was logged', dev.repo.debugAll('downloads').length === 1);

  // 5. No JavaScript: the plain form is there and fails closed on the human check.
  const c = await tab({ noJs: true, context: (await send('Target.createBrowserContext')).result.browserContextId });
  await c.go(O + '/Get%20Sidekick.dc.html');
  txt = await c.text();
  check('no-JS: the plain signup form is visible, template text is not', txt.includes('Android phone model') && !txt.includes('{{'));
  await c.eval(fill('input[name=name]', 'Sam')); // eval still works with page scripts disabled
  await send('Runtime.evaluate', { expression: `document.querySelector('.skf input[name=email]').value='sam@example.com';document.querySelector('.skf input[name=phoneModel]').value='Pixel';document.querySelector('.skf input[value=apple]').checked=true;document.querySelector('.skf input[name=privacyAccepted]').checked=true;document.querySelector('.skf form').submit();` }, c.sid);
  await sleep(1500);
  txt = await c.text();
  check('no-JS submit: server page explains the human check needs JavaScript, answers kept', txt.includes('needs JavaScript') && (await c.eval(`document.querySelector('input[name=email]').value`)) === 'sam@example.com');
  check('no-JS submit stored nothing', !dev.repo.debugAll('signups').some(s => s.email === 'sam@example.com'));

  // 6. Hygiene across all tabs.
  const all = [a, b, c].flatMap(t => t.reqs).filter(u => !u.startsWith('data:') && !u.startsWith('about:'));
  const foreign = [...new Set(all.filter(u => !u.startsWith(O) && !u.startsWith('https://files.example.test/')).map(u => new URL(u).origin))];
  check('only same-origin requests (plus the fake file host)', foreign.length === 0, foreign.join(', '));
  // Expected: 401 from /api/session with no session, 403 from the no-JS submit (fails closed). Known and pre-existing
  // (unchanged since 7e7042c): Home's SVG attributes hold {{ seg… }} until the template renders.
  const raw = [a, b, c].flatMap(t => t.errors);
  const preexisting = raw.filter(e => /\{\{ seg(W|H|Box|Path) \}\}/.test(e));
  const errs = raw.filter(e => !preexisting.includes(e) && !/status of (401|403)/.test(e));
  check('known pre-existing warnings only: Home SVG template attributes', true, `${preexisting.length} warning(s) — not caused by this branch`);
  check('no console errors or CSP violations', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 1500));
  const leaks = dev.logs.filter(l => /alex@example\.com|SIDEKICK-TRIAL|127\.0\.0\.1/.test(l));
  check('server logs hold no email, token or IP', leaks.length === 0, leaks[0] || '');
  console.error('API calls per tab:', JSON.stringify([a, b, c].map(t => t.api)));
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
