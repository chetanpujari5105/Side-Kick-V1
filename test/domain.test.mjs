// The site's own address (launch log Part 19): https://sidekickapp.in. The automated build takes it from APP_ORIGIN and
// adds what search engines read — a canonical link and an absolute share image on the public pages, robots.txt and
// sitemap.xml (public pages only). The manual build gets none of it. Emails take the address the signer talks to
// (SK_API_BASE), so they follow the site through a change of address; no file hard-codes the old one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { emails } from '../server/emails.mjs';
import { renderEmail, SITE, LOGO_URL } from '../server/email-html.mjs';
import { makeMailer, loadSignerConfig } from '../tools/signer/signer.mjs';
import { PUBLIC_PAGES } from '../scripts/seo.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const KEY = '0x4AAAAAAAtestsitekeyonly';
const build = (env, args = []) => spawnSync(process.execPath, ['scripts/build-site.mjs', ...args], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');
const has = (f) => fs.existsSync(path.join(DIST, f));
const restoreLocal = () => execFileSync(process.execPath, ['scripts/build-site.mjs', '--local'], { cwd: ROOT, stdio: 'ignore' });
const NOINDEX = ['Download.dc.html', 'Beta.dc.html', '404.dc.html', 'check-email.html'];
const OLD = 'side-henna' + '.vercel.app';

test('emails: the site address defaults to https://sidekickapp.in and can be given (the signer passes SK_API_BASE)', () => {
  assert.equal(SITE, 'https://sidekickapp.in');
  assert.equal(LOGO_URL, 'https://sidekickapp.in/email/logo.png');
  const m = emails.waitlist({ name: 'chetan' });
  const def = renderEmail(m).html;
  assert.ok(def.includes('src="https://sidekickapp.in/email/logo.png"'), 'logo on the default address');
  assert.match(def, /<a href="https:\/\/sidekickapp\.in\/"[^>]*>sidekickapp\.in<\/a>/, 'footer link and label');
  const other = renderEmail(m, { site: 'https://example.test' }).html;
  assert.ok(other.includes('src="https://example.test/email/logo.png"'), 'logo follows the given address');
  assert.match(other, /<a href="https:\/\/example\.test\/"[^>]*>example\.test<\/a>/, 'footer follows the given address');
  assert.ok(!other.includes('sidekickapp.in'), 'nothing of the default address left');
});

test('signer: Message-ID domain and email logo follow SK_API_BASE (default: sidekickapp.in)', async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-domain-'));
  try {
    const pw = path.join(dir, 'pw'); fs.writeFileSync(pw, 'abcdefghijklmnop', { mode: 0o600 }); fs.chmodSync(pw, 0o600);
    const MSG = { id: '11111111-1111-4111-8111-111111111111', kind: 'waitlist', to: 'a@example.com', ...emails.waitlist({ name: 'chetan' }) };
    const send = async (base) => {
      const sent = [];
      const mail = makeMailer({ ...loadSignerConfig(base ? { SK_API_BASE: base } : {}), smtpPasswordFile: pw }, { smtp: async (o) => sent.push(o), log: () => {} });
      await mail(MSG);
      const raw = sent[0].raw;
      const html = [...raw.matchAll(/Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map(x => Buffer.from(x[1].replace(/\r\n/g, ''), 'base64').toString('utf8'))[0];
      return { raw, html };
    };
    const a = await send('https://example.test');
    assert.match(a.raw, /\r\nMessage-ID: <outbox-11111111-1111-4111-8111-111111111111@example\.test>\r\n/);
    assert.ok(a.html.includes('src="https://example.test/email/logo.png"'));
    const b = await send(null);
    assert.match(b.raw, /\r\nMessage-ID: <outbox-11111111-1111-4111-8111-111111111111@sidekickapp\.in>\r\n/);
    assert.ok(b.html.includes('src="https://sidekickapp.in/email/logo.png"'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no code, page, data or test file names the old vercel.app address', () => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'docs'].includes(e.name) || e.name.startsWith('.tmp-')) continue;
    const q = path.join(d, e.name);
    if (e.isDirectory()) walk(q);
    else if (/\.(mjs|js|html|json|css|txt|xml|template|md)$/.test(e.name) && fs.readFileSync(q, 'utf8').includes(OLD)) hits.push(path.relative(ROOT, q));
  } };
  walk(ROOT);
  assert.deepEqual(hits, []);
});

test('automated build: robots.txt and sitemap.xml on APP_ORIGIN, public pages only', () => {
  const r = build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: KEY, APP_ORIGIN: 'https://example.test' });
  assert.equal(r.status, 0, r.stderr);
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(!/^Disallow: \/\s*$/m.test(robots), 'the site is not closed to crawlers');
  assert.match(robots, /^Disallow: \/download\/$/m, 'crawlers do not fetch the download (it counts downloads)');
  assert.match(robots, /^Sitemap: https:\/\/example\.test\/sitemap\.xml$/m);
  const sm = read('sitemap.xml');
  assert.match(sm, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs, ['https://example.test/', 'https://example.test/Get%20Sidekick.dc.html', 'https://example.test/Roadmap.dc.html', 'https://example.test/Support.dc.html']);
  assert.deepEqual(PUBLIC_PAGES.map(([, f]) => f), ['Home.dc.html', 'Get Sidekick.dc.html', 'Roadmap.dc.html', 'Support.dc.html']);
  for (const t of [robots, sm]) assert.ok(!/Beta|Download\.dc|check-email|confirm|unsubscribe|access|api\//i.test(t), 'no unlisted or noindex page named');
});

test('automated build: canonical, og:image and twitter:image are absolute on the public pages; noindex pages unchanged', () => {
  const r = build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: KEY, APP_ORIGIN: 'https://example.test' });
  assert.equal(r.status, 0, r.stderr);
  for (const [p, f] of PUBLIC_PAGES) {
    const head = read(f).split('</head>')[0];
    const canon = [...head.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map(m => m[1]);
    assert.deepEqual(canon, ['https://example.test' + p], `${f}: one canonical`);
    assert.match(head, /<meta property="og:image" content="https:\/\/example\.test\/icons\/og-image\.png">/, `${f}: og:image`);
    assert.match(head, /<meta name="twitter:image" content="https:\/\/example\.test\/icons\/og-image\.png">/, `${f}: twitter:image`);
    assert.ok(!head.includes('PLACEHOLDER'), `${f}: the placeholder note is gone`);
    assert.ok(!/name="robots"/.test(head), `${f}: indexable`);
  }
  for (const f of NOINDEX) {
    const t = read(f);
    assert.ok(!t.includes('rel="canonical"'), `${f}: no canonical`);
    assert.match(t, /<meta name="robots" content="noindex/, `${f}: still noindex`);
  }
});

test('automated build: APP_ORIGIN must be a bare https origin; Production needs it; elsewhere it defaults to sidekickapp.in', () => {
  for (const bad of ['http://example.test', 'https://example.test/', 'https://example.test/x', 'example.test']) {
    const r = build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: KEY, APP_ORIGIN: bad });
    assert.notEqual(r.status, 0, `APP_ORIGIN=${bad} must fail`);
    assert.match(r.stderr, /APP_ORIGIN/);
  }
  const prod = build({ VERCEL: '1', VERCEL_ENV: 'production', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: KEY });
  assert.notEqual(prod.status, 0); assert.match(prod.stderr, /APP_ORIGIN/);
  const r = build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: KEY });
  assert.equal(r.status, 0, r.stderr);
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/sidekickapp\.in\/sitemap\.xml$/m);
  assert.ok(read('Home.dc.html').includes('<link rel="canonical" href="https://sidekickapp.in/">'));
});

test('manual build: no robots.txt, no sitemap.xml, no canonical, the share image stays as it was', () => {
  const r = build({ VERCEL: '1', SITE_MODE: 'manual', APP_ORIGIN: 'https://example.test' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!has('robots.txt') && !has('sitemap.xml'));
  for (const [, f] of PUBLIC_PAGES) {
    const t = read(f);
    assert.ok(!t.includes('rel="canonical"') && !t.includes('twitter:image') && !t.includes('example.test'), f);
    if (f !== 'Get Sidekick.dc.html' || t.includes('og:image')) assert.match(t, /<meta property="og:image" content="icons\/og-image\.png">/, f);
  }
  restoreLocal();
});
