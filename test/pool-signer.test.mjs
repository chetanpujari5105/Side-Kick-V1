// The signer's side of the one-click flow (launch log Part 7): minting the token pool with the existing issuer and
// a throwaway key, uploading only token strings, discarding stale ones, the status lines, the Google Group provider
// against a LOCAL MOCK of Google's endpoints (never the real Google), and the admin play-batch commands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setup, ORIGIN, poolToken } from './helpers.mjs';
import { runPool, poolLines, formatStatus, loadSignerConfig, parseSignerLog } from '../tools/signer/signer.mjs';
import { loadGroupConfig, runAndroidGroup } from '../tools/signer/android-group.mjs';
import { makeClient } from '../tools/lib/client.mjs';

const DAY = 86400000;
const ISSUER = new URL('./fixtures/fake-issuer-trial.mjs', import.meta.url).pathname;
const ADMIN = new URL('../tools/admin/admin.mjs', import.meta.url).pathname;
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

function world(env = {}) {
  const h = setup({ env });
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const dir = tmp('sk-pool-test-');
  const keyFile = path.join(dir, 'throwaway.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const cfg = { ...loadSignerConfig({}), issuer: ISSUER, keySource: 'file', keyFile, tokensDir: path.join(dir, 'tokens'), days: '45' };
  const post = makeClient({ base: ORIGIN, keyId: 'signer', secret: h.env.ADMIN_AUTH_SIGNER_SECRET, fetch: (u, o) => h.app.fetch(new Request(u, o)), now: () => h.clock.now() });
  const status = async () => (await post('pool-status')).ready;
  return { h, cfg, post, dir, status };
}

test('signer config: pool low-water 40 and max 100 by default, SK_POOL=off disables it', () => {
  const c = loadSignerConfig({});
  assert.equal(c.poolLow, 40); assert.equal(c.poolMax, 100); assert.equal(c.pool, true); assert.equal(c.poolLabel, 'Sidekick beta');
  assert.equal(loadSignerConfig({ SK_POOL: 'off' }).pool, false);
  assert.equal(loadSignerConfig({ SK_POOL_LOW: '5', SK_POOL_MAX: '12' }).poolLow, 5);
});

test('pool: below the low-water mark the signer mints up to the max with the issuer, uploads only token strings, keeps no copy', async () => {
  const w = world();
  const cfg = { ...w.cfg, poolLow: 4, poolMax: 10 };
  const lines = [];
  const seen = [];
  const post = async (action, payload) => { seen.push([action, payload]); return w.post(action, payload); };
  const r = await runPool({ cfg, post, log: (l) => lines.push(l) });
  assert.deepEqual(r, { discarded: 0, minted: 10, uploaded: 10, ready: 10, failed: 0 });
  assert.equal(await w.status(), 10);
  const adds = seen.filter(([a]) => a === 'pool-add');
  assert.ok(adds.every(([, p]) => Object.keys(p).join() === 'tokens' && p.tokens.every(t => /^SIDEKICK-TRIAL-1\./.test(t))), 'only token strings go up');
  assert.ok(adds.every(([, p]) => p.tokens.length <= 25), 'in chunks small enough for the API');
  const labels = adds.flatMap(([, p]) => p.tokens).map(t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).label);
  assert.ok(labels.every(l => l === 'Sidekick beta'), 'no visitor name in a pre-minted token');
  assert.deepEqual(fs.readdirSync(path.join(cfg.tokensDir, 'pool')), [], 'uploaded tokens are not kept on disk');
  assert.ok(!lines.join('\n').includes('SIDEKICK-TRIAL-1.'), 'no token in the log');
  // At or above the low-water mark nothing is minted.
  const again = await runPool({ cfg, post: w.post, log: () => {} });
  assert.equal(again.minted, 0);
});

test('pool: stale tokens are discarded first and replaced; a failed upload keeps the files for the next run', async () => {
  const w = world();
  const cfg = { ...w.cfg, poolLow: 3, poolMax: 4 };
  await runPool({ cfg, post: w.post, log: () => {} });
  w.h.clock.advance(11 * DAY);
  let fail = true;
  const flaky = async (a, p) => (a === 'pool-add' && fail ? { status: 503 } : w.post(a, p));
  const r1 = await runPool({ cfg, post: flaky, log: () => {} });
  assert.equal(r1.discarded, 4);
  assert.equal(r1.uploaded, 0); assert.equal(r1.failed, 4);
  assert.equal(fs.readdirSync(path.join(cfg.tokensDir, 'pool')).length, 4, 'kept (mode 600) to upload next time');
  assert.ok(fs.readdirSync(path.join(cfg.tokensDir, 'pool')).every(f => (fs.statSync(path.join(cfg.tokensDir, 'pool', f)).mode & 0o777) === 0o600));
  fail = false;
  const r2 = await runPool({ cfg, post: flaky, log: () => {} });
  assert.deepEqual(r2, { discarded: 0, minted: 0, uploaded: 4, ready: 4, failed: 0 }, 'the leftovers go up before anything new is minted');
});

