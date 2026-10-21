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
// 4. The unlisted Beta page: noindex/nofollow in its <head> and in vercel.json, no link to it from any page,
//    component, server page, email or script, its only outside links are releases.json's Drive and Play test
//    links (automated site: the Play test link only, and no checksum), and no .apk anywhere. The Download page
//    carries neither link. The HTML emails' images are files the built site serves (email/logo.png). robots.txt and
//    sitemap.xml: none in the manual site; in the automated site exactly the public pages, each with its canonical link.
// 5. SITE_MODE=manual (--mode manual): sections 2 and 3 do not apply (no API, no email links). Instead every mailto
//    must go to the support address with only a subject and body; Get Sidekick, Download, the roadmap suggestion box
//    and every roadmap item's Notify link must be the right email.
//   node tools/check-links.mjs                 both modes
//   node tools/check-links.mjs --mode manual   one mode
// Exits 1 on any problem. Imported by test/links.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/app.mjs';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { FakeBotCheck, FakeStorage, FakeClock } from '../server/fakes.mjs';
import { loadConfig } from '../server/config.mjs';
import { MSG } from '../server/validate.mjs';
import { emails } from '../server/emails.mjs';
import { createLogger } from '../server/log.mjs';
import { linkPage, messagePage, signupFormPage } from '../server/pages.mjs';
import { signRequest } from '../server/crypto.mjs';
import { PUBLIC_PAGES, DEFAULT_ORIGIN } from '../scripts/seo.mjs';
import releases from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const O = 'https://sidekick-links.example.test';
const COMPONENTS = ['SiteHeader.dc.html', 'SiteFooter.dc.html', 'MacWindow.dc.html', 'PhoneScreen.dc.html', 'RoadmapTrack.dc.html'];
const EXTERNAL = /^(https?:|mailto:|tel:|data:)/i;

