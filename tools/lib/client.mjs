// Signed POSTs to /api/admin/* for the signer and the admin CLI, and secrets from the macOS login Keychain.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { signRequest } from '../../server/crypto.mjs';

// A Vercel Preview behind Deployment Protection needs the project's "Protection Bypass for Automation" secret in
// the x-vercel-protection-bypass header (vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/
// protection-bypass-automation). SK_VERCEL_BYPASS_FILE names a file holding it (mode 600). Production needs none.
function bypassHeader() {
  const file = process.env.SK_VERCEL_BYPASS_FILE;
  if (!file) return {};
  if (fs.statSync(file).mode & 0o077) throw new Error('SK_VERCEL_BYPASS_FILE must be readable by you only (chmod 600)');
  return { 'x-vercel-protection-bypass': fs.readFileSync(file, 'utf8').trim() };
}

// A network failure as one line for the logs: the cause code (ENOTFOUND, ETIMEDOUT, ECONNRESET…, TIMEOUT for our own
// time limit), the host only (never the path or query) and how long it took. The error keeps the code as e.code.
function requestError(e, { host, ms, attempts }) {
  const code = e && e.name === 'TimeoutError' ? 'TIMEOUT' : String((e && e.cause && (e.cause.code || e.cause.name)) || (e && e.code) || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const err = new Error(`fetch failed (${code}) host=${host} ${ms} ms, ${attempts} attempt${attempts === 1 ? '' : 's'}`);
  err.code = code;
  return err;
}

// retries: extra attempts after a NETWORK error only (never after an HTTP answer), each signed afresh after retryDelayMs.
// Only the signer uses it: its four actions are safe to repeat. The admin CLI keeps retries = 0.
export function makeClient({ base, keyId, secret, fetch: f = fetch, now = () => Date.now(), timeoutMs = 20000, retries = 0, retryDelayMs = 2000, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  const bypass = bypassHeader();
  if (!/^https:\/\/[A-Za-z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base || '')) throw new Error('SK_API_BASE must be https://<host> (or http://localhost for local testing)');
  const host = new URL(base).host;
  return async function post(action, payload = {}) {
    const path = '/api/admin/' + action;
    const body = JSON.stringify(payload);
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await f(base + path, { method: 'POST', body, headers: { 'content-type': 'application/json', ...bypass, ...signRequest({ keyId, secret, method: 'POST', path, body, now: now() }) }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (attempt <= retries) { await sleep(retryDelayMs); continue; }
        throw requestError(e, { host, ms: Date.now() - started, attempts: attempt });
      }
      let data = {};
      try { data = await res.json(); } catch {}
      return { status: res.status, ...data };
    }
  };
}

// Reads a generic password item. The value goes straight into memory; it is never printed or written.
export function keychainSecret(service, account = process.env.USER) {
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '');
  } catch { return null; }
}

// Order: the variable itself, then <NAME>_FILE (a file readable by its owner only), then the login Keychain.
export function secretFrom(envName, service) {
  if (process.env[envName]) return process.env[envName];
  const file = process.env[envName + '_FILE'];
  if (file) {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & 0o077) throw new Error(`${envName}_FILE must be readable by you only (chmod 600)`);
    return fs.readFileSync(file, 'utf8').trim();
  }
  return keychainSecret(service);
}
