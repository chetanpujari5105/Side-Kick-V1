// Link checker, offline. Run after any copy change:
//   node tools/check-links.mjs
// 1. Builds dist/ (the deployed site) and checks every internal link in it: href/src/action attributes, page
//    links written as strings in page scripts, the root rewrite, and every #fragment (static id, a Support tab,
//    or a hash the target page's script reads). Links inside SiteHeader/SiteFooter are checked against every
//    page that imports them. External links are listed, not fetched.
// 2. Checks the server-rendered pages (link pages, message page, no-JS form) and the server's redirects.
// 3. Walks every email link form through the real router on fake adapters: confirm, confirm?for=updates,
//    confirm?for=notify and access. Each must be same-origin, carry its token only in the #fragment, match the
//    page script's pattern, open a page whose form posts to a real route, and land on a page that exists.
// Exits 1 on any problem. Imported by test/links.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/app.mjs';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { FakeBotCheck, FakeStorage, FakeClock } from '../server/fakes.mjs';
import { loadConfig } from '../server/config.mjs';
import { createLogger } from '../server/log.mjs';
import { linkPage, messagePage, signupFormPage } from '../server/pages.mjs';
import { signRequest } from '../server/crypto.mjs';
import releases from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const O = 'https://sidekick-links.example.test';
const COMPONENTS = ['SiteHeader.dc.html', 'SiteFooter.dc.html', 'MacWindow.dc.html', 'PhoneScreen.dc.html', 'RoadmapTrack.dc.html'];
const EXTERNAL = /^(https?:|mailto:|tel:|data:)/i;