// The support address and the mail texts, read the way the pages read them.
function mailSources() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const f of ['data/site-config.js', 'data/roadmap-data.js', 'data/mailto.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox);
  return { C: sandbox.window.SK_CONFIG, RM: sandbox.window.SK_ROADMAP, M: sandbox.window.SK_MAILTO };
}
const unamp = (s) => s.replace(/&amp;/g, '&');
// A mailto we write: exactly the support address, and nothing but a subject and/or body that decode cleanly.
export function mailtoProblem(link, to) {
  const m = /^mailto:([^?]*)(?:\?(.*))?$/i.exec(link);
  if (!m) return 'not a mailto';
  if (decodeURIComponent(m[1]) !== to) return `addressed to ${m[1]}, not ${to}`;
  if (!m[2]) return '';
  for (const part of m[2].split('&')) {
    const [k, v = ''] = part.split('=');
    if (!['subject', 'body'].includes(k)) return `unexpected field ${k}`;
    try { decodeURIComponent(v); } catch { return `${k} does not decode`; }
    if (/[\s<>"]/.test(v)) return `${k} is not percent-encoded`;
  }
  return '';
}

export async function checkLinks({ build = true, mode = 'automated' } = {}) {
  const rows = [];
  const ok = (area, what, pass, note = '') => rows.push({ area, what: `[${mode}] ${what}`, pass: !!pass, note });
  const manual = mode === 'manual';
  const { C: CFG, RM, M } = mailSources();
  if (build) execFileSync(process.execPath, ['scripts/build-site.mjs'], { cwd: ROOT, env: { PATH: process.env.PATH, SITE_MODE: mode }, stdio: 'pipe' });

  // The real router on fakes, for /api routes and the email walk.
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const env = { APP_ORIGIN: O, SESSION_SECRET: rnd(32), ADMIN_AUTH_SECRET: rnd(32), ADMIN_AUTH_SIGNER_SECRET: rnd(32), CRON_SECRET: rnd(16) };
  const clock = new FakeClock(Date.parse('2026-10-15T10:00:00Z'));
  const repo = new MemoryRepo();
  const app = createApp({ config: loadConfig(env), repo, botCheck: new FakeBotCheck(), storage: new FakeStorage(clock, 600), mailer: null, clock, log: createLogger(() => {}), releases, roadmapIds: roadmap.ids });
  const call = (method, p, { headers = {}, body } = {}) => app.fetch(new Request(O + p, { method, redirect: 'manual', headers: { origin: O, 'x-real-ip': '198.51.100.9', ...headers }, body }));
  const rewrites = (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).rewrites || []).filter(r => /^\/api\/index\?__route=/.test(r.destination)).map(r => r.source);
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
        if (/^mailto:/i.test(link)) { const bad = mailtoProblem(unamp(link), CFG.supportEmail); ok(area, `${from} → ${link.slice(0, 70)}`, !bad, bad || 'mailto: support address, subject/body only'); }
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
    if (u.pathname === '/download/mac') return ok(area, `${from} → ${link}`, rewrites.includes('/download/mac') && await routeExists('/download/mac'), 'download route (vercel.json rewrite)');
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

  // ── 2. server pages and redirects (automated only: a manual site has no API) ──
  const serverPages = manual ? {} : {
    ...Object.fromEntries(['confirm', 'updates', 'access', 'unsubscribe'].flatMap(pp => [[`linkPage(${pp})`, linkPage({ purpose: pp, nonce: 'n', siteKey: 'k', valid: true })], [`linkPage(${pp}, expired)`, linkPage({ purpose: pp, nonce: 'n', siteKey: 'k', valid: false })]])),
    messagePage: messagePage({ nonce: 'n', title: 't', text: 'x' }),
    signupFormPage: signupFormPage({ nonce: 'n', siteKey: 'k' }),
    'signupFormPage(phone number)': signupFormPage({ nonce: 'n', siteKey: 'k', values: { phoneModel: '07700 900123' }, errors: { phoneModel: MSG.phoneNumber } })
  };
  for (const [name, html] of Object.entries(serverPages)) {
    const body = typeof html === 'string' ? html : html.body;
    for (const m of body.matchAll(/\s(href|action)="([^"]*)"/g)) {
      const l = m[2];
      if (EXTERNAL.test(l) || l.startsWith('#')) { if (EXTERNAL.test(l)) external.add(l); continue; }
      checked++;
      const u = new URL(l, O + '/api/x');
      if (u.pathname === '/download/mac') { ok('server', `${name} → ${l}`, rewrites.includes('/download/mac') && await routeExists(u.pathname), 'download route (vercel.json rewrite)'); continue; }
      if (u.pathname.startsWith('/api/')) { ok('server', `${name} → ${l}`, await routeExists(u.pathname, m[1] === 'action' ? 'POST' : 'GET'), m[1] === 'action' ? 'form POST route' : 'API route'); continue; }
      const rel = u.pathname === '/' ? 'Home.dc.html' : decodeURIComponent(u.pathname).slice(1);
      ok('server', `${name} → ${l}`, fileExists(rel) && (!u.hash || hashOk(rel, u.hash.slice(1))));
    }
  }
  const nav = { accept: 'text/html', 'sec-fetch-mode': 'navigate' };
  const mails = () => repo.debugOutbox();
  if (!manual) {
  const loc = async (r, what) => {
    const l = r.headers.get('location') || '';
    const u = new URL(l, O);
    ok('redirect', `${what} → ${l || '(none)'}`, l.startsWith('/') && !l.startsWith('//') && u.origin === O && fileExists(decodeURIComponent(u.pathname).slice(1)), `HTTP ${r.status}`);
  };
  await loc(await call('GET', '/api/download/mac/arm64', { headers: nav }), 'download without a session (browser)');
  const form = new URLSearchParams({ name: 'Lin Kay', email: 'links@example.com', macChip: 'apple', phoneModel: 'Pixel 8', googleEmail: 'lin.kay@gmail.com', privacyAccepted: 'on', marketingOptIn: 'on', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' });
  await loc(await call('POST', '/api/get-sidekick', { headers: { ...nav, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }), 'no-JS signup success');
  ok('redirect', 'check-email.html (the no-JS landing) says emails can take up to a day', /can take up to a day to arrive/.test(fs.readFileSync(path.join(DIST, 'check-email.html'), 'utf8')) && fs.readFileSync(path.join(DIST, 'check-email.html'), 'utf8').includes('After you confirm, we email your beta token, usually within a day.'));
  form.set('phoneModel', '07700 900123');
  const pn = await call('POST', '/api/get-sidekick', { headers: { ...nav, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  ok('server', 'no-JS signup with a phone number → 400 page with the plain message', pn.status === 400 && (await pn.text()).includes(MSG.phoneNumber.replace(/'/g, '&#39;')), `HTTP ${pn.status}`);

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
  const confirmMail = mails().find(m => m.kind === 'confirm');
  const cLinks = urlsIn(confirmMail ? confirmMail.text : '');
  const confirmUrl = cLinks.find(x => /\/api\/confirm-email#t=/.test(x)), updatesUrl = cLinks.find(x => /for=updates#t=/.test(x));
  ok('email', 'confirm email has a confirm and an updates link', confirmUrl && updatesUrl);
  ok('email', 'confirm email: the Mac download is /download/mac', cLinks.includes(O + '/download/mac') && (await call('GET', '/download/mac')).status === 302);
  if (updatesUrl) await walk('confirm?for=updates', updatesUrl, '/api/confirm-email');
  if (confirmUrl) await walk('confirm', confirmUrl, '/api/confirm-email');
  // The owner adds the Google account to the Play test list (PLAY_GATE=on), then the signer posts a token:
  // the invitation carries the download link, the token email carries no link at all.
  const adminPost = async (action, payload) => {
    const b = JSON.stringify(payload);
    const hh = signRequest({ keyId: 'admin', secret: env.ADMIN_AUTH_SECRET, method: 'POST', path: '/api/admin/' + action, body: b, now: clock.now() });
    return call('POST', '/api/admin/' + action, { headers: { ...hh, 'content-type': 'application/json' }, body: b });
  };
  ok('email', 'play-mark-added (admin)', (await adminPost('play-mark-added', { googleEmails: ['lin.kay@gmail.com'] })).status === 200);
  const s = await repo.getSignupByEmail('links@example.com');
  const body = JSON.stringify({ signupId: s && s.id, token: 'SIDEKICK-TRIAL-1.' + crypto.randomBytes(60).toString('base64url') + '.' + crypto.randomBytes(64).toString('base64url') });
  const h = signRequest({ keyId: 'signer', secret: env.ADMIN_AUTH_SIGNER_SECRET, method: 'POST', path: '/api/admin/token', body, now: clock.now() });
  const tr = await call('POST', '/api/admin/token', { headers: { ...h, 'content-type': 'application/json' }, body });
  ok('email', 'signer stores a token (fake)', tr.status === 200, `HTTP ${tr.status}`);
  const tokenMail = mails().find(m => m.kind === 'token');
  ok('email', 'token email has no link at all', tokenMail && urlsIn(tokenMail.text).length === 0);
  const inviteMail = mails().find(m => m.kind === 'invite');
  ok('email', 'invitation: the Mac download is /download/mac, no access link any more', inviteMail && urlsIn(inviteMail.text).includes(O + '/download/mac') && !inviteMail.text.includes('/api/access'));
  // An access link from an older email still opens the Download page (the recovery page, launch log Part 7).
  const at = crypto.randomBytes(32).toString('base64url');
  await repo.createLink({ hash: crypto.createHash('sha256').update(at).digest('hex'), purpose: 'access', refId: s.id, expiresAt: clock.now() + 3600000, maxUses: 10 }, clock.now());
  await walk('access', `${O}/api/access#t=${at}`, '/api/access');
  // The instant flow: a pool token, the no-JS result page and its links, "Email me a copy".
  const poolTok = () => { const st = new Date(clock.now()); st.setUTCHours(0, 0, 0, 0); return 'SIDEKICK-TRIAL-1.' + Buffer.from(JSON.stringify({ v: 1, id: crypto.randomBytes(12).toString('base64url'), label: 'Sidekick beta', notBefore: st.toISOString(), notAfter: new Date(st.getTime() + 45 * 864e5).toISOString() })).toString('base64url') + '.' + crypto.randomBytes(64).toString('base64url'); };
  const pb = JSON.stringify({ tokens: [poolTok()] });
  const ph = signRequest({ keyId: 'signer', secret: env.ADMIN_AUTH_SIGNER_SECRET, method: 'POST', path: '/api/admin/pool-add', body: pb, now: clock.now() });
  ok('email', 'signer fills the pool (fake token)', (await call('POST', '/api/admin/pool-add', { headers: { ...ph, 'content-type': 'application/json' }, body: pb })).status === 200);
  const inst = await call('POST', '/api/get-sidekick', { headers: { ...nav, 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '198.51.100.77' }, body: new URLSearchParams({ name: 'Ina Stant', email: 'instant@example.com', privacyAccepted: 'on', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' }).toString() });
  const instHtml = await inst.text();
  ok('server', 'no-JS instant result page (200, You\'re in)', inst.status === 200 && /You(&#39;|')re in, Ina/.test(instHtml), `HTTP ${inst.status}`);
  for (const m of instHtml.matchAll(/\s(href|action)="([^"]*)"/g)) {
    const l = m[2];
    if (EXTERNAL.test(l)) { ok('server', `result page → ${l.slice(0, 60)}`, false, 'nothing leaves the site (no Drive link since launch log Part 11)'); continue; }
    checked++;
    const u = new URL(l, O + '/api/x');
    if (u.pathname === '/download/mac') ok('server', `result page → ${l}`, (await call('GET', l)).status === 302, 'download route');
    else if (u.pathname.startsWith('/api/')) ok('server', `result page → ${l}`, await routeExists(u.pathname, m[1] === 'action' ? 'POST' : 'GET'));
    else ok('server', `result page → ${l}`, fileExists(u.pathname === '/' ? 'Home.dc.html' : decodeURIComponent(u.pathname).slice(1)) && (!u.hash || hashOk(decodeURIComponent(u.pathname).slice(1), u.hash.slice(1))));
  }
  const ic = (inst.headers.get('set-cookie') || '').split(';')[0];
  const cp = await call('POST', '/api/email-copy', { headers: { ...nav, 'content-type': 'application/x-www-form-urlencoded', cookie: ic }, body: '' });
  ok('email', '"Email me a copy" (no-JS button) → a page', cp.status === 200, `HTTP ${cp.status}`);
  const copyMail = mails().find(m => m.kind === 'copy');
  ok('email', 'copy email: exactly one link, /download/mac (no Drive folder, no setup guide: launch log Part 11)', copyMail && JSON.stringify(urlsIn(copyMail.text)) === JSON.stringify([O + '/download/mac']), copyMail ? urlsIn(copyMail.text).join(' ') : 'no copy email');
  // An update to people who confirmed updates; its one-use unsubscribe link.
  ok('email', 'announce (admin)', (await adminPost('announce', { subject: 'Links check', body: 'Hello.' })).status === 200);
  const unsubUrl = urlsIn((mails().find(m => m.kind === 'announce') || { text: '' }).text).find(x => x.includes('/api/unsubscribe'));
  ok('email', 'update email has an unsubscribe link', unsubUrl);
  if (unsubUrl) await walk('unsubscribe', unsubUrl, '/api/unsubscribe');
  // Roadmap notify is closed (launch log Part 14): no email, so no link to walk.
  const nr = await call('POST', '/api/roadmap-notify', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'links@example.com', featureId: roadmap.ids[0], captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  ok('email', 'roadmap notify is closed (410, no email)', nr.status === 410 && !mails().some(m => m.kind === 'notify'), String(nr.status));
  // Every link in our emails is ours, except one release fact: the Play test link (invitation, Android invitation).
  for (const m of mails()) for (const x of urlsIn(m.text)) ok('email', `${m.kind}: every link is ours`, x.startsWith(O + '/') || (['invite', 'android'].includes(m.kind) && x === releases.android.playTestUrl), x);
  // The invitation's links are exactly /download/mac and the Play test link.
  const staticInvite = emails.invite({ name: 'Lin Kay', downloadUrl: O + '/download/mac', release: releases, googleEmail: 'lin.kay@gmail.com' }).text;
  const staticLinks = [...new Set(urlsIn(staticInvite))].sort();
  ok('email', 'invite: links are /download/mac and the Play test link', JSON.stringify(staticLinks) === JSON.stringify([O + '/download/mac', releases.android.playTestUrl].sort()), staticLinks.join(' '));
  // The HTML version of every email (launch log Part 11): its images are absolute URLs of files this build serves.
  const { renderEmail, SITE } = await import('../server/email-html.mjs');
  for (const m of mails()) for (const [, src] of renderEmail(m).html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g))
    ok('email', `${m.kind} (HTML): image ${src.replace(SITE, '')}`, src.startsWith(SITE + '/') && fileExists(src.slice(SITE.length + 1)));
  } // end automated-only sections 2 and 3

  // ── 4. the unlisted Beta page ─────────────────────────────────────────────
  const BETA = 'Beta.dc.html';
  const beta = src[BETA] || '';
  ok('beta', `${BETA} is in dist/`, !!beta);
  const head = beta.split('<x-dc>')[0];
  ok('beta', `${BETA}: robots noindex, nofollow in the static <head>`, /<head>[\s\S]*<meta name="robots" content="noindex, nofollow">[\s\S]*<\/head>/.test(head));
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  ok('beta', `${BETA}: vercel.json sends X-Robots-Tag noindex, nofollow`, (vj.headers || []).some(h => h.source === '/' + BETA && h.headers.some(x => x.key === 'X-Robots-Tag' && x.value === 'noindex, nofollow')));
  const mentions = (t) => /Beta\.dc(\.html)?\b|\/Beta\b/.test(t);
  const distText = [];
  const walkDist = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); e.isDirectory() ? walkDist(q) : /\.(html|js|css|json|xml|txt)$/.test(e.name) && distText.push(q); } };
  walkDist(DIST);
  const linkers = distText.filter(f => path.basename(f) !== BETA && mentions(fs.readFileSync(f, 'utf8'))).map(f => path.relative(DIST, f));
  ok('beta', `${BETA}: no other file in dist/ names it (unlisted)`, !linkers.length, linkers.join(', '));
  const serverNames = Object.entries(serverPages).filter(([, h]) => mentions(typeof h === 'string' ? h : h.body)).map(([n]) => n);
  ok('beta', `${BETA}: no server page names it`, !serverNames.length, serverNames.join(', '));
  ok('beta', `${BETA}: no email names it`, !mails().some(m => mentions(m.text)));
  // robots.txt and sitemap.xml (launch log Part 19): the manual site has neither; the automated site has exactly these
  // two, the sitemap lists exactly the public pages (each a file this build serves, with its canonical link) and
  // robots.txt names the sitemap. Neither names the Beta page (the check above covers every .txt/.xml in dist/).
  const crawl = distText.filter(f => /sitemap|robots/i.test(path.basename(f))).map(f => path.relative(DIST, f)).sort();
  if (manual) ok('beta', `${BETA}: no sitemap or robots.txt in dist/`, !crawl.length, crawl.join(', '));
  else {
    ok('seo', 'robots.txt and sitemap.xml are in dist/, and nothing else of the kind', JSON.stringify(crawl) === JSON.stringify(['robots.txt', 'sitemap.xml']), crawl.join(', '));
    const robots = fileExists('robots.txt') ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
    const sitemap = fileExists('sitemap.xml') ? fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') : '';
    ok('seo', 'robots.txt lets crawlers in and names the sitemap', /^User-agent: \*$/m.test(robots) && /^Allow: \/$/m.test(robots) && !/^Disallow: \/\s*$/m.test(robots) && new RegExp(`^Sitemap: ${DEFAULT_ORIGIN.replace(/\./g, '\\.')}/sitemap\\.xml$`, 'm').test(robots));
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    ok('seo', 'sitemap.xml lists exactly the public pages', JSON.stringify(locs) === JSON.stringify(PUBLIC_PAGES.map(([p]) => DEFAULT_ORIGIN + p)), locs.join(' '));
    for (const [p, f] of PUBLIC_PAGES) {
      ok('seo', `sitemap ${p} → ${f} is served`, fileExists(f));
      ok('seo', `${f}: canonical ${DEFAULT_ORIGIN}${p}, absolute share image`, (src[f] || '').includes(`<link rel="canonical" href="${DEFAULT_ORIGIN}${p}">`) && (src[f] || '').includes(`<meta property="og:image" content="${DEFAULT_ORIGIN}/icons/og-image.png">`));
    }
    const listedNoindex = pages.filter(f => /<meta name="robots" content="noindex/.test(src[f] || '') && locs.some(l => decodeURIComponent(l).endsWith('/' + f)));
    ok('seo', 'no noindex page is in the sitemap', !listedNoindex.length, listedNoindex.join(', '));
  }
  // The manual site shares the file through the Drive folder; the automated one downloads through /download/mac and
  // names no Drive folder and no checksum on this page (launch log Part 11).
  const want = (manual ? [releases.mac.betaDriveUrl, releases.android.playTestUrl] : [releases.android.playTestUrl]).filter(Boolean).sort();
  const outside = [...new Set([...beta.matchAll(/\shref="(https?:[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&')))].sort();
  ok('beta', `${BETA}: its outside links are exactly ${manual ? 'the Drive and Play test links' : 'the Play test link'}`, want.length === (manual ? 2 : 1) && JSON.stringify(outside) === JSON.stringify(want), outside.join(' '));
  ok('beta', `${BETA}: the page script reads both links from release facts`, /R\.mac\.betaDriveUrl/.test(beta) && /R\.android\.playTestUrl/.test(beta));
  ok('beta', `${BETA}: no .apk anywhere`, !/\.apk\b/i.test(beta));
  if (manual) ok('beta', `${BETA}: shows the SHA-256 from releases.json`, !!releases.mac.builds.arm64.sha256 && beta.includes(releases.mac.builds.arm64.sha256));
  else ok('beta', `${BETA}: no SHA-256 and no Drive folder in the automated page`, !beta.includes(releases.mac.builds.arm64.sha256) && !beta.includes(releases.mac.betaDriveUrl + '"'));
  const dl = src['Download.dc.html'] || '';
  ok('beta', 'Download.dc.html carries neither beta link', !want.some(u => dl.includes(u)) && !/betaDriveUrl|playTestUrl/.test(dl));

  // ── 5. manual mode: the emails ────────────────────────────────────────────
  if (manual) {
    const hrefs = (page) => [...(src[page] || '').matchAll(/\shref="(mailto:[^"]*)"/g)].map(x => unamp(x[1]));
    const want = (page, subject, what) => ok('manual', `${page}: ${what}`, hrefs(page).some(h => h.startsWith(`mailto:${CFG.supportEmail}?subject=${encodeURIComponent(subject)}&body=`)), hrefs(page).length + ' mailto link(s)');
    want('Get Sidekick.dc.html', M.requestSubject, 'the request-access email');
    want('Download.dc.html', M.requestSubject, 'the request-access email');
    want('Roadmap.dc.html', 'Sidekick: feature suggestion', 'the suggestion email');
    ok('manual', 'Download.dc.html says Beta by invitation', /Beta by invitation/.test(src['Download.dc.html'] || ''));
    ok('manual', 'request email asks for name, chip, phone, Google account and consent',
      (() => { const b = decodeURIComponent(M.request().split('&body=')[1]); return /name/i.test(b) && /chip/i.test(b) && /Apple silicon/.test(b) && /phone model/i.test(b) && /Google account/.test(b) && /Privacy/.test(b) && /agree/.test(b); })());
    const bad = RM.items.map(i => [i.title, mailtoProblem(M.notify(i.title), CFG.supportEmail)]).filter(([, b]) => b);
    ok('manual', `every roadmap item's Notify link is a valid email (${RM.items.length})`, RM.items.length > 0 && !bad.length, bad.map(b => b.join(': ')).join('; '));
    ok('manual', 'RoadmapTrack builds Notify links from SK_MAILTO.notify', /SK_MAILTO\.notify\(it\.title\)/.test(src['RoadmapTrack.dc.html'] || ''));
  }

  return { rows, failures: rows.filter(r => !r.pass), checked, external: [...external].sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mi = process.argv.indexOf('--mode');
  const modes = mi > 0 ? [process.argv[mi + 1]] : ['automated', 'manual'];
  const runs = [];
  for (const mode of modes) runs.push(await checkLinks({ mode }));
  execFileSync(process.execPath, ['scripts/build-site.mjs', '--local'], { cwd: ROOT, stdio: 'pipe' }); // leave dist/ as npm run dev expects
  const rows = runs.flatMap(r => r.rows), failures = runs.flatMap(r => r.failures), checked = runs.reduce((n, r) => n + r.checked, 0);
  const external = [...new Set(runs.flatMap(r => r.external))].sort();
  const seen = new Set();
  for (const r of rows) { const k = r.area + r.what; if (seen.has(k) && r.pass) continue; seen.add(k); if (!r.pass || process.argv.includes('--all')) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.area}] ${r.what}${r.note ? '  (' + r.note + ')' : ''}`); }
  console.log(`\n${rows.length - failures.length}/${rows.length} checks passed (${checked} internal links). External links, listed and not fetched:`);
  for (const e of external) console.log('  ' + e);
  process.exit(failures.length ? 1 : 0);
}
