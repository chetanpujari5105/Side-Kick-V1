// Builds the static site into dist/ for Vercel (vercel.json "buildCommand"). The source stays in design-review
// mode (mocksEnabled: true); dist/ is always a real site, in the mode SITE_MODE names (scripts/site-modes.mjs):
//   SITE_MODE=manual (the default; unset builds manual with a warning) — the email-only beta. No backend, no
//     Turnstile, no cookies, no forms; needs no secret. Get Sidekick and Download come from manual/, every
//     automated-only region is removed, and the build fails if any /api call, Turnstile reference, cookie or
//     storage write, form or API client survives.
//   SITE_MODE=automated — the full backend flow:
//     - data/site-config.js gets mocksEnabled: false and the PUBLIC Turnstile site key from TURNSTILE_SITE_KEY;
//     - data/mock-api.js is not copied, and every page loads data/api-client.js instead (real API only);
//     - the Design review bar is cut out of Get Sidekick, and the no-JS signup form goes in its place;
//     - email/logo.png (the HTML emails' logo) is served.
//   Both: the build fails if any mock switch, review bar or sessionStorage use survives. Any other SITE_MODE fails.
//   node scripts/build-site.mjs           on Vercel (automated needs TURNSTILE_SITE_KEY; manual needs nothing)
//   node scripts/build-site.mjs --local   for npm run dev: automated, with a local stand-in for the human check,
//                                         never deployable
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { signupFormHtml, FORM_STYLE } from '../server/pages.mjs';
import { resolveMode, stripRegions, manualLeaks } from './site-modes.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'dist');
const local = process.argv.includes('--local');
const fail = (m) => { console.error('build-site: ' + m); process.exit(1); };

let mode;
try {
  const r = local ? { mode: 'automated', defaulted: false } : resolveMode(process.env);
  mode = r.mode;
  if (r.defaulted) console.error('\nbuild-site: ⚠ SITE_MODE is not set — building the MANUAL (email-only) site. Set SITE_MODE=manual or SITE_MODE=automated to choose.\n');
} catch (e) { fail(e.message); }
const manual = mode === 'manual';

for (const check of [['scripts/data-sync.mjs', '--check'], ['tools/noscript.mjs', '--check']]) {
  if (!fs.existsSync(path.join(ROOT, check[0]))) continue; // /tools is not uploaded to Vercel; the owner runs it locally
  try { execFileSync(process.execPath, check, { cwd: ROOT, stdio: 'inherit' }); } catch { fail(`${check[0]} --check failed`); }
}

const siteKey = manual ? null : (local ? 'local-dev-fake' : process.env.TURNSTILE_SITE_KEY);
if (!manual && !local && process.env.VERCEL && !siteKey) fail('TURNSTILE_SITE_KEY is not set for this environment (SITE_MODE=automated).');
if (!manual && !local && siteKey && (siteKey === 'local-dev-fake' || !/^[0-9A-Za-z_-]{10,64}$/.test(siteKey))) fail('TURNSTILE_SITE_KEY does not look like a Turnstile site key.');
if (!manual && !local && siteKey && process.env.VERCEL_ENV === 'production' && /^[123]x0{20,}[A-Z]{2}$/.test(siteKey)) fail('TURNSTILE_SITE_KEY is a Cloudflare test key; Production needs the real widget key.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
const copy = (rel, to = rel) => fs.cpSync(path.join(ROOT, rel), path.join(OUT, to), { recursive: true });
// check-email.html is where the automated no-JS signup lands; a manual site has no signup to land from.
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !(manual && f === 'check-email.html'));
for (const f of pages) copy(f);
if (manual) for (const f of fs.readdirSync(path.join(ROOT, 'manual')).filter(f => f.endsWith('.html'))) {
  if (!pages.includes(f)) fail(`manual/${f} has no automated page of the same name to replace`);
  copy('manual/' + f, f);
}
for (const f of ['support.js', 'favicon.ico', 'fonts', 'icons', 'vendor', 'data/site-config.js', 'data/releases.js', 'data/roadmap-data.js', manual ? 'data/mailto.js' : 'data/api-client.js']) copy(f);
fs.mkdirSync(path.join(OUT, 'LOGOS'));
for (const f of fs.readdirSync(path.join(ROOT, 'LOGOS'))) if (f !== 'head_logo1.png') copy('LOGOS/' + f);
// The email logo (launch log Part 11): the HTML emails load it from https://<site>/email/logo.png. Automated only (the
// manual site sends no email), so the manual build stays as it was.
if (!manual) copy('email');

