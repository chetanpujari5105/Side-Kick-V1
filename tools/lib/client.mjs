// Signed POSTs to /api/admin/* for the signer and the admin CLI, and secrets from the macOS login Keychain.
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

export function secretFrom(envName, service) {
  return process.env[envName] || keychainSecret(service);
}
