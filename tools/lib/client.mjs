// Signed POSTs to /api/admin/* for the signer and the admin CLI, and secrets from the macOS login Keychain.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { signRequest } from '../../server/crypto.mjs';

export function makeClient({ base, keyId, secret, fetch: f = fetch, now = () => Date.now() }) {
  if (!/^https:\/\/[A-Za-z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base || '')) throw new Error('SK_API_BASE must be https://<host> (or http://localhost for local testing)');
  return async function post(action, payload = {}) {
    const path = '/api/admin/' + action;
    const body = JSON.stringify(payload);
    const res = await f(base + path, { method: 'POST', body, headers: { 'content-type': 'application/json', ...signRequest({ keyId, secret, method: 'POST', path, body, now: now() }) }, signal: AbortSignal.timeout(20000) });
    let data = {};
    try { data = await res.json(); } catch {}
    return { status: res.status, ...data };
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