export async function checkLinks({ build = true } = {}) {
  const rows = [];
  const ok = (area, what, pass, note = '') => rows.push({ area, what, pass: !!pass, note });
  if (build) execFileSync(process.execPath, ['scripts/build-site.mjs'], { cwd: ROOT, env: { PATH: process.env.PATH }, stdio: 'pipe' });

  // The real router on fakes, for /api routes and the email walk.
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const env = { APP_ORIGIN: O, SESSION_SECRET: rnd(32), ADMIN_AUTH_SECRET: rnd(32), ADMIN_AUTH_SIGNER_SECRET: rnd(32), CRON_SECRET: rnd(16) };
  const clock = new FakeClock(Date.parse('2026-10-15T10:00:00Z'));
  const repo = new MemoryRepo();
  const app = createApp({ config: loadConfig(env), repo, botCheck: new FakeBotCheck(), storage: new FakeStorage(clock, 600), mailer: null, clock, log: createLogger(() => {}), releases, roadmapIds: roadmap.ids });
  const call = (method, p, { headers = {}, body } = {}) => app.fetch(new Request(O + p, { method, redirect: 'manual', headers: { origin: O, 'x-real-ip': '198.51.100.9', ...headers }, body }));
  const routeExists = async (p, method = 'GET') => (await call(method, p, method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {})).status !== 404;

  // ── 1. dist/ pages ────────────────────────────────────────────────────────
  const pages = fs.readdirSync(DIST).filter(f => f.endsWith('.html'));
  const src = Object.fromEntries(pages.map(f => [f, fs.readFileSync(path.join(DIST, f), 'utf8')]));
  const fileExists = (rel) => { const f = path.join(DIST, rel); return f.startsWith(DIST + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile(); };
  const supportTabs = [...(src['Support.dc.html'] || '').matchAll(/^ {6}(\w+): \{ label: '/gm)].map(m => m[1]);
  const hashOk = (page, h) => {
    const t = src[page];
    if (!t) return false;
    if (page === 'Support.dc.html' && supportTabs.includes(h)) return true;
    if (new RegExp(`\\bid="${h}"`).test(t)) return true;
    return /location\.hash/.test(t) && new RegExp(`['"]#${h}['"]`).test(t);
  };
  const importers = (comp) => pages.filter(p => !COMPONENTS.includes(p) && src[p].includes(`<dc-import name="${comp.replace('.dc.html', '')}"`));
  const external = new Set();
  let checked = 0;

  async function resolve(from, link, area) {
    if (!link || link.includes('{{') || EXTERNAL.test(link)) {
      if (EXTERNAL.test(link || '')) {
        external.add(link);
        if (/^mailto:/i.test(link)) ok(area, `${from} → ${link}`, /^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(link), 'mailto address shape');
      }
      return;
    }
    checked++;
    if (link.startsWith('#')) {
      const hosts = COMPONENTS.includes(from) ? importers(from) : [from];
      if (COMPONENTS.includes(from) && !hosts.length) return; // a standalone canvas no page imports
      const bad = hosts.filter(h => !hashOk(h, link.slice(1)));
      return ok(area, `${from} → ${link}`, !bad.length, bad.length ? 'missing on ' + bad.join(', ') : `${hosts.length} page(s)`);
    }
    const u = new URL(link, O + '/' + encodeURIComponent(from));
    let rel = decodeURIComponent(u.pathname).replace(/^\//, '');
    if (u.pathname === '/') rel = 'Home.dc.html'; // vercel.json rewrite
    if (rel.startsWith('api/')) return ok(area, `${from} → ${link}`, await routeExists(u.pathname + u.search), 'API route');
    const exists = fileExists(rel);
    const h = u.hash ? u.hash.slice(1) : '';
    ok(area, `${from} → ${link}`, exists && (!h || !rel.endsWith('.html') || hashOk(rel, h)), !exists ? 'no such file in dist/' : (h && !hashOk(rel, h) ? `#${h} not on ${rel}` : ''));
  }

  for (const p of pages) {
    const t = src[p];
    const links = new Set();
    for (const m of t.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) links.add(m[1]);
    for (const s of t.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const m of s[1].matchAll(/['"`]((?:\/|[A-Za-z0-9])[A-Za-z0-9 %_./-]*\.html(?:#[A-Za-z0-9_-]+)?)['"`]/g)) links.add(m[1]);
      for (const m of s[1].matchAll(/href:\s*'(#[A-Za-z][\w-]*)'/g)) links.add(m[1]);
      for (const m of s[1].matchAll(/['"`]((?:https?:|mailto:)[^'"`\s]+)['"`]/g)) links.add(m[1]);
    }
    for (const l of links) await resolve(p, l, 'dist');
  }

  // ── 2. server pages and redirects ─────────────────────────────────────────
  const serverPages = {
    ...Object.fromEntries(['confirm', 'updates', 'notify', 'access'].flatMap(pp => [[`linkPage(${pp})`, linkPage({ purpose: pp, nonce: 'n', siteKey: 'k', valid: true })], [`linkPage(${pp}, expired)`, linkPage({ purpose: pp, nonce: 'n', siteKey: 'k', valid: false })]])),
    messagePage: messagePage({ nonce: 'n', title: 't', text: 'x' }),
    signupFormPage: signupFormPage({ nonce: 'n', siteKey: 'k' })
  };
  for (const [name, html] of Object.entries(serverPages)) {
    const body = typeof html === 'string' ? html : html.body;
    for (const m of body.matchAll(/\s(href|action)="([^"]*)"/g)) {
      const l = m[2];
      if (EXTERNAL.test(l) || l.startsWith('#')) { if (EXTERNAL.test(l)) external.add(l); continue; }
      checked++;
      const u = new URL(l, O + '/api/x');
      if (u.pathname.startsWith('/api/')) { ok('server', `${name} → ${l}`, await routeExists(u.pathname, m[1] === 'action' ? 'POST' : 'GET'), m[1] === 'action' ? 'form POST route' : 'API route'); continue; }
      const rel = u.pathname === '/' ? 'Home.dc.html' : decodeURIComponent(u.pathname).slice(1);
      ok('server', `${name} → ${l}`, fileExists(rel) && (!u.hash || hashOk(rel, u.hash.slice(1))));
    }
  }
  const nav = { accept: 'text/html', 'sec-fetch-mode': 'navigate' };
  const loc = async (r, what) => {
    const l = r.headers.get('location') || '';
    const u = new URL(l, O);
    ok('redirect', `${what} → ${l || '(none)'}`, l.startsWith('/') && !l.startsWith('//') && u.origin === O && fileExists(decodeURIComponent(u.pathname).slice(1)), `HTTP ${r.status}`);
  };
  await loc(await call('GET', '/api/download/mac/arm64', { headers: nav }), 'download without a session (browser)');
  const form = new URLSearchParams({ name: 'Lin Kay', email: 'links@example.com', macChip: 'apple', phoneModel: 'Pixel 8', privacyAccepted: 'on', marketingOptIn: 'on', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' });
  await loc(await call('POST', '/api/get-sidekick', { headers: { ...nav, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }), 'no-JS signup success');

  // ── 3. email link forms ───────────────────────────────────────────────────
  const urlsIn = (text) => [...text.matchAll(/https?:\/\/\S+/g)].map(m => m[0]);
  async function walk(kind, url, expectPath) {
    const u = new URL(url);
    const q = [...u.searchParams.keys()];
    ok('email', `${kind}: same origin, expected route`, u.origin === O && u.pathname === expectPath, u.pathname);
    ok('email', `${kind}: token only in the #fragment`, /^#t=[A-Za-z0-9_-]{43}$/.test(u.hash) && !u.searchParams.has('t') && q.every(k => k === 'for'), u.search + '#t=…');
    const page = await call('GET', u.pathname + u.search, { headers: nav }); // browsers never send the fragment
    const html = await page.text();
    ok('email', `${kind}: GET opens a page`, page.status === 200 && /text\/html/.test(page.headers.get('content-type') || ''), `HTTP ${page.status}`);
    const pat = html.match(/location\.hash\.match\((\/[^\n]*?\/)\)/);
    const re = pat && new Function(`return ${pat[1]}`)();
    ok('email', `${kind}: page script reads this fragment`, re && re.test(u.hash));
    const action = (html.match(/<form[^>]*action="([^"]+)"/) || [])[1];
    ok('email', `${kind}: form posts to ${action}`, action === u.pathname && await routeExists(action, 'POST'));
    const t = u.hash.slice(3);
    const post = await call('POST', action + u.search, { headers: { ...nav, 'content-type': 'application/x-www-form-urlencoded', referer: O + u.pathname + u.search }, body: new URLSearchParams({ t, 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' }).toString() });
    if (post.status === 303) await loc(post, `${kind}: after the button`);
    else ok('email', `${kind}: after the button`, post.status === 200, `HTTP ${post.status} (message page)`);
    for (const l of [...(await post.clone().text()).matchAll(/\shref="([^"]+)"/g)].map(m => m[1])) if (!EXTERNAL.test(l)) await resolve('Download.dc.html', l, 'email');
  }
  const mails = () => repo.debugOutbox();
  const confirmMail = mails().find(m => m.kind === 'confirm');
  const [confirmUrl, updatesUrl] = urlsIn(confirmMail ? confirmMail.text : '');
  ok('email', 'confirm email has a confirm and an updates link', confirmUrl && updatesUrl);
  if (updatesUrl) await walk('confirm?for=updates', updatesUrl, '/api/confirm-email');
  if (confirmUrl) await walk('confirm', confirmUrl, '/api/confirm-email');
  // Token email (the signer's post) and its access link.
  const s = await repo.getSignupByEmail('links@example.com');
  const body = JSON.stringify({ signupId: s && s.id, token: 'SIDEKICK-TRIAL-1.' + crypto.randomBytes(60).toString('base64url') + '.' + crypto.randomBytes(64).toString('base64url') });
  const h = signRequest({ keyId: 'signer', secret: env.ADMIN_AUTH_SIGNER_SECRET, method: 'POST', path: '/api/admin/token', body, now: clock.now() });
  const tr = await call('POST', '/api/admin/token', { headers: { ...h, 'content-type': 'application/json' }, body });
  ok('email', 'signer stores a token (fake)', tr.status === 200, `HTTP ${tr.status}`);
  const tokenMail = mails().find(m => m.kind === 'token');
  const accessUrl = urlsIn(tokenMail ? tokenMail.text : '').find(x => x.includes('/api/access'));
  ok('email', 'token email has an access link', accessUrl);
  if (accessUrl) await walk('access', accessUrl, '/api/access');
  await call('POST', '/api/roadmap-notify', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'links@example.com', featureId: roadmap.ids[0], captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  const notifyUrl = urlsIn((mails().find(m => m.kind === 'notify') || { text: '' }).text)[0];
  ok('email', 'notify email has a link', notifyUrl);
  if (notifyUrl) await walk('confirm?for=notify', notifyUrl, '/api/confirm-email');
  for (const m of mails()) for (const x of urlsIn(m.text)) ok('email', `${m.kind}: every link is ours`, x.startsWith(O + '/'), x.replace(/#t=.*/, '#t=…'));

  return { rows, failures: rows.filter(r => !r.pass), checked, external: [...external].sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows, failures, checked, external } = await checkLinks();
  const seen = new Set();
  for (const r of rows) { const k = r.area + r.what; if (seen.has(k) && r.pass) continue; seen.add(k); if (!r.pass || process.argv.includes('--all')) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.area}] ${r.what}${r.note ? '  (' + r.note + ')' : ''}`); }
  console.log(`\n${rows.length - failures.length}/${rows.length} checks passed (${checked} internal links). External links, listed and not fetched:`);
  for (const e of external) console.log('  ' + e);
  process.exit(failures.length ? 1 : 0);
}