test('pool lines: below the low-water mark the log gets an ATTENTION line', () => {
  const iso = '2026-10-18T08:00:00.000Z';
  assert.deepEqual(poolLines({ discarded: 0, minted: 0, uploaded: 0, ready: 12, failed: 0 }, { poolLow: 40, iso }), [
    `${iso} signer pool: {"discarded":0,"minted":0,"uploaded":0,"ready":12,"failed":0}`,
    `${iso} ATTENTION: token pool below the low-water mark (12 ready, low-water 40). Instant sign-ups fall back to the email flow when it is empty.`]);
  assert.equal(poolLines({ discarded: 0, minted: 60, uploaded: 60, ready: 100, failed: 0 }, { poolLow: 40, iso }).length, 1);
  // A pool line is not a run line: it never changes the success/failure count.
  assert.equal(parseSignerLog(`${iso} signer pool: {}\n${iso} ATTENTION: x`).runs, 0);
});

test('status: pool size with ATTENTION below the low-water mark, and the Android backlog', () => {
  const base = { now: Date.parse('2026-10-18T08:00:00Z'), host: 'side.example.test', log: parseSignerLog(''), launchd: { loaded: true, runs: 3, lastExit: '0' } };
  const q = { ok: true, outboxQueued: 0, awaitingToken: 0, awaitingPlayList: 0, poolReady: 7, androidPending: 2 };
  const lines = formatStatus({ ...base, queue: q, poolLow: 40 });
  assert.ok(lines.includes('token pool on side.example.test: 7 ready (low-water 40) — ATTENTION: below the low-water mark'));
  assert.ok(lines.includes('Android: 2 Google accounts waiting to be added to the Play test list (admin play-batch)'));
  const ok = formatStatus({ ...base, queue: { ...q, poolReady: 80, androidPending: 0 }, poolLow: 40 });
  assert.ok(ok.includes('token pool on side.example.test: 80 ready (low-water 40)'));
  assert.ok(ok.includes('Android: 0 Google accounts waiting to be added to the Play test list (admin play-batch)'));
});

// ── google-group, against a local mock only ──────────────────────────────────
function mockGoogle() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const members = new Set(), calls = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    calls.push(`${req.method} ${req.url.split('?')[0]}`);
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/token') {
      const a = new URLSearchParams(body).get('assertion') || '';
      const [h, p, s] = a.split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), publicKey, Buffer.from(s || '', 'base64url'));
      const claims = ok ? JSON.parse(Buffer.from(p, 'base64url')) : {};
      if (!ok || claims.scope !== 'https://www.googleapis.com/auth/cloud-identity.groups' || claims.iss !== 'signer@test.iam.example') return send(401, { error: 'invalid_grant' });
      return send(200, { access_token: 'mock-access', expires_in: 3600 });
    }
    if (req.headers.authorization !== 'Bearer mock-access') return send(401, {});
    if (req.url.startsWith('/v1/groups:lookup?') && new URL(req.url, 'http://x').searchParams.get('groupKey.id') === 'sidekick-beta@example.test') return send(200, { name: 'groups/abc123' });
    if (req.method === 'POST' && req.url === '/v1/groups/abc123/memberships') {
      const m = JSON.parse(body);
      const id = m.preferredMemberKey && m.preferredMemberKey.id;
      if (id === 'fails@gmail.com') return send(403, { error: { status: 'PERMISSION_DENIED' } });
      if (members.has(id)) return send(409, { error: { status: 'ALREADY_EXISTS' } });
      members.add(id);
      return send(200, { done: true });
    }
    send(404, {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, members, calls, privateKey, base: `http://127.0.0.1:${server.address().port}` })));
}

test('google-group is off unless SK_ANDROID_ACCESS=google-group, and then needs its local settings', () => {
  assert.equal(loadGroupConfig({}).enabled, false);
  const c = loadGroupConfig({ SK_ANDROID_ACCESS: 'google-group' });
  assert.equal(c.enabled, true);
  assert.deepEqual(c.problems, ['SK_GOOGLE_GROUP', 'SK_GOOGLE_CREDENTIALS_FILE']);
  assert.equal(c.apiBase, 'https://cloudidentity.googleapis.com');
});

