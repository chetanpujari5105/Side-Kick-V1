// The real adapters, driven by a scripted fetch: no network, no accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnstileBotCheck, GitHubReleaseStorage, R2Storage, ResendMailer, presignV4 } from '../server/adapters.mjs';
import { FakeClock } from '../server/fakes.mjs';
import { throwaway } from './helpers.mjs';

function scripted(...replies) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r(url, opts);
    return r;
  };
  f.calls = calls;
  return f;
}
const jsonRes = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('Turnstile: success needs success:true and our hostname; posts secret, response, remoteip, idempotency key', async () => {
  const secret = throwaway();
  const f = scripted(jsonRes(200, { success: true, hostname: 'beta.example.test' }));
  const t = new TurnstileBotCheck({ secret, hostname: 'beta.example.test', fetch: f });
  assert.deepEqual(await t.verify('tok', '203.0.113.5'), { ok: true });
  assert.equal(f.calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const sent = new URLSearchParams(f.calls[0].opts.body);
  assert.equal(sent.get('secret'), secret); assert.equal(sent.get('response'), 'tok'); assert.equal(sent.get('remoteip'), '203.0.113.5');
  assert.match(sent.get('idempotency_key'), /^[0-9a-f-]{36}$/);
  assert.ok(f.calls[0].opts.signal, 'a timeout signal is set');
});

test('Turnstile fails closed on every kind of failure', async () => {
  const cases = [
    [jsonRes(200, { success: false, 'error-codes': ['invalid-input-response'] }), 'invalid-input-response'],
    [jsonRes(200, { success: false, 'error-codes': ['timeout-or-duplicate'] }), 'timeout-or-duplicate'],
    [jsonRes(200, { success: true, hostname: 'evil.example' }), 'hostname-mismatch'],
    [jsonRes(500, { success: true, hostname: 'beta.example.test' }), 'invalid'],
    [new Response('<html>', { status: 200 }), 'bad-response'],
    [Object.assign(new Error('t'), { name: 'TimeoutError' }), 'timeout'],
    [new Error('ECONNRESET'), 'network-error'],
    [jsonRes(200, { success: 'true', hostname: 'beta.example.test' }), 'invalid']
  ];
  for (const [reply, code] of cases) {
    const t = new TurnstileBotCheck({ secret: 's', hostname: 'beta.example.test', fetch: scripted(reply) });
    assert.deepEqual(await t.verify('tok', '1.2.3.4'), { ok: false, code });
  }
  const t = new TurnstileBotCheck({ secret: 's', hostname: 'h', fetch: scripted() });
  assert.equal((await t.verify('', 'x')).ok, false);
  assert.equal((await t.verify('x'.repeat(2049), 'x')).ok, false);
});

test('Turnstile: a real slow server is cut off by the timeout', async () => {
  const slow = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason)));
  const t = new TurnstileBotCheck({ secret: 's', hostname: 'h', fetch: slow, timeoutMs: 50 });
  const started = Date.now();
  assert.deepEqual(await t.verify('tok'), { ok: false, code: 'timeout' });
  assert.ok(Date.now() - started < 2000);
});

test('GitHub storage: finds the asset by name, follows nothing, returns the 302 Location; caches the id', async () => {
  const token = throwaway();
  const loc = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?se=2026&sig=x';
  const f = scripted(
    jsonRes(200, { assets: [{ id: 11, name: 'other.dmg' }, { id: 42, name: 'Sidekick-2.0.1-arm64.dmg' }] }),
    new Response(null, { status: 302, headers: { location: loc } }),
    new Response(null, { status: 302, headers: { location: loc } })
  );
  const g = new GitHubReleaseStorage({ token, repo: 'owner/sidekick-releases', tag: null, fetch: f });
  assert.equal((await g.signedUrl({ file: 'Sidekick-2.0.1-arm64.dmg', version: '2.0.1' })).url, loc);
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/owner/sidekick-releases/releases/tags/v2.0.1');
  assert.equal(f.calls[1].url, 'https://api.github.com/repos/owner/sidekick-releases/releases/assets/42');
  assert.equal(f.calls[1].opts.redirect, 'manual');
  assert.equal(f.calls[1].opts.headers.accept, 'application/octet-stream');
  assert.equal(f.calls[1].opts.headers.authorization, `Bearer ${token}`);
  await g.signedUrl({ file: 'Sidekick-2.0.1-arm64.dmg', version: '2.0.1' });
  assert.equal(f.calls.length, 3, 'asset id cached');
});

