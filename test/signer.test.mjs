// Signer round trip with a throwaway Ed25519 key generated for this test run (never the owner's key).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, ORIGIN } from './helpers.mjs';
import { runCycle, makeMailer, loadSignerConfig } from '../tools/signer/signer.mjs';
import { makeClient } from '../tools/lib/client.mjs';

const ISSUER = new URL('./fixtures/fake-issuer.mjs', import.meta.url).pathname;
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function world() {
  const h = setup();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-signer-test-'));
  dirs.push(dir);
  const keyFile = path.join(dir, 'throwaway.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const cfg = { ...loadSignerConfig({}), issuer: ISSUER, keySource: 'file', keyFile, tokensDir: path.join(dir, 'tokens'), days: '45', emlDir: path.join(dir, 'eml') };
  const post = makeClient({ base: ORIGIN, keyId: 'signer', secret: h.env.ADMIN_AUTH_SIGNER_SECRET, fetch: (u, o) => h.app.fetch(new Request(u, o)), now: () => h.clock.now() });
  const sent = [];
  const mail = async (m) => { sent.push(m); };
  const verify = (token) => {
    const [, payload, sig] = token.split('.');
    return crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(sig, 'base64url'));
  };
  return { h, cfg, post, sent, mail, verify, dir, privateKey };
}

test('signer round trip: approved person → issuer signs → token stored → token emailed → delivered', async () => {
  const w = world();
  await w.h.signup();
  await w.h.confirm();
  const lines = [];
  const r = await runCycle({ cfg: w.cfg, post: w.post, mail: w.mail, log: (l) => lines.push(l) });
  assert.deepEqual(r, { issued: 1, reused: 0, posted: 1, failed: 0, mailed: 3, mailFailed: 0, deferred: false }, 'confirm email + invitation + token email');
  const tokenMail = w.sent.find(m => m.kind === 'token');
  const token = tokenMail.text.match(/SIDEKICK-TRIAL-1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}/)[0];
  assert.ok(w.verify(token), 'the emailed token verifies with the throwaway public key');
  assert.equal(tokenMail.to, 'alex@example.com');
  const s = await w.h.repo.getSignupByEmail('alex@example.com');
  assert.equal(s.state, 'delivered');
  assert.equal(s.token, token);
  const file = path.join(w.cfg.tokensDir, `${s.id}.sidekick-token`);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).label, 'Alex Rivera');
  // A second cycle has nothing to do.
  assert.deepEqual(await runCycle({ cfg: w.cfg, post: w.post, mail: w.mail }), { issued: 0, reused: 0, posted: 0, failed: 0, mailed: 0, mailFailed: 0, deferred: false });
  for (const l of lines) assert.ok(!l.includes('SIDEKICK-TRIAL') && !l.includes('@'), l);
});

test('signer: a crash after issuing reuses the saved token instead of issuing a second one', async () => {
  const w = world();
  await w.h.signup();
  await w.h.confirm();
  let issues = 0;
  const flaky = async (o) => { issues++; await new Promise((res, rej) => import('node:child_process').then(({ execFile }) => execFile(process.execPath, [ISSUER, '--key', w.cfg.keyFile, '--label', o.label, '--days', '45', '--out', o.outFile], e => e ? rej(e) : res()))); throw new Error('network dropped after issuing'); };
  const r1 = await runCycle({ cfg: w.cfg, post: w.post, issue: flaky, mail: null, log: () => {} });
  assert.equal(r1.failed, 1);
  w.h.clock.advance(16 * 60 * 1000); // the claim expires
  const r2 = await runCycle({ cfg: w.cfg, post: w.post, mail: null, log: () => {} });
  assert.equal(r2.reused, 1); assert.equal(r2.issued, 0); assert.equal(issues, 1);
  assert.equal((await w.h.repo.getSignupByEmail('alex@example.com')).state, 'issued');
});

