// The production build can't carry design-review switches: proves it on a fresh dist/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const build = (env) => spawnSync(process.execPath, ['scripts/build-site.mjs'], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('Vercel build refuses to run without a Turnstile site key, or with the local stand-in', () => {
  assert.notEqual(build({ VERCEL: '1' }).status, 0);
  assert.notEqual(build({ VERCEL: '1', TURNSTILE_SITE_KEY: 'local-dev-fake' }).status, 0);
});

test('dist/ is real mode: no mock client, no review bar, no sessionStorage, mocksEnabled false', () => {
  const r = build({ VERCEL: '1', TURNSTILE_SITE_KEY: '0x4AAAAAAAtestsitekeyonly' });
  assert.equal(r.status, 0, r.stderr);
  const dist = path.join(ROOT, 'dist');
  const files = fs.readdirSync(dist, { recursive: true }).map(String).filter(f => /\.(html|js)$/.test(f));
  for (const f of files) {
    const t = fs.readFileSync(path.join(dist, f), 'utf8');
    for (const banned of ['sk_mock_outcome', 'DESIGN REVIEW', 'data/mock-api.js', 'sessionStorage']) assert.ok(!t.includes(banned), `${banned} in ${f}`);
  }
  assert.ok(!fs.existsSync(path.join(dist, 'data/mock-api.js')));
  const cfg = fs.readFileSync(path.join(dist, 'data/site-config.js'), 'utf8');
  assert.match(cfg, /mocksEnabled: false,/);
  assert.match(cfg, /turnstileSiteKey: "0x4AAAAAAAtestsitekeyonly"/);
  for (const f of ['Handoff.md', 'README.md', 'package.json', 'server', 'api', 'tools', 'test', 'docs', 'scripts', 'data/releases.json', 'LOGOS/head_logo1.png'])
    assert.ok(!fs.existsSync(path.join(dist, f)), `${f} must not be served`);
  const gs = fs.readFileSync(path.join(dist, 'Get Sidekick.dc.html'), 'utf8');
  assert.match(gs, /<noscript><style>[\s\S]*action="\/api\/get-sidekick"/, 'the no-JS form is embedded');
  // Source stays in design-review mode.
  assert.match(fs.readFileSync(path.join(ROOT, 'data/site-config.js'), 'utf8'), /mocksEnabled: true,/);
  execFileSync(process.execPath, ['scripts/build-site.mjs', '--local'], { cwd: ROOT, stdio: 'ignore' });
});
