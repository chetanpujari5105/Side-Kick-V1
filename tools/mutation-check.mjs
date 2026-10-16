// Mutation checks for three safety rules: updates go only to people who opted in AND confirmed, no token or
// invitation before play-added, and an unsubscribe link works once. Each mutation breaks one rule in a scratch
// copy of the repo; the tests must then FAIL. Run: node tools/mutation-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TESTS = ['test/automated.test.mjs', 'test/repo-contract.test.mjs', 'test/flow.test.mjs'];
const MUTANTS = [
  ['opt-in only (MemoryRepo): asked is enough', 'server/repo-memory.mjs', 's.marketingRequestedAt && s.marketingConfirmedAt', 's.marketingRequestedAt'],
  ['opt-in only (PgRepo): asked is enough', 'server/repo-pg.mjs', 'marketing_requested_at is not null and marketing_confirmed_at is not null order by created_at', 'marketing_requested_at is not null order by created_at'],
  ['opt-in only (API): announce to every sign-up', 'server/app.mjs', 'const people = await repo.announceRecipients();', 'const people = (await repo.exportSignups()).map(s => ({ id: s.id, emailNorm: s.email.toLowerCase(), name: s.name }));'],
  ['play gate (API): signer sees approved people', 'server/app.mjs', 'repo.claimPending(now(), 10, CLAIM_TTL, { gate: config.playGate })', 'repo.claimPending(now(), 10, CLAIM_TTL, { gate: false })'],
  ['play gate (API): token accepted before play-added', 'server/app.mjs', 'repo.storeToken(data.signupId, data.token, now(), { gate: config.playGate })', 'repo.storeToken(data.signupId, data.token, now(), { gate: false })'],
  ['play gate (PgRepo): token stored from approved', 'server/repo-pg.mjs', "[id, token, d(now), gate ? 'play_added' : 'approved']", "[id, token, d(now), 'approved']"],
  ['play gate (config): default off', 'server/config.mjs', "const playGate = env.PLAY_GATE === undefined || env.PLAY_GATE === '' || env.PLAY_GATE === 'on';", "const playGate = env.PLAY_GATE === 'on';"],
  ['unsubscribe one use: ten uses', 'server/app.mjs', 'unsubscribe: { ttl: 365 * 24 * H, uses: 1 }', 'unsubscribe: { ttl: 365 * 24 * H, uses: 10 }'],
  ['unsubscribe: any link purpose accepted', 'server/app.mjs', "if (!peek || peek.purpose !== 'unsubscribe') return gone();", 'if (!peek) return gone();'],
  ['unsubscribe token opens a session elsewhere', 'server/app.mjs', "if (!peek || peek.purpose === 'unsubscribe' || ", 'if (!peek || ']
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
