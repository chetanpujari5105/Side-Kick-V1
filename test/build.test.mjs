// The production build can't carry design-review switches, and each SITE_MODE ships only what it needs: proves it
// on a fresh dist/.
import { stripRegions } from '../scripts/site-modes.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const build = (env, args = []) => spawnSync(process.execPath, ['scripts/build-site.mjs', ...args], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
const distText = () => fs.readdirSync(DIST, { recursive: true }).map(String).filter(f => /\.(html|js|css|json|txt|xml)$/.test(f)).map(f => [f, fs.readFileSync(path.join(DIST, f), 'utf8')]);
const restoreLocal = () => execFileSync(process.execPath, ['scripts/build-site.mjs', '--local'], { cwd: ROOT, stdio: 'ignore' });

test('SITE_MODE: an invalid value fails; unset builds manual, loudly', () => {
  for (const bad of ['Manual', 'auto', 'manual ', 'production']) {
    const r = build({ VERCEL: '1', SITE_MODE: bad, TURNSTILE_SITE_KEY: '0x4AAAAAAAtestsitekeyonly' });
    assert.notEqual(r.status, 0, `SITE_MODE=${JSON.stringify(bad)} must fail`);
    assert.match(r.stderr, /SITE_MODE must be "manual" or "automated"/, 'it fails because of SITE_MODE, not something else');
  }
  const r = build({ VERCEL: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /SITE_MODE is not set[\s\S]*manual/);
  assert.match(fs.readFileSync(path.join(DIST, 'data/site-config.js'), 'utf8'), /siteMode: 'manual',/);
  restoreLocal();
});

test('automated: the Vercel build refuses to run without a Turnstile site key, or with the local stand-in', () => {
  assert.notEqual(build({ VERCEL: '1', SITE_MODE: 'automated' }).status, 0);
  assert.notEqual(build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: 'local-dev-fake' }).status, 0);
});

test('automated: dist/ is real mode — no mock client, no review bar, no sessionStorage, mocksEnabled false, no manual-mode code', () => {
  const r = build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: '0x4AAAAAAAtestsitekeyonly' });
  assert.equal(r.status, 0, r.stderr);
  for (const [f, t] of distText()) {
    for (const banned of ['sk_mock_outcome', 'DESIGN REVIEW', 'data/mock-api.js', 'sessionStorage', 'SK_MAILTO', 'data/mailto.js', '{MANUAL', 'MANUAL}']) assert.ok(!t.includes(banned), `${banned} in ${f}`);
  }
  assert.ok(!fs.existsSync(path.join(DIST, 'data/mock-api.js')));
  assert.ok(!fs.existsSync(path.join(DIST, 'data/mailto.js')));
  assert.ok(fs.existsSync(path.join(DIST, 'data/api-client.js')));
  assert.ok(fs.existsSync(path.join(DIST, 'check-email.html')));
  const cfg = fs.readFileSync(path.join(DIST, 'data/site-config.js'), 'utf8');
  assert.match(cfg, /mocksEnabled: false,/);
  assert.match(cfg, /siteMode: 'automated',/);
  assert.match(cfg, /turnstileSiteKey: "0x4AAAAAAAtestsitekeyonly"/);
  for (const f of ['Handoff.md', 'README.md', 'package.json', 'server', 'api', 'tools', 'test', 'docs', 'scripts', 'manual', 'data/releases.json', 'LOGOS/head_logo1.png'])
    assert.ok(!fs.existsSync(path.join(DIST, f)), `${f} must not be served`);
  const gs = fs.readFileSync(path.join(DIST, 'Get Sidekick.dc.html'), 'utf8');
  assert.match(gs, /<noscript><style>[\s\S]*action="\/api\/get-sidekick"/, 'the no-JS form is embedded');
  assert.equal(fs.readFileSync(path.join(DIST, 'Beta.dc.html'), 'utf8'), stripRegions(fs.readFileSync(path.join(ROOT, 'Beta.dc.html'), 'utf8'), 'automated'), 'Beta page ships as written (its automated regions kept)');
  // Source stays in design-review mode.
  assert.match(fs.readFileSync(path.join(ROOT, 'data/site-config.js'), 'utf8'), /mocksEnabled: true,/);
  restoreLocal();
});

