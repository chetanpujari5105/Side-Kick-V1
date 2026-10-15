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
  assert.deepEqual(r, { issued: 1, reused: 0, posted: 1, failed: 0, mailed: 2, mailFailed: 0 }, 'confirm email + token email');
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
  assert.deepEqual(await runCycle({ cfg: w.cfg, post: w.post, mail: w.mail }), { issued: 0, reused: 0, posted: 0, failed: 0, mailed: 0, mailFailed: 0 });
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