test('GitHub storage refuses: missing asset, 200 stream, odd redirect host, API error', async () => {
  const mk = (...r) => new GitHubReleaseStorage({ token: 't', repo: 'o/r', fetch: scripted(...r) });
  const rel = jsonRes(200, { assets: [{ id: 1, name: 'a.dmg' }] });
  await assert.rejects(mk(jsonRes(200, { assets: [] })).signedUrl({ file: 'a.dmg', version: '1.0.0' }));
  await assert.rejects(mk(rel, new Response('bytes', { status: 200 })).signedUrl({ file: 'a.dmg', version: '1.0.0' }));
  await assert.rejects(mk(jsonRes(200, { assets: [{ id: 1, name: 'a.dmg' }] }), new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })).signedUrl({ file: 'a.dmg', version: '1.0.0' }));
  await assert.rejects(mk(jsonRes(200, { assets: [{ id: 1, name: 'a.dmg' }] }), new Response(null, { status: 302, headers: { location: 'http://objects.githubusercontent.com/x' } })).signedUrl({ file: 'a.dmg', version: '1.0.0' }));
  await assert.rejects(mk(jsonRes(404, {})).signedUrl({ file: 'a.dmg', version: '1.0.0' }));
});

test('SigV4 presign matches the AWS documentation example', () => {
  // docs.aws.amazon.com AmazonS3 "Authenticating Requests: Using Query Parameters" example (published test credentials).
  const url = presignV4({ host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', expires: 86400, now: Date.parse('2013-05-24T00:00:00Z') });
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('R2 storage: endpoint, region auto, exact 600 s expiry, checked account id', async () => {
  const clock = new FakeClock(Date.parse('2026-10-15T10:00:00Z'));
  const r = new R2Storage({ accountId: 'a'.repeat(32), accessKeyId: 'AK', secretAccessKey: throwaway(), bucket: 'sidekick-beta', ttl: 600, clock });
  const { url, expiresAt } = await r.signedUrl({ file: 'Sidekick-2.0.1-arm64.dmg' });
  const u = new URL(url);
  assert.equal(u.host, 'a'.repeat(32) + '.r2.cloudflarestorage.com');
  assert.equal(u.pathname, '/sidekick-beta/Sidekick-2.0.1-arm64.dmg');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '600');
  assert.match(u.searchParams.get('X-Amz-Credential'), /^AK\/20261015\/auto\/s3\/aws4_request$/);
  assert.equal(expiresAt, clock.now() + 600000);
  assert.throws(() => new R2Storage({ accountId: 'evil.example/x', accessKeyId: 'a', secretAccessKey: 'b', bucket: 'c', ttl: 600, clock }));
});

test('Resend mailer: request shape; failures are reported, not thrown', async () => {
  const key = throwaway();
  const f = scripted(jsonRes(200, { id: 'x' }), jsonRes(403, {}), new Error('down'));
  const m = new ResendMailer({ apiKey: key, from: 'Sidekick <beta@example.test>', fetch: f });
  assert.deepEqual(await m.send({ to: 'a@example.com', subject: 'S', text: 'T', idempotencyKey: 'k1' }), { ok: true });
  assert.equal(f.calls[0].url, 'https://api.resend.com/emails');
  assert.equal(f.calls[0].opts.headers.authorization, `Bearer ${key}`);
  assert.equal(f.calls[0].opts.headers['idempotency-key'], 'k1');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { from: 'Sidekick <beta@example.test>', to: ['a@example.com'], subject: 'S', text: 'T' });
  assert.deepEqual(await m.send({ to: 'a@example.com', subject: 'S', text: 'T', idempotencyKey: 'k2' }), { ok: false, code: 'http-403' });
  assert.deepEqual(await m.send({ to: 'a@example.com', subject: 'S', text: 'T', idempotencyKey: 'k3' }), { ok: false, code: 'network-error' });
});
