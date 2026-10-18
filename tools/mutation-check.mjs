// Mutation checks for four safety rules: updates go only to people who opted in AND confirmed, no token or
// invitation before play-added, an unsubscribe link works once, and the updates choice is the one in the
// submission being handled (an unticked box never leaves a request or an updates link), and the one-click rules of
// launch log Part 7 (a repeat sign-up never sees a token, pool tokens give 35+ days, the daily cap and the kill switch
// hold, the Drive fallback never auto-starts, a Google account is marked only after Google accepted it, deleting a
// sign-up deletes its token record, no token in the logs), and the direct download of Part 8 (the automatic start never
// navigates the tab that shows the token, the page CSP lets its hidden frame through, the Android note once, Drive only
// as the fallback in emails). Each mutation breaks one rule in a scratch
// copy of the repo; the tests must then FAIL. Run: node tools/mutation-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TESTS = ['test/automated.test.mjs', 'test/repo-contract.test.mjs', 'test/flow.test.mjs', 'test/consent.test.mjs', 'test/oneclick.test.mjs', 'test/pool-signer.test.mjs', 'test/direct-download.test.mjs'];
const MUTANTS = [
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
  ['direct download (emails): Drive offered as the way to download', 'server/emails.mjs', 'If the download fails, download ${b.file} from our Google Drive folder instead:', 'Download ${b.file} from our Google Drive folder:']
];

const skip = new Set(['.git', 'node_modules', 'dist']);
let killed = 0;
for (const [name, file, from, to] of MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-mutant-'));
  try {
    for (const e of fs.readdirSync(ROOT)) if (!skip.has(e)) fs.cpSync(path.join(ROOT, e), path.join(dir, e), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const f = path.join(dir, file), src = fs.readFileSync(f, 'utf8');
    if (src.split(from).length !== 2) { console.log(`ERROR  ${name}: pattern not found exactly once in ${file}`); process.exitCode = 1; continue; }
    fs.writeFileSync(f, src.replace(from, to));
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...TESTS], { cwd: dir, encoding: 'utf8' });
    const fails = (r.stdout.match(/^ℹ fail (\d+)/m) || [])[1];
    if (r.status !== 0) { killed++; console.log(`KILLED ${name} (${fails} failing tests)`); }
    else { console.log(`SURVIVED ${name}: the tests did not notice`); process.exitCode = 1; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${killed}/${MUTANTS.length} mutants killed`);
