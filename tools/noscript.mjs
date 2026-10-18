// Writes the no-JavaScript copies of the FAQ (Home.dc.html, one per SITE_MODE), the roadmap (Roadmap.dc.html) and
// the unlisted Beta page (Beta.dc.html), and the static manual-mode blocks (manual/Get Sidekick.dc.html,
// manual/Download.dc.html, the Roadmap suggestion box), from the same sources the pages render from: the FAQ array
// in Home.dc.html's script, the BETA function in Beta.dc.html's script, data/site-config.js, data/releases.json,
// data/roadmap-data.js and data/mailto.js. Run after editing any of them:
//   node tools/noscript.mjs          rewrite the generated blocks
//   node tools/noscript.mjs --check  exit 1 if a block is out of date (use before deploying)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripRegions } from '../scripts/site-modes.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(read('data/site-config.js'), sandbox);
vm.runInContext(read('data/roadmap-data.js'), sandbox);
vm.runInContext(read('data/mailto.js'), sandbox);
const C = sandbox.window.SK_CONFIG, RM = sandbox.window.SK_ROADMAP, M = sandbox.window.SK_MAILTO;

// FAQ: evaluate Home's own `const FAQ = [...]` with the same inputs it reads at runtime, once per site mode.
const home = read('Home.dc.html');
const m = home.match(/const FAQ = (\[[\s\S]*?\n {4}\]);/);
if (!m) throw new Error('FAQ array not found in Home.dc.html');
const faqFor = (manual) => vm.runInNewContext(`(${m[1]})`, { tokenReq: C.tokenRequired !== false, notarized: !!C.notarized, manual }).map(([q, a]) =>
  `<details style="border-top:1px solid rgba(23,20,46,0.14);padding:18px 0;"><summary style="cursor:pointer;font:600 19px/1.35 Inter,sans-serif;">${esc(q)}</summary><p style="margin:12px 0 6px;font-size:17px;line-height:1.6;color:#55526B;">${esc(a)}</p></details>`).join('\n');
const faqHtml = faqFor(false), faqManualHtml = faqFor(true);

const rmHtml = RM.phases.map(p => {
  const items = RM.items.filter(i => i.phase === p.id).map(i =>
    `<li style="margin:0 0 10px;"><strong>${esc(i.title)}</strong> <span style="color:#55526B;">(${esc(i.category)})</span> — ${esc(i.benefit)}${i.note ? ` <em style="color:#55526B;">${esc(i.note)}</em>` : ''}</li>`).join('\n');
  return `<section style="padding-top:20px;border-top:1px solid rgba(23,20,46,0.14);"><h2 style="margin:0 0 12px;font:800 28px/1.1 'Bricolage Grotesque',sans-serif;">${esc(p.label)}: ${esc(p.title)}</h2><ul style="margin:0;padding-left:22px;font-size:17px;line-height:1.55;">\n${items}\n</ul></section>`;
}).join('\n');

// Beta: call Beta's own `const BETA = (R, C) => {...}` with release facts and config, as the page does.
const beta = read('Beta.dc.html');
const bm = beta.match(/const BETA = (\(R, C\) => \{[\s\S]*?\n {4}\});/);
if (!bm) throw new Error('BETA function not found in Beta.dc.html');
const { _comment, ...R } = JSON.parse(read('data/releases.json'));
delete R.mac.directUrl; // server-only, as in data/releases.js
// One block per site mode: the manual one from the function with its AUTOMATED regions removed (as the manual build
// ships it), the automated one from the whole function with siteMode 'automated'.
const betaFor = (mode) => vm.runInNewContext(`(${stripRegions(bm[1], mode)})`, {})(R, { ...C, siteMode: mode });
const T = betaFor('manual'), TA = betaFor('automated');
const P = (t, extra = '') => `<p style="margin:0 0 14px;font-size:17px;line-height:1.6;${extra}">${t}</p>`;
const H2 = (t) => `<h2 style="margin:28px 0 12px;font:800 30px/1.1 'Bricolage Grotesque',sans-serif;">${esc(t)}</h2>`;
const H3 = (t) => `<h3 style="margin:20px 0 8px;font:600 20px/1.3 Inter,sans-serif;">${esc(t)}</h3>`;
const OL = (items) => `<ol style="margin:0 0 14px;padding-left:22px;font-size:17px;line-height:1.6;">\n${items.map(s => `<li>${esc(s.text)}${s.code ? ` <code>${esc(s.code)}</code>` : ''}</li>`).join('\n')}\n</ol>`;
const A = (href, label) => href ? P(`<a href="${esc(href)}" rel="noopener noreferrer" style="font-weight:600;">${esc(label)}</a>`) : '';
const betaBlock = (T, automated = false) => [
  `<h1 style="margin:0 0 16px;font:800 52px/1 'Bricolage Grotesque',sans-serif;">Install the beta.</h1>`, P(esc(T.intro)),
  H2(T.macTitle), P(esc(T.macNeed)), A(T.driveUrl, T.driveLabel), P(esc(T.driveText)),
  T.fallbackUrl ? P(`If the download doesn't start, <a href="${esc(T.fallbackUrl)}" rel="noopener noreferrer" style="font-weight:600;">open our Google Drive folder</a> and download ${esc(T.file)} there.`) : '',
  T.file ? P(`File: <code>${esc(T.file)}</code>${T.size ? ` · Size: ${esc(T.size)}` : ''}`) : '',
  T.sha ? P(`SHA-256: <code style="word-break:break-all;">${esc(T.sha)}</code>`) : '',
  T.checkTitle ? H3(T.checkTitle) : '', T.checkTitle ? OL(T.check) : '', H3(T.installTitle), OL(T.install), P(`<strong>${esc(T.tokenTitle)}</strong> ${esc(T.token)}`),
  H2(T.androidTitle), P(esc(T.androidNeed)), P(`<strong>${esc(T.playAccess)}</strong>`), A(T.playUrl, T.playLabel), P(esc(T.playText)), P(esc(T.noApk), 'font-weight:600;'),
  H2(T.pairTitle), P(automated ? esc(T.pair) : `${esc(T.pair)} <a href="Support.dc.html#setup" style="font-weight:600;">Full setup guide</a>`), P(esc(T.help))
].filter(Boolean).join('\n');
const betaHtml = betaBlock(T), betaAutoHtml = betaBlock(TA, true);