test('manual: builds on Vercel with no secret at all, and ships nothing that talks to a backend, Cloudflare or a cookie', () => {
  const r = build({ VERCEL: '1', SITE_MODE: 'manual' });
  assert.equal(r.status, 0, r.stderr);
  const files = distText();
  assert.ok(files.length > 15);
  for (const [f, t] of files) {
    for (const re of [/\/api\//, /turnstile/i, /challenges\.cloudflare\.com/, /document\.cookie/, /cookieStore/, /sk_session/, /SK_API/, /SK_BOT/, /sessionStorage/, /<form\b/i, /\{AUTOMATED|AUTOMATED\}/, /sk_mock_outcome/, /DESIGN REVIEW/])
      assert.ok(!re.test(t), `${re} in ${f}`);
  }
  for (const f of ['data/api-client.js', 'data/mock-api.js', 'check-email.html', 'manual']) assert.ok(!fs.existsSync(path.join(DIST, f)), `${f} must not be in a manual build`);
  assert.ok(fs.existsSync(path.join(DIST, 'data/mailto.js')));
  const cfg = fs.readFileSync(path.join(DIST, 'data/site-config.js'), 'utf8');
  assert.match(cfg, /siteMode: 'manual',/);
  assert.match(cfg, /mocksEnabled: false,/);
  assert.doesNotMatch(cfg, /turnstileSiteKey/);
  const gs = fs.readFileSync(path.join(DIST, 'Get Sidekick.dc.html'), 'utf8');
  assert.match(gs, /href="mailto:chetanpujari\.sitit@gmail\.com\?subject=Sidekick%20beta%3A%20request%20access&amp;body=/, 'Get Sidekick is the request-access email');
  assert.match(fs.readFileSync(path.join(DIST, 'Download.dc.html'), 'utf8'), /Beta by invitation/);
  assert.equal(fs.readFileSync(path.join(DIST, 'Beta.dc.html'), 'utf8'), stripRegions(fs.readFileSync(path.join(ROOT, 'Beta.dc.html'), 'utf8'), 'manual'), 'Beta page ships as written (its automated regions removed)');
  restoreLocal();
});

test('site-modes: the manual guard names each leak; regions strip by mode and markers never survive', async () => {
  const { manualLeaks, stripRegions, resolveMode } = await import('../scripts/site-modes.mjs');
  for (const leak of ["fetch('/api/session')", '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>', "document.cookie='a=b'",
    'window.SK_API.feedback()', 'window.SK_BOT.ensure()', '<form action="/x">', "sessionStorage.setItem('k','v')", 'sk_session', 'cookieStore.set()'])
    assert.ok(manualLeaks('<p>ok</p>' + leak).length > 0, `not caught: ${leak}`);
  assert.deepEqual(manualLeaks('<a href="mailto:a@example.com?subject=Hi">Email</a> This site sets no cookies.'), []);
  const src = 'a<!--AUTOMATED{-->AUTO<!--}AUTOMATED-->b<!--MANUAL{-->MAN<!--}MANUAL-->c x = m ? (/*MANUAL{*/ 1 ?? /*}MANUAL*/ null) : (/*AUTOMATED{*/ 2 ?? /*}AUTOMATED*/ null);';
  assert.equal(stripRegions(src, 'manual'), 'abMANc x = m ? ( 1 ??  null) : ( null);');
  assert.equal(stripRegions(src, 'automated'), 'aAUTObc x = m ? ( null) : ( 2 ??  null);');
  assert.throws(() => stripRegions('<!--MANUAL{-->unclosed', 'automated'), /unbalanced/);
  assert.deepEqual(resolveMode({}), { mode: 'manual', defaulted: true });
  assert.deepEqual(resolveMode({ SITE_MODE: 'automated' }), { mode: 'automated', defaulted: false });
  assert.throws(() => resolveMode({ SITE_MODE: 'Automated' }), /SITE_MODE/);
});

test('timing copy reaches the built sites: automated says up to a day, manual keeps its own words', () => {
  let r = build({ VERCEL: '1', SITE_MODE: 'automated', TURNSTILE_SITE_KEY: '0x4AAAAAAAtestsitekeyonly' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['check-email.html', 'Download.dc.html']) assert.match(fs.readFileSync(path.join(DIST, f), 'utf8'), /can take up to a day to arrive/, f);
  r = build({ VERCEL: '1', SITE_MODE: 'manual' });
  assert.equal(r.status, 0, r.stderr);
  for (const [f, t] of distText()) assert.ok(!/up to a day|within a day of confirming|not your phone number/.test(t), `manual ${f} changed`);
  assert.match(fs.readFileSync(path.join(DIST, 'Download.dc.html'), 'utf8'), /Wait for our reply\.<\/strong> We read each request ourselves/);
  restoreLocal();
});