test('google-group (MOCK): adds each pending Google account to the group, then marks it; a refusal leaves it pending', async () => {
  const g = await mockGoogle();
  try {
    const w = world({ ANDROID_ACCESS: 'google-group' });
    const pool = [];
    for (let i = 0; i < 3; i++) pool.push(poolToken(w.h.clock.now()));
    await w.post('pool-add', { tokens: pool });
    const su = (email, google, ip) => w.h.call('POST', '/api/get-sidekick', { json: { name: 'G ' + email, email, privacyAccepted: true, android: true, phoneModel: 'Pixel 8', googleEmail: google, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }, headers: { origin: ORIGIN }, ip });
    await su('a@example.com', 'a.member@gmail.com', '198.51.100.1');
    await su('b@example.com', 'fails@gmail.com', '198.51.100.2');
    g.members.add('c.already@gmail.com');
    await su('c@example.com', 'c.already@gmail.com', '198.51.100.3');
    const creds = path.join(tmp('sk-gcreds-'), 'sa.json');
    fs.writeFileSync(creds, JSON.stringify({ type: 'service_account', client_email: 'signer@test.iam.example', private_key: g.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
    const cfg = loadGroupConfig({ SK_ANDROID_ACCESS: 'google-group', SK_GOOGLE_GROUP: 'sidekick-beta@example.test', SK_GOOGLE_CREDENTIALS_FILE: creds, SK_GOOGLE_API_BASE: g.base, SK_GOOGLE_TOKEN_URL: g.base + '/token' });
    assert.deepEqual(cfg.problems, []);
    const lines = [];
    const r = await runAndroidGroup({ cfg, post: w.post, log: (l) => lines.push(l), now: () => w.h.clock.now() });
    assert.deepEqual(r, { pending: 3, added: 2, failed: 1 });
    assert.ok(g.members.has('a.member@gmail.com'));
    assert.equal(w.h.repo.debugOutbox().filter(m => m.kind === 'android').length, 2, 'the invitation goes only after a successful add (or already a member)');
    assert.deepEqual((await w.post('android-pending')).pending.map(p => p.googleEmail), ['fails@gmail.com']);
    assert.ok(lines.some(l => /PERMISSION_DENIED|HTTP 403/.test(l)) && !lines.join('\n').includes('mock-access'), 'the refusal is logged, the access token never');
    // A credentials file readable by others is refused before anything is sent.
    fs.chmodSync(creds, 0o644);
    await assert.rejects(runAndroidGroup({ cfg, post: w.post, log: () => {} }), /chmod 600/);
  } finally { g.server.close(); }
});

// ── admin play-batch / play-mark-added --all-pending ─────────────────────────
async function adminWorld() {
  const h = setup();
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const r = await h.app.fetch(new Request(ORIGIN + req.url, { method: req.method, headers, body: req.method === 'POST' ? body : undefined }));
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const state = tmp('sk-admin-state-');
  // Async: the CLI talks to the server in this same process, so the event loop must stay free.
  const run = (...args) => new Promise(resolve => {
    const c = spawn(process.execPath, [ADMIN, ...args], { env: { PATH: process.env.PATH, HOME: state, SK_API_BASE: `http://127.0.0.1:${server.address().port}`, SK_ADMIN_SECRET: h.env.ADMIN_AUTH_SECRET, SK_ADMIN_STATE_DIR: state } });
    let stdout = '', stderr = '';
    c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; });
    c.on('close', status => resolve({ status, stdout, stderr }));
  });
  return { h, server, state, run };
}

test('admin play-batch prints the count and one comma-separated paste; play-mark-added --all-pending needs --yes and marks only that batch', async () => {
  const a = await adminWorld();
  try {
    // The signed admin client uses the real clock; keep the app's clock in step.
    a.h.clock.set(Date.now());
    await a.h.admin('/api/admin/pool-add', { tokens: [poolToken(Date.now()), poolToken(Date.now()), poolToken(Date.now())] }, { key: 'signer' });
    const su = (email, google, ip) => a.h.call('POST', '/api/get-sidekick', { json: { name: 'P ' + email, email, privacyAccepted: true, android: true, phoneModel: 'Pixel 8', googleEmail: google, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }, headers: { origin: ORIGIN }, ip });
    await su('one@example.com', 'one@gmail.com', '198.51.100.1');
    await su('two@example.com', 'two@gmail.com', '198.51.100.2');
    const b = await a.run('play-batch');
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /2 Google accounts? to add/);
    assert.ok(b.stdout.includes('one@gmail.com, two@gmail.com'));
    assert.ok(b.stdout.includes('Sidekick beta testers'));
    const f = path.join(a.state, 'play-batch.json');
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    // Someone signs up after the paste was printed: not in this batch.
    await su('three@example.com', 'three@gmail.com', '198.51.100.3');
    const no = await a.run('play-mark-added', '--all-pending');
    assert.notEqual(no.status, 0);
    assert.match(no.stdout + no.stderr, /2 Google accounts?.*--yes/s);
    assert.equal((await (await a.h.admin('/api/admin/play-pending', {})).json()).count, 3, 'nothing marked without --yes');
    const yes = await a.run('play-mark-added', '--all-pending', '--yes');
    assert.equal(yes.status, 0, yes.stderr);
    assert.match(yes.stdout, /Marked 2/);
    const left = await (await a.h.admin('/api/admin/play-pending', {})).json();
    assert.equal(left.csv, 'three@gmail.com\n', 'the later sign-up waits for the next batch');
    assert.equal(fs.existsSync(f), false, 'the batch file is used once');
    assert.notEqual((await a.run('play-mark-added', '--all-pending', '--yes')).status, 0, 'no batch, nothing to mark');
  } finally { a.server.close(); }
});