// Manual mode: static HTML (it reads the same without JavaScript) built from data/mailto.js.
const email = C.supportEmail;
const R0 = JSON.parse(read('data/releases.json'));
const mark = (pre, word, post) => `<h1 style="margin:0;font-family:'Bricolage Grotesque',sans-serif;font-size:clamp(44px,5.6vw,80px);line-height:0.96;font-weight:800;letter-spacing:-0.045em;">${pre}<span style="position:relative;display:inline-block;"><span style="position:absolute;left:-0.04em;right:-0.06em;bottom:0.06em;height:0.3em;background:#C6FF33;border-radius:0.08em;transform:rotate(-1.5deg);"></span><span style="position:relative;">${word}</span></span>${post}</h1>`;
const lead = (t) => `<p style="margin:0;font-size:19px;line-height:1.55;color:#55526B;">${t}</p>`;
const small = (t) => `<p style="margin:0;font-size:15.5px;line-height:1.55;color:#55526B;">${t}</p>`;
const button = (href, label) => `<a href="${esc(href)}" style="align-self:flex-start;min-height:56px;padding:0 30px;border-radius:999px;background:#C6FF33;border:1.5px solid #17142E;color:#17142E;font-size:17px;font-weight:600;display:inline-flex;align-items:center;text-decoration:none;box-sizing:border-box;">${esc(label)}</a>`;
const mailtoPlain = `<a href="mailto:${esc(email)}">${esc(email)}</a>`;
const card = (id, h, inner, bg = '#FFFFFF') => `<section aria-labelledby="${id}" style="border-radius:28px;background:${bg};border:1px solid rgba(23,20,46,0.10);padding:clamp(24px,3vw,40px);display:flex;flex-direction:column;gap:18px;">\n<h2 id="${id}" style="margin:0;font-family:'Bricolage Grotesque',sans-serif;font-size:32px;line-height:1.05;font-weight:800;letter-spacing:-0.03em;">${esc(h)}</h2>\n${inner}\n</section>`;
const fields = M.requestFields.map(f => `<li>${esc(f.replace(/:$/, ''))}</li>`).join('');
const requestCard = (id) => card(id, 'Ask for a place', [
  `<ol style="margin:0;padding-left:22px;font-size:17px;line-height:1.6;display:flex;flex-direction:column;gap:10px;">`,
  `<li><strong>Check your Mac.</strong> The beta runs only on Macs with Apple silicon (M1 or later): Apple menu › About This Mac shows “Chip”. If it shows “Processor”, it's an Intel Mac and the beta won't run on it. You also need an Android phone on Android 10 or later.</li>`,
  `<li><strong>Email us.</strong> The button opens your email app with a message to ${esc(email)} that asks for four things: your name, your Mac's chip, your phone model, and the Google account email you use on that phone. We add that Google account to Sidekick's Google Play test list, because only accounts on that list can install the Android app.</li>`,
  `<li><strong>Wait for our reply.</strong> We read each request ourselves; nothing is automatic. If there's a place, we email you a private link to the Mac app, the Google Play test link for your phone, and your beta token.</li>`,
  `</ol>`,
  button(M.request(), 'Email us to request access'),
  small(`If the button doesn't open an email app, write to ${mailtoPlain} with the subject “${esc(M.requestSubject)}” and:</p><ul style="margin:0;padding-left:22px;font-size:15.5px;line-height:1.55;color:#55526B;">${fields}</ul><p style="margin:0;font-size:15.5px;line-height:1.55;color:#55526B;">`),
  small(`By sending the email you agree to us using those details to run the beta, as described in <a href="Support.dc.html#privacy">Privacy</a>. This site doesn't store anything: your email goes from your email app to our inbox. Don't send passwords or your beta token.`)
].join('\n'));
const requestHtml = [
  mark('Request ', 'access', '.'),
  lead("Sidekick is in a small beta by invitation, for Macs with Apple silicon and Android phones. To ask for a place, email us. There's no form on this site."),
  requestCard('ra-h'),
  small('Already invited? Read the <a href="Support.dc.html#setup">setup guide</a>.')
].join('\n');
const inviteHtml = [
  mark('Download ', 'Sidekick', '.'),
  card('inv-h', 'Beta by invitation', [
    lead("This site doesn't serve the download. Once you're in the beta, we email you a private link to the Mac app, the Google Play test link for your phone, and your beta token."),
    `<dl style="margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px 20px;font-size:16px;line-height:1.5;">`,
    `<dt style="color:#55526B;">Version</dt><dd style="margin:0;font-family:'JetBrains Mono',monospace;">${esc(R0.version)}</dd>`,
    `<dt style="color:#55526B;">Mac</dt><dd style="margin:0;">Apple silicon only (M1 or later), ${esc(R0.mac.minOS)}. Intel Macs aren't supported.</dd>`,
    `<dt style="color:#55526B;">Android</dt><dd style="margin:0;">${esc(R0.android.minOS)}, from Google Play's testing programme (invited Google accounts only). There is no APK download.</dd>`,
    `</dl>`
  ].join('\n'), '#E8E2FF'),
  requestCard('ra-h'),
  small('Already invited and installed? Follow the <a href="Support.dc.html#setup">setup guide</a>.')
].join('\n');
const suggestHtml = [
  `<p style="margin:0;position:relative;font-size:17px;line-height:1.55;">Email us your idea. The button opens your email app with a short message to fill in.</p>`,
  button(M.suggest(), 'Email a suggestion'),
  `<p style="margin:0;position:relative;font-size:15px;line-height:1.5;color:#55526B;">Or write to ${mailtoPlain}. Your email goes to our inbox; this site stores nothing. See <a href="Support.dc.html#privacy">Privacy</a>.</p>`
].join('\n');