test('signer keychain mode: the PEM reaches the issuer on fd 3, never on disk', async () => {
  const w = world();
  fs.rmSync(w.cfg.keyFile);
  await w.h.signup();
  await w.h.confirm();
  const cfg = { ...w.cfg, keySource: 'keychain' };
  const pem = w.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const r = await runCycle({ cfg, post: w.post, mail: w.mail, pem });
  assert.equal(r.issued, 1);
  const tok = w.sent.find(m => m.kind === 'token').text.match(/SIDEKICK-TRIAL-1\.\S+/)[0];
  assert.ok(w.verify(tok));
  const files = fs.readdirSync(w.dir, { recursive: true }).map(String);
  assert.ok(!files.some(f => f.endsWith('.pem')), 'no key file anywhere in the work folder');
});

test('signer: a wrong signer secret is refused by the API', async () => {
  const w = world();
  const bad = makeClient({ base: ORIGIN, keyId: 'signer', secret: crypto.randomBytes(32).toString('hex'), fetch: (u, o) => w.h.app.fetch(new Request(u, o)), now: () => w.h.clock.now() });
  await assert.rejects(runCycle({ cfg: w.cfg, post: bad, mail: w.mail }), /HTTP 401/);
});

test('signer: an email that fails to send is retried on the next cycle', async () => {
  const w = world();
  await w.h.signup();
  let fail = true;
  const r1 = await runCycle({ cfg: w.cfg, post: w.post, mail: async (m) => { if (fail) throw new Error('offline'); w.sent.push(m); }, log: () => {} });
  assert.equal(r1.mailFailed, 1);
  fail = false;
  w.h.clock.advance(1000);
  const r2 = await runCycle({ cfg: w.cfg, post: w.post, mail: async (m) => { w.sent.push(m); } });
  assert.equal(r2.mailed, 1);
  assert.equal(w.sent[0].kind, 'confirm');
});

test('mailers: Mail.app gets values as argv only; .eml files are written 600 with plain headers', async () => {
  const w = world();
  const calls = [];
  const m = makeMailer({ ...w.cfg, mailer: 'mailapp' }, { exec: (cmd, args, opts, cb) => { calls.push([cmd, args]); cb(null); } });
  await m({ to: 'a@example.com', subject: 'Your Sidekick beta token', text: 'line1\n" & do shell script "rm -rf ~" & "' });
  assert.equal(calls[0][0], '/usr/bin/osascript');
  assert.match(calls[0][1][0], /send-mail\.applescript$/);
  assert.deepEqual(calls[0][1].slice(1), ['a@example.com', 'Your Sidekick beta token', 'line1\n" & do shell script "rm -rf ~" & "']);
  const script = fs.readFileSync(calls[0][1][0], 'utf8');
  assert.match(script, /item 1 of argv/);
  const e = makeMailer({ ...w.cfg, mailer: 'eml' });
  await e({ id: '11111111-1111-4111-8111-111111111111', to: 'a@example.com', subject: 'S', text: 'hello\nworld' });
  const f = path.join(w.cfg.emlDir, '11111111-1111-4111-8111-111111111111.eml');
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
  assert.match(fs.readFileSync(f, 'utf8'), /^To: a@example.com\r\nSubject: S\r\n/);
  assert.equal(makeMailer({ ...w.cfg, mailer: 'none' }), null);
});

test('signer refuses to talk to anything but https (or localhost)', () => {
  assert.throws(() => makeClient({ base: 'http://example.com', keyId: 'signer', secret: 'x' }));
  assert.throws(() => makeClient({ base: 'https://example.com/evil?x=', keyId: 'signer', secret: 'x' }));
  assert.ok(makeClient({ base: 'http://localhost:8787', keyId: 'signer', secret: 'x' }));
});

