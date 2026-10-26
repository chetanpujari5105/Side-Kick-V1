// Mutation checks for four safety rules: updates go only to people who opted in AND confirmed, no token or
// invitation before play-added, an unsubscribe link works once, and the updates choice is the one in the
// submission being handled (an unticked box never leaves a request or an updates link), and the one-click rules of
// launch log Part 7 (a repeat sign-up never sees a token, pool tokens give 35+ days, the daily cap and the kill switch
// hold, the Drive fallback never auto-starts, a Google account is marked only after Google accepted it, deleting a
// sign-up deletes its token record, no token in the logs), and the direct download of Part 8 (the automatic start never
// navigates the tab that shows the token, the page CSP lets its hidden frame through, the Android note once, Drive only
// as the fallback in emails), the short links of Part 10 (/get and /beta exist in automated mode only), and the emails of
// Part 11 (no Drive in an email, capitalised first names, the token card wraps, the Mail.app fallback never re-sends a
// handed-over email, the password file must be private, the preview token and --send-test stay with the owner, SMTP
// dot-stuffing, the email logo is automated-only), and the privacy facts of Part 14 (no per-person download row, roadmap
// notify closed, delete names the Google account, private files go back to 600) and one privacy page (Part 15), and the site audit of Part 16 (publisher facts filled, the 404 fallback works under
// the CSP, compact human check in narrow boxes, Android wording, a favicon on server pages), and the domain of Part 19
// (robots.txt/sitemap.xml automated-only and public pages only, absolute canonical and share image from APP_ORIGIN,
// emails follow SK_API_BASE), and the Play test link of Part 21 (the internal link or THIS app's closed-test page only).
// Each mutation breaks one rule in a scratch
// copy of the repo; the tests must then FAIL. Run: node tools/mutation-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TESTS = ['test/automated.test.mjs', 'test/repo-contract.test.mjs', 'test/flow.test.mjs', 'test/consent.test.mjs', 'test/oneclick.test.mjs', 'test/pool-signer.test.mjs', 'test/direct-download.test.mjs', 'test/short-link.test.mjs', 'test/email-html.test.mjs', 'test/signer-mail.test.mjs', 'test/short-content-pages.test.mjs', 'test/privacy-facts.test.mjs', 'test/one-privacy-page.test.mjs', 'test/site-audit.test.mjs'];
const MUTANTS = [
  ['domain (Part 19): the sitemap lists the Download page', 'scripts/seo.mjs', '  [\'/Support.dc.html\', \'Support.dc.html\']\n];', '  [\'/Support.dc.html\', \'Support.dc.html\'],\n  [\'/Download.dc.html\', \'Download.dc.html\']\n];', ['test/domain.test.mjs']],
  ['domain (Part 19): robots.txt closes the whole site', 'scripts/seo.mjs', 'Allow: /\nDisallow: /download/\n', 'Disallow: /\n', ['test/domain.test.mjs']],
  ['domain (Part 19): crawlers may fetch the download (counts a download)', 'scripts/seo.mjs', 'Disallow: /download/\n', '', ['test/domain.test.mjs']],
  ['domain (Part 19): robots.txt and sitemap.xml in the manual build', 'scripts/build-site.mjs', 'if (!manual) {\n  fs.writeFileSync(path.join(OUT, \'robots.txt\')', 'if (true) {\n  fs.writeFileSync(path.join(OUT, \'robots.txt\')', ['test/domain.test.mjs']],
  ['domain (Part 19): the canonical link is relative', 'scripts/seo.mjs', '`<link rel="canonical" href="${origin}${urlPath}">`', '`<link rel="canonical" href="${urlPath}">`', ['test/domain.test.mjs']],
  ['domain (Part 19): the share image stays relative', 'scripts/seo.mjs', '.replace(OG, `<meta property="og:image" content="${image}">`)', '.replace(OG, OG)', ['test/domain.test.mjs']],
  ['domain (Part 19): the build ignores APP_ORIGIN', 'scripts/seo.mjs', '  return v;\n}', '  return DEFAULT_ORIGIN;\n}', ['test/domain.test.mjs']],
  ['domain (Part 19): a Production build without APP_ORIGIN uses the default silently', 'scripts/seo.mjs', '    if (env.VERCEL_ENV === \'production\') throw new Error(', '    if (false) throw new Error(', ['test/domain.test.mjs']],
  ['domain (Part 19): emails ignore the signer\'s SK_API_BASE', 'tools/signer/signer.mjs', 'const siteOf = (cfg) => /^https:\\/\\/[A-Za-z0-9.-]+$/.test(cfg.base || \'\') ? cfg.base : SITE;', 'const siteOf = (cfg) => SITE;', ['test/domain.test.mjs']],
  ['site audit (Part 16): the effective date is a placeholder again', 'data/site-config.js', "policyEffectiveDate: '19 October 2026'", "policyEffectiveDate: '[set on go-live day]'"],
  ['site audit (Part 16): the 404 fallback uses an inline script the CSP blocks', '404.html', '<meta http-equiv="refresh" content="0; url=/404.dc.html">', "<script>location.replace('/404.dc.html');</script>"],
  ['site audit (Part 16): the human check keeps its 300 px size in a narrow box', 'data/api-client.js', "...(narrow ? { size: 'compact' } : {})", '...({})'],
  ['site audit (Part 16): Support says Android is not available', 'Support.dc.html', "/*AUTOMATED{*/(!invite && 'Android: by invitation through Google Play testing.", "/*AUTOMATED{*/(false && 'Android: by invitation through Google Play testing."],
  ['site audit (Part 16): server pages without a favicon', 'server/pages.mjs', '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">', ''],
  ['one privacy page (Part 15): the footer links the external page again', 'SiteFooter.dc.html', "(/*AUTOMATED{*/ L('Privacy','Support.dc.html#privacy') ?? /*}AUTOMATED*/ null)", "(/*AUTOMATED{*/ L('Privacy','https://chetan-website-delta.vercel.app/sidekick/privacy') ?? /*}AUTOMATED*/ null)"],
  ['privacy (Part 14): the session download logs the person', 'server/app.mjs', 'location = isMac ? (await storage.signedUrl(', "await repo.logDownload({ signupId: s.id, platform, arch: 'arm64' }, now()); location = isMac ? (await storage.signedUrl("],
  ['privacy (Part 14): roadmap notify reopened', 'server/app.mjs', "return json(410, { ok: false, error: 'NOTIFY_UNAVAILABLE' });", 'return json(202, { ok: true });'],
  ['privacy (Part 14): delete hides the Google account', 'server/app.mjs', 'googleEmail: s ? s.googleEmail || null : null', 'googleEmail: null'],
  ['privacy (Part 14): the signer leaves its files readable', 'tools/signer/signer.mjs', 'if (st.isFile() && (st.mode & 0o077))', 'if (false)'],
  ['privacy (Part 14): the signer chmods through a symlink', 'tools/signer/signer.mjs', 'const st = fs.lstatSync(f);', 'const st = fs.statSync(f);'],
  ['privacy (Part 14): new signer files readable by others', 'tools/signer/signer.mjs', 'process.umask(0o077)', 'process.umask(0o022)'],
  ['privacy (Part 14): the Cloudflare sentence drops the IP', 'Support.dc.html', ', and our server passes Cloudflare your IP address when it verifies the check', ''],
  ['privacy (Part 14): the roadmap intro still promises an email', 'Roadmap.dc.html', "/*AUTOMATED{*/, intro: 'Open any item to read what it\\'s for.'/*}AUTOMATED*/", ''],
  ['opt-in only (MemoryRepo): asked is enough', 'server/repo-memory.mjs', 's.marketingRequestedAt && s.marketingConfirmedAt', 's.marketingRequestedAt'],
  ['opt-in only (PgRepo): asked is enough', 'server/repo-pg.mjs', 'marketing_requested_at is not null and marketing_confirmed_at is not null order by created_at', 'marketing_requested_at is not null order by created_at'],
  ['opt-in only (API): announce to every sign-up', 'server/app.mjs', 'const people = await repo.announceRecipients();', 'const people = (await repo.exportSignups()).map(s => ({ id: s.id, emailNorm: s.email.toLowerCase(), name: s.name }));'],
  ['play gate (API): signer sees approved people', 'server/app.mjs', 'repo.claimPending(now(), 10, CLAIM_TTL, { gate: config.playGate })', 'repo.claimPending(now(), 10, CLAIM_TTL, { gate: false })'],
  ['play gate (API): token accepted before play-added', 'server/app.mjs', 'repo.storeToken(data.signupId, data.token, now(), { gate: config.playGate })', 'repo.storeToken(data.signupId, data.token, now(), { gate: false })'],
  ['play gate (PgRepo): token stored from approved', 'server/repo-pg.mjs', "and ${gate ? READY_GATED : `state = 'approved'`} and token is null returning id", "and state = 'approved' and token is null returning id"],
  ['play gate (config): default off', 'server/config.mjs', "const playGate = env.PLAY_GATE === undefined || env.PLAY_GATE === '' || env.PLAY_GATE === 'on';", "const playGate = env.PLAY_GATE === 'on';"],
  ['unsubscribe one use: ten uses', 'server/app.mjs', 'unsubscribe: { ttl: 365 * 24 * H, uses: 1 }', 'unsubscribe: { ttl: 365 * 24 * H, uses: 10 }'],
  ['unsubscribe: any link purpose accepted', 'server/app.mjs', "if (!peek || peek.purpose !== 'unsubscribe') return gone();", 'if (!peek) return gone();'],
  ['this submission (API): the box is ignored', 'server/app.mjs', "const wantsUpdates = v.value.marketingOptIn === true && s.state === 'pending_email';", "const wantsUpdates = s.state === 'pending_email';"],
  ['this submission (API): a second submission keeps the first choice', 'server/app.mjs', 'if (!result.created && (wantsUpdates || v.value.marketingOptIn !== true)) s = ', 'if (false) s = '],
  ['this submission (MemoryRepo): unticked keeps the request', 'server/repo-memory.mjs', "s.marketingRequestedAt = wanted === true ? (s.marketingRequestedAt || new Date(now)) : null;", "s.marketingRequestedAt = wanted === true ? (s.marketingRequestedAt || new Date(now)) : s.marketingRequestedAt;"],
  ['this submission (PgRepo): unticked keeps the request', 'server/repo-pg.mjs', 'coalesce(marketing_requested_at, $3) else null end', 'coalesce(marketing_requested_at, $3) else marketing_requested_at end'],
  ['this submission (validate): updates default to yes', 'server/validate.mjs', 'marketingOptIn: truthy(body.marketingOptIn)', 'marketingOptIn: body.marketingOptIn !== false'],
  ['unsubscribe token opens a session elsewhere', 'server/app.mjs', "if (!peek || peek.purpose === 'unsubscribe' || ", 'if (!peek || '],
  ['one-click (API): a repeat sign-up is shown the token', 'server/app.mjs', "if (outcome === 'already') return asPage ? html(200, alreadyPage({ nonce }), nonce) : json(200, { ok: true, stage: 'already' });", "if (outcome === 'already') return json(200, { ok: true, stage: 'already', token: await repo.poolTokenFor(s.id) });"],
  ['one-click (MemoryRepo): no 35-day minimum', 'server/repo-memory.mjs', 'p.createdAt.getTime() >= now - maxAgeMs && p.notAfter.getTime() >= now + minLeftMs', 'p.createdAt.getTime() >= now - maxAgeMs'],
  ['one-click (PgRepo): no 35-day minimum', 'server/repo-pg.mjs', 'and p.created_at >= $3 and p.not_after >= $4', 'and p.created_at >= $3 and $4::timestamptz is not null'],
  ['one-click (MemoryRepo): no daily cap in the hand-out', 'server/repo-memory.mjs', 'if (this.pool.filter(p => p.issuedAt && p.issuedAt.getTime() >= o.dayStart).length >= o.dailyCap) return null;', ''],
  ['one-click (PgRepo): no daily cap in the hand-out', 'server/repo-pg.mjs', 'and (select count(*) from token_pool where issued_at >= $5) < $6', 'and $5::timestamptz is not null and $6::int > -1'],
  ['one-click (API): the kill switch ignored', 'server/app.mjs', 'if (config.signupClosed) {', 'if (false) {'],
  ['one-click (API): the Drive fallback starts by itself', 'server/app.mjs', 'auto: !!releases.mac.directUrl', 'auto: true'],
  ['one-click (signer): a refused Google account is marked anyway', 'tools/signer/android-group.mjs', 'if (r.status === 200 || r.status === 409) {', 'if (true) {'],
  ['one-click (MemoryRepo): deleting keeps the token record', 'server/repo-memory.mjs', 'this.pool = this.pool.filter(p => p.signupId !== id);', ''],
  ['one-click (API): pool-add takes tokens whose end date cannot be read', 'server/app.mjs', 'if (items.some(x => x.notAfter === null))', 'if (false)'],
  ['direct download (page): the automatic start navigates the tab', 'Get Sidekick.dc.html', 'setTimeout(() => Component.AUTO_DOWNLOAD(r.download.url, document), 1500);', 'setTimeout(() => { window.location.href = r.download.url; }, 1500);'],
  ['direct download (no-JS page): the link replaces the page with the token', 'server/pages.mjs', 'href="${download.url}" target="_blank" rel="noopener"', 'href="${download.url}"'],
  ['direct download (page CSP): the hidden frame is blocked', 'vercel.json', "frame-src 'self' https://github.com https://release-assets.githubusercontent.com https://objects.githubusercontent.com ", 'frame-src '],
  ['direct download (page): the Android note twice on the form', 'Get Sidekick.dc.html', "this form isn\\'t open yet.' : '',", "this form isn\\'t open yet.' : 'Android: join the Google Play test, we\\'ll email you the link.',"],
  ['direct download (releases): an asset of any version accepted', 'server/releases.mjs', '(?:v|sidekick-mac-)${ver}/', '(?:v|sidekick-mac-)\\\\d+\\\\.\\\\d+\\\\.\\\\d+/'],
  ['emails (Part 11): the copy names the Drive folder again', 'server/emails.mjs', "`${button('Download for Mac', downloadUrl)}\\n\\n${tok}", "`${button('Download for Mac', downloadUrl)}\\n\\nIf the download fails, use our Google Drive folder:\\n${release.mac.betaDriveUrl}\\n\\n${tok}"],
  ['emails (Part 11): first names not capitalised', 'server/emails.mjs', "s.charAt(0).toLocaleUpperCase('en') + s.slice(1)", 's'],
  ['emails (Part 11): the token card does not wrap', 'server/email-html.mjs', 'word-break:break-all;overflow-wrap:anywhere;', 'white-space:nowrap;'],
  ['sender (Part 11): a handed-over SMTP email is re-sent through Mail.app', 'tools/signer/signer.mjs', 'if (e.committed) throw new Error(', 'if (false) throw new Error('],
  ['sender (Part 11): a password file others can read is used', 'tools/signer/signer.mjs', 'if (st.mode & 0o077)', 'if (false)'],
  ['sender (Part 11): the preview token reaches a real email', 'tools/signer/signer.mjs', 'if (String(m.text).includes(DUMMY_TOKEN) || String(m.subject).includes(DUMMY_TOKEN))', 'if (false)'],
  ['sender (Part 11): --send-test to anyone', 'tools/signer/signer.mjs', 'to.some(a => !OWNER_ADDRESSES.includes(a))', 'false'],
  ['sender (Part 11): SMTP without dot-stuffing', 'tools/signer/smtp.mjs', ".replace(/^\\./gm, '..')", ''],
  ['build (Part 11): the email logo in the manual build', 'scripts/build-site.mjs', "if (!manual) copy('email');", "copy('email');", ['test/build.test.mjs']],
  ['short link (API): /get open with the kill switch on', 'server/app.mjs', "if (config.signupClosed) return json(404, { ok: false, error: 'NOT_FOUND' });", ''],
  ['short link (vercel.json): a static rewrite serves the form in both modes', 'vercel.json', '{ "source": "/get", "destination": "/api/index?__route=get" }', '{ "source": "/get", "destination": "/Get Sidekick.dc.html" }'],
  ['Play link (Part 21): any app\'s closed-test page passes', 'server/releases.mjs', 'testing\\/com\\.chetan\\.connectsuite)$/', 'testing\\/[A-Za-z0-9._]+)$/', ['test/security.test.mjs']],
  ['Play link (Part 21): the closed-test page is refused', 'server/releases.mjs', '|testing\\/com\\.chetan\\.connectsuite)$/', ')$/', ['test/security.test.mjs']]
];

const skip = new Set(['.git', 'node_modules', 'dist']);
let killed = 0;
// A mutant may name its own tests (the slow build tests run only for the build mutant).
for (const [name, file, from, to, tests = TESTS] of MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-mutant-'));
  try {
    for (const e of fs.readdirSync(ROOT)) if (!skip.has(e)) fs.cpSync(path.join(ROOT, e), path.join(dir, e), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8');
    if (src.split(from).length !== 2) { console.log(`ERROR  ${name}: pattern not found exactly once in ${file}`); process.exitCode = 1; continue; }
    fs.writeFileSync(f, src.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: dir, encoding: 'utf8' });
    const fails = (r.stdout.match(/^ℹ fail (\d+)/m) || [])[1];
    if (r.status !== 0) { killed++; console.log(`KILLED ${name} (${fails} failing tests)`); }
    else { console.log(`SURVIVED ${name}: the tests did not notice`); process.exitCode = 1; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${killed}/${MUTANTS.length} mutants killed`);