// site-config: real mode, the site mode, and (automated only) the public site key.
const cfgPath = path.join(OUT, 'data/site-config.js');
let cfg = fs.readFileSync(cfgPath, 'utf8');
const before = cfg;
try { cfg = stripRegions(cfg, mode); } catch (e) { fail(`data/site-config.js: ${e.message}`); } // e.g. the automated site's effective date
cfg = cfg.replace(/mocksEnabled: true,.*$/m, `mocksEnabled: false,         // production build: ${manual ? 'no API at all' : 'real API only'}`)
  .replace(/siteMode: '[a-z]+',/, `siteMode: '${mode}',`);
cfg = manual ? cfg.replace(/^.*turnstileSiteKey: null,.*\n/m, '').replace(/^\/\/ mocksEnabled[^\n]*\n/m, '') : cfg.replace(/turnstileSiteKey: null,/, `turnstileSiteKey: ${JSON.stringify(siteKey || null)},`);
cfg = cfg.replace(/^\/\/ Sidekick website — config flags\.[\s\S]*?\nwindow\.SK_CONFIG/m, `// Sidekick website — config flags (built: SITE_MODE=${mode}).\nwindow.SK_CONFIG`);
if (cfg === before || !/mocksEnabled: false,/.test(cfg) || !new RegExp(`siteMode: '${mode}',`).test(cfg)) fail('could not set mocksEnabled and siteMode in data/site-config.js');
if (manual && /turnstile/i.test(cfg)) fail('could not remove the Turnstile key line from data/site-config.js');
fs.writeFileSync(cfgPath, cfg);

// Pages: the mode's regions; automated gets the real API client, no review bar and the plain no-JS form.
const scoped = FORM_STYLE.split('\n').map(rule => rule.replace(/(^|\})\s*([^{}]+)\{/g, (m, b, sel) => `${b}${sel.split(',').map(x => '.skf ' + x.trim().replace(/^body$/, '')).join(',')}{`)).join('\n');
for (const f of pages) {
  const p = path.join(OUT, f);
  let html = fs.readFileSync(p, 'utf8');
  try { html = stripRegions(html, mode); } catch (e) { fail(`${f}: ${e.message}`); }
  html = html.split('<script src="data/mock-api.js"></script>').join(manual ? '' : '<script src="data/api-client.js"></script>');
  html = html.replace(/<!-- DESIGN-REVIEW[\s\S]*?<!-- \/DESIGN-REVIEW -->\n?/, '');
  html = html.replace(/<!-- NOJS-FORM[\s\S]*?<!-- \/NOJS-FORM -->/, manual ? '' : `<noscript><style>${scoped}</style><div class="skf"><h2 style="margin:0 0 8px;font:800 34px/1 'Bricolage Grotesque',sans-serif;">Get Sidekick</h2><p>This form works without JavaScript, but the human check that protects it doesn't: sending it will ask you to turn JavaScript on.</p>${signupFormHtml()}</div></noscript>`);
  fs.writeFileSync(p, html);
}

// Proof that nothing from design review — or, in manual mode, nothing that needs a backend — reaches the deployment.
const all = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); e.isDirectory() ? walk(q) : all.push(q); } };
walk(OUT);
const text = all.filter(f => /\.(html|js|css|json|txt|xml)$/.test(f));
const banned = [['sk_mock_outcome', 'mock outcome switch'], ['DESIGN REVIEW', 'design review bar'], ['mock-api.js', 'mock API'], ['sessionStorage', 'sessionStorage'], ['local-dev-fake', 'local bot-check stand-in']];
if (!manual) banned.push(['SK_MAILTO', 'manual-mode email links'], ['{MANUAL', 'a manual region'], ['MANUAL}', 'a manual region']);
for (const f of text) {
  const t = fs.readFileSync(f, 'utf8');
  for (const [needle, what] of banned) {
    if (needle === 'local-dev-fake' && local) continue;
    if (needle === 'local-dev-fake' && f.endsWith('api-client.js')) continue; // the comparison string itself, inert without that key
    if (t.includes(needle)) fail(`${what} found in ${path.relative(OUT, f)}`);
  }
  if (manual) { const leaks = manualLeaks(t); if (leaks.length) fail(`manual build: ${leaks.join(', ')} found in ${path.relative(OUT, f)}`); }
}
if (fs.existsSync(path.join(OUT, 'data/mock-api.js'))) fail('mock-api.js was copied');
console.log(`build-site: ${all.length} files in dist/ (SITE_MODE=${mode}${local ? ', LOCAL — not deployable' : ''}); mocks off, review bar removed${manual ? ', no API, no Turnstile, no cookies' : ''}.`);
