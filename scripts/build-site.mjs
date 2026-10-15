// Builds the static site into dist/ for Vercel (vercel.json "buildCommand"). The source stays in design-review
// mode (mocksEnabled: true); dist/ is always the real site:
//   - data/site-config.js gets mocksEnabled: false and the PUBLIC Turnstile site key from TURNSTILE_SITE_KEY;
//   - data/mock-api.js is not copied, and every page loads data/api-client.js instead (real API only);
//   - the Design review bar is cut out of Get Sidekick, and the no-JS signup form goes in its place;
//   - the build fails if any mock switch, review bar or sessionStorage use survives.
//   node scripts/build-site.mjs           on Vercel (needs TURNSTILE_SITE_KEY)
//   node scripts/build-site.mjs --local   for npm run dev: a local stand-in for the human check, never deployable
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { signupFormHtml, FORM_STYLE } from '../server/pages.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'dist');
const local = process.argv.includes('--local');
const fail = (m) => { console.error('build-site: ' + m); process.exit(1); };

for (const check of [['scripts/data-sync.mjs', '--check'], ['tools/noscript.mjs', '--check']]) {
  if (!fs.existsSync(path.join(ROOT, check[0]))) continue; // /tools is not uploaded to Vercel; the owner runs it locally
  try { execFileSync(process.execPath, check, { cwd: ROOT, stdio: 'inherit' }); } catch { fail(`${check[0]} --check failed`); }
}

const siteKey = local ? 'local-dev-fake' : process.env.TURNSTILE_SITE_KEY;
if (!local && process.env.VERCEL && !siteKey) fail('TURNSTILE_SITE_KEY is not set for this environment.');
if (!local && siteKey && (siteKey === 'local-dev-fake' || !/^[0-9A-Za-z_-]{10,64}$/.test(siteKey))) fail('TURNSTILE_SITE_KEY does not look like a Turnstile site key.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const copy = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(OUT, rel), { recursive: true });
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
for (const f of pages) copy(f);
for (const f of ['support.js', 'favicon.ico', 'fonts', 'icons', 'vendor', 'data/site-config.js', 'data/releases.js', 'data/roadmap-data.js', 'data/api-client.js']) copy(f);
fs.mkdirSync(path.join(OUT, 'LOGOS'));
for (const f of fs.readdirSync(path.join(ROOT, 'LOGOS'))) if (f !== 'head_logo1.png') copy('LOGOS/' + f);

// site-config: real mode + public site key.
const cfgPath = path.join(OUT, 'data/site-config.js');
let cfg = fs.readFileSync(cfgPath, 'utf8');
const before = cfg;
cfg = cfg.replace(/mocksEnabled: true,.*$/m, 'mocksEnabled: false,         // production build: real API only').replace(/turnstileSiteKey: null,/, `turnstileSiteKey: ${JSON.stringify(siteKey || null)},`);
if (cfg === before || !/mocksEnabled: false,/.test(cfg)) fail('could not switch mocksEnabled off in data/site-config.js');
fs.writeFileSync(cfgPath, cfg);

// Pages: real API client; no review bar; the plain form for browsers without JavaScript.
const scoped = FORM_STYLE.split('\n').map(rule => rule.replace(/(^|\})\s*([^{}]+)\{/g, (m, b, sel) => `${b}${sel.split(',').map(x => '.skf ' + x.trim().replace(/^body$/, '')).join(',')}{`)).join('\n');
for (const f of pages) {
  const p = path.join(OUT, f);
  let html = fs.readFileSync(p, 'utf8');
  html = html.split('<script src="data/mock-api.js"></script>').join('<script src="data/api-client.js"></script>');
  html = html.replace(/<!-- DESIGN-REVIEW[\s\S]*?<!-- \/DESIGN-REVIEW -->\n?/, '');
  html = html.replace(/<!-- NOJS-FORM[\s\S]*?<!-- \/NOJS-FORM -->/, `<noscript><style>${scoped}</style><div class="skf"><h2 style="margin:0 0 8px;font:800 34px/1 'Bricolage Grotesque',sans-serif;">Get Sidekick</h2><p>This form works without JavaScript, but the human check that protects it doesn't: sending it will ask you to turn JavaScript on.</p>${signupFormHtml()}</div></noscript>`);
  fs.writeFileSync(p, html);
}

// Proof that nothing from design review reaches the deployment.
const all = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); e.isDirectory() ? walk(q) : all.push(q); } };
walk(OUT);
const text = all.filter(f => /\.(html|js|css|json)$/.test(f));
const banned = [['sk_mock_outcome', 'mock outcome switch'], ['DESIGN REVIEW', 'design review bar'], ['mock-api.js', 'mock API'], ['sessionStorage', 'sessionStorage'], ['local-dev-fake', 'local bot-check stand-in']];
for (const f of text) {
  const t = fs.readFileSync(f, 'utf8');
  for (const [needle, what] of banned) {
    if (needle === 'local-dev-fake' && local) continue;
    if (needle === 'local-dev-fake' && f.endsWith('api-client.js')) continue; // the comparison string itself, inert without that key
    if (t.includes(needle)) fail(`${what} found in ${path.relative(OUT, f)}`);
  }
}
if (fs.existsSync(path.join(OUT, 'data/mock-api.js'))) fail('mock-api.js was copied');
console.log(`build-site: ${all.length} files in dist/ (${local ? 'LOCAL — not deployable' : 'real mode'}); mocks off, review bar removed.`);