const blocks = [
  ['Home.dc.html', 'NOSCRIPT:FAQ', `<noscript>\n<div style="border-bottom:1px solid rgba(23,20,46,0.14);">\n${faqHtml}\n</div>\n</noscript>`],
  ['Home.dc.html', 'NOSCRIPT:FAQ-MANUAL', `<noscript>\n<div style="border-bottom:1px solid rgba(23,20,46,0.14);">\n${faqManualHtml}\n</div>\n</noscript>`],
  ['Roadmap.dc.html', 'NOSCRIPT:ROADMAP', `<noscript>\n<div style="display:flex;flex-direction:column;gap:28px;">\n${rmHtml}\n</div>\n</noscript>`],
  ['Beta.dc.html', 'NOSCRIPT:BETA', `<noscript>\n<div>\n${betaHtml}\n</div>\n</noscript>`],
  ['Beta.dc.html', 'NOSCRIPT:BETA-AUTOMATED', `<noscript>\n<div>\n${betaAutoHtml}\n</div>\n</noscript>`],
  ['Roadmap.dc.html', 'MANUAL:SUGGEST', suggestHtml],
  ['manual/Get Sidekick.dc.html', 'MANUAL:REQUEST', requestHtml],
  ['manual/Download.dc.html', 'MANUAL:INVITE', inviteHtml],
];

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, name, body] of blocks) {
  const src = read(file);
  const start = `<!-- ${name} generated by tools/noscript.mjs; do not edit by hand -->`, end = `<!-- /${name} -->`;
  const a = src.indexOf(start), b = src.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers for ${name} not found in ${file}`);
  const next = src.slice(0, a + start.length) + '\n' + body + '\n' + src.slice(b);
  if (next === src) continue;
  stale++;
  if (check) console.error(`${file}: ${name} block is out of date — run node tools/noscript.mjs`);
  else { fs.writeFileSync(path.join(ROOT, file), next); console.log(`${file}: ${name} block written`); }
}
if (check && stale) process.exit(1);
if (!stale) console.log('noscript blocks up to date');