test('token proof (OWNER-SETUP step 1) runs one real signer cycle in memory and names the token file', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-signer-test-'));
  try {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(path.join(dir, 'k.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const env = { PATH: process.env.PATH, HOME: dir, SK_ISSUER: path.join(root, 'test/fixtures/fake-issuer.mjs'), SK_KEY_FILE: path.join(dir, 'k.pem'), SK_TOKENS_DIR: path.join(dir, 'tokens') };
    const r = spawnSync(process.execPath, ['scripts/token-proof.mjs', '--label', 'Proof'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const files = fs.readdirSync(path.join(dir, 'tokens'));
    assert.equal(files.length, 1);
    assert.ok(r.stdout.includes(files[0]), 'prints the token file path');
    assert.ok(!/SIDEKICK-TRIAL-1\.\S{20}/.test(r.stdout + r.stderr), 'the token itself is not printed');
    const bad = spawnSync(process.execPath, ['scripts/token-proof.mjs'], { cwd: root, env: { ...env, SK_ISSUER: path.join(dir, 'missing.mjs') }, encoding: 'utf8' });
    assert.equal(bad.status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Reliability and diagnostics (Part 3) ─────────────────────────────────────────────────────────────
const netError = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) });

test('client: a network error is reported with its cause code, the host and the time taken — never the path', async () => {
  const post = makeClient({ base: 'https://side.example.test', keyId: 'signer', secret: 's'.repeat(32), fetch: async () => { throw netError('ENOTFOUND'); } });
  const e = await post('pending').then(() => null, (x) => x);
  assert.ok(e, 'it throws');
  assert.match(e.message, /^fetch failed \(ENOTFOUND\) host=side\.example\.test \d+ ms, 1 attempt$/);
  assert.ok(!/\/api|admin|pending/.test(e.message), 'no path or action');
  assert.equal(e.code, 'ENOTFOUND');
});

test('client: a request that hangs times out, with code TIMEOUT', async () => {
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason)));
  const post = makeClient({ base: 'https://side.example.test', keyId: 'signer', secret: 's'.repeat(32), fetch: hang, timeoutMs: 30 });
  const e = await post('pending').then(() => null, (x) => x);
  assert.equal(e && e.code, 'TIMEOUT');
});

test('signer client: one retry after a short delay on a network error, freshly signed; never on an HTTP status', async () => {
  const { signerClient } = await import('../tools/signer/signer.mjs');
  const seen = [], waits = [];
  let n = 0;
  const flaky = async (u, o) => { seen.push(o.headers['x-sk-nonce']); if (n++ === 0) throw netError('ECONNRESET'); return new Response('{"ok":true,"pending":[]}', { status: 200 }); };
  const post = signerClient({ base: 'https://side.example.test', secret: 's'.repeat(32) }, { fetch: flaky, sleep: async (ms) => { waits.push(ms); } });
  const r = await post('pending');
  assert.equal(r.status, 200);
  assert.equal(seen.length, 2, 'two attempts');
  assert.notEqual(seen[0], seen[1], 'the retry is signed again (new nonce), so replay protection accepts it');
  assert.deepEqual(waits, [2000], 'one short delay');
  let calls = 0;
  const down = signerClient({ base: 'https://side.example.test', secret: 's'.repeat(32) }, { fetch: async () => { calls++; throw netError('ETIMEDOUT'); }, sleep: async () => {} });
  const e = await down('pending').then(() => null, (x) => x);
  assert.match(e.message, /\(ETIMEDOUT\) host=side\.example\.test \d+ ms, 2 attempts$/);
  assert.equal(calls, 2, 'exactly one retry');
  let c500 = 0;
  const err500 = signerClient({ base: 'https://side.example.test', secret: 's'.repeat(32) }, { fetch: async () => { c500++; return new Response('{}', { status: 500 }); }, sleep: async () => {} });
  assert.equal((await err500('pending')).status, 500);
  assert.equal(c500, 1, 'no retry on an HTTP answer');
  let cAdmin = 0;
  const admin = makeClient({ base: 'https://side.example.test', keyId: 'admin', secret: 's'.repeat(32), fetch: async () => { cAdmin++; throw netError('ECONNRESET'); } });
  await admin('announce').catch(() => {});
  assert.equal(cAdmin, 1, 'the admin CLI never retries (an announcement must not be queued twice)');
});

test('signer log: last successful run, consecutive failures, and one ATTENTION line at the 6th failure in a row', async () => {
  const { parseSignerLog, failureLines } = await import('../tools/signer/signer.mjs');
  const ok = (t) => `${t} signer: {"issued":0,"reused":0,"posted":0,"failed":0,"mailed":0,"mailFailed":0,"deferred":false}`;
  const bad = (t) => `${t} signer failed: fetch failed`;
  const text = [ok('2026-10-16T11:00:00.000Z'), bad('2026-10-16T11:05:00.000Z'), ok('2026-10-16T11:10:00.000Z'), bad('2026-10-16T11:15:00.000Z'), bad('2026-10-16T11:20:00.000Z'), ''].join('\n');
  assert.deepEqual(parseSignerLog(text), { lastOk: '2026-10-16T11:10:00.000Z', lastRun: '2026-10-16T11:20:00.000Z', lastRunOk: false, consecutiveFailed: 2, runs: 5 });
  assert.deepEqual(parseSignerLog(''), { lastOk: null, lastRun: null, lastRunOk: null, consecutiveFailed: 0, runs: 0 });
  const e = Object.assign(new Error('fetch failed (ETIMEDOUT) host=side.example.test 20001 ms, 2 attempts'), { code: 'ETIMEDOUT' });
  const t = '2026-10-16T12:00:00.000Z';
  assert.deepEqual(failureLines(e, { previousFailed: 4, runMs: 22000, iso: t }), [`${t} signer failed: fetch failed (ETIMEDOUT) host=side.example.test 20001 ms, 2 attempts (run 22000 ms)`]);
  const at6 = failureLines(e, { previousFailed: 5, runMs: 22000, iso: t });
  assert.equal(at6.length, 2);
  assert.equal(at6[1], `${t} ATTENTION: 6 signer runs in a row have failed (last: ETIMEDOUT). Nothing can be sent until a run succeeds. Check that this Mac is awake and online; see docs/OWNER-SETUP.md (Signer status).`);
  assert.equal(failureLines(e, { previousFailed: 6, runMs: 1, iso: t }).length, 1, 'only once per streak');
  const withAttention = text + [bad(t), `${t} ATTENTION: 6 signer runs in a row have failed`, ''].join('\n');
  assert.equal(parseSignerLog(withAttention).consecutiveFailed, 3, 'ATTENTION lines are not runs');
});

test('signer --status: plain lines, counts only, no secret, works when the site is unreachable', async () => {
  const { formatStatus } = await import('../tools/signer/signer.mjs');
  const secret = 'S'.repeat(64);
  const lines = formatStatus({
    now: Date.parse('2026-10-16T12:00:00Z'), host: 'side.example.test',
    log: { lastOk: '2026-10-16T11:30:00.000Z', lastRun: '2026-10-16T11:55:00.000Z', lastRunOk: false, consecutiveFailed: 5, runs: 40 },
    launchd: { loaded: true, runs: 40, lastExit: 1 },
    queue: { ok: true, outboxQueued: 2, awaitingToken: 1, awaitingPlayList: 3 }
  }).join('\n');
  for (const want of ['launchd job com.sidekick.signer: loaded (runs 40, last exit code 1)', 'last run: 2026-10-16T11:55:00.000Z (failed)', 'last successful run: 2026-10-16T11:30:00.000Z (30 min ago)', 'consecutive failed runs: 5',
    'queue on side.example.test: 2 emails waiting to send, 1 token to issue, 3 waiting for the Play list']) assert.ok(lines.includes(want), want + '\n' + lines);
  assert.ok(!lines.includes(secret) && !/@/.test(lines), 'no secret, no address');
  const down = formatStatus({ now: 0, host: 'h.test', log: parseEmpty(), launchd: { loaded: false }, queue: { ok: false, code: 'ENOTFOUND' } }).join('\n');
  assert.match(down, /launchd job com\.sidekick\.signer: NOT loaded/);
  assert.match(down, /last successful run: never/);
  assert.match(down, /queue on h\.test: unavailable \(ENOTFOUND\)/);
  function parseEmpty() { return { lastOk: null, lastRun: null, lastRunOk: null, consecutiveFailed: 0, runs: 0 }; }
});

test('API queue (signer key): counts only — emails waiting, tokens to issue, people waiting for the Play list', async () => {
  const w = world();
  await w.h.signup();
  await w.h.confirm();
  const r = await w.post('queue');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r).sort(), ['androidPending', 'awaitingPlayList', 'awaitingToken', 'ok', 'outboxQueued', 'poolReady', 'status']);
  assert.equal(r.poolReady, 0); assert.equal(r.androidPending, 1, 'the approved Google account waits for the Play list');
  assert.ok(Number.isInteger(r.outboxQueued) && r.outboxQueued >= 1, 'the confirm email is queued');
  assert.equal(r.awaitingToken + r.awaitingPlayList, 1, 'the approved person is counted once');
  assert.ok(!JSON.stringify(r).includes('@'), 'no addresses');
});
