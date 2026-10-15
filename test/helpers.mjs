// Test harness: the whole API on fake adapters. Every secret here is generated in memory for this run.
import crypto from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { FakeBotCheck, FakeStorage, MemoryMailer, FakeClock } from '../server/fakes.mjs';
import { loadConfig } from '../server/config.mjs';
import { createLogger } from '../server/log.mjs';
import { signRequest } from '../server/crypto.mjs';
import releasesJson from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

export const ORIGIN = 'https://sidekick-beta.example.test';
export const T0 = Date.parse('2026-10-15T10:00:00Z');
export const throwaway = (n = 32) => crypto.randomBytes(n).toString('hex');

export function setup(over = {}) {
  const env = {
    APP_ORIGIN: ORIGIN,
    SESSION_SECRET: throwaway(),
    ADMIN_AUTH_SECRET: throwaway(),
    ADMIN_AUTH_SIGNER_SECRET: throwaway(),
    CRON_SECRET: throwaway(16),
    BETA_CAP: '25',
    ...over.env
  };
  const config = loadConfig(env);
  const clock = new FakeClock(T0);
  const repo = over.repo || new MemoryRepo();
  const botCheck = new FakeBotCheck();
  const storage = new FakeStorage(clock, config.downloadTtl);
  const mailer = over.mailer === undefined ? null : over.mailer;
  const logs = [];
  const log = createLogger(line => logs.push(line));
  const releases = over.releases || JSON.parse(JSON.stringify(releasesJson));
  const app = createApp({ config, repo, botCheck, storage, mailer, clock, log, releases, roadmapIds: roadmap.ids });
  const bodies = [];

  async function call(method, path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    let body;
    if (opts.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(opts.json); }
    if (opts.form !== undefined) { headers.set('content-type', 'application/x-www-form-urlencoded'); body = new URLSearchParams(opts.form).toString(); }
    if (opts.raw !== undefined) body = opts.raw;
    if (opts.cookie) headers.set('cookie', opts.cookie);
    if (!headers.has('x-real-ip')) headers.set('x-real-ip', opts.ip || '203.0.113.7');
    const res = await app.fetch(new Request(ORIGIN + path, { method, headers, body, redirect: 'manual' }));
    const text = await res.clone().text();
    bodies.push(text);
    return res;
  }

  async function admin(path, payload = {}, { key = 'admin', secret, ts, nonce, tamper } = {}) {
    const body = JSON.stringify(payload);
    const sec = secret || (key === 'admin' ? env.ADMIN_AUTH_SECRET : env.ADMIN_AUTH_SIGNER_SECRET);
    const h = signRequest({ keyId: key, secret: sec, method: 'POST', path, body, now: ts ?? clock.now(), nonce });
    return call('POST', path, { raw: tamper ? body.replace('}', ',"x":1}') : body, headers: { ...h, 'content-type': 'application/json' } });
  }

  const signupBody = (o = {}) => ({ name: 'Alex Rivera', email: 'alex@example.com', macChip: 'apple', phoneModel: 'Pixel 8',
    privacyAccepted: true, marketingOptIn: false, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX', ...o });

  const signup = (o = {}, opts = {}) => call('POST', '/api/get-sidekick', { json: signupBody(o), headers: { origin: ORIGIN }, ...opts });

  // Finds the newest queued email to an address and returns its link token for a purpose.
  function linkFrom(to, path = '/api/confirm-email') {
    const msgs = repo.debugOutbox().filter(m => m.toEmail === to && m.text.includes(ORIGIN + path));
    if (!msgs.length) return null;
    const m = msgs[msgs.length - 1].text.match(new RegExp(path.replace(/\//g, '\\/') + '\\?t=([A-Za-z0-9_-]+)'));
    return m && m[1];
  }

  async function confirm(email = 'alex@example.com') {
    const t = linkFrom(email);
    const res = await call('POST', '/api/confirm-email', { json: { t, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }, headers: { origin: ORIGIN } });
    return { res, cookie: cookieOf(res) };
  }

  return { env, config, clock, repo, botCheck, storage, logs, bodies, app, call, admin, signup, signupBody, linkFrom, confirm };
}

export function cookieOf(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return null;
  return sc.split(';')[0];
}

export const fakeToken = () => 'SIDEKICK-TRIAL-1.' + crypto.randomBytes(60).toString('base64url') + '.' + crypto.randomBytes(64).toString('base64url');
