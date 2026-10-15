// Small crypto helpers shared by the API, the signer and the admin CLI. Node built-ins only.
import crypto from 'node:crypto';

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (s) => Buffer.from(s, 'base64url');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const hmac = (key, data, enc = 'hex') => crypto.createHmac('sha256', key).update(data).digest(enc);

// Constant-time string compare. Unequal lengths compare a buffer with itself so the time doesn't leak the length.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

// Admin/signer request signing. The string covers method, path, time, nonce and the body hash.
export function signingString({ method, path, ts, nonce, body }) {
  return [method.toUpperCase(), path, String(ts), nonce, sha256hex(body || '')].join('\n');
}

export function signRequest({ keyId, secret, method, path, body, now = Date.now(), nonce = crypto.randomBytes(16).toString('hex') }) {
  const ts = String(now);
  return {
    'x-sk-key': keyId,
    'x-sk-ts': ts,
    'x-sk-nonce': nonce,
    'x-sk-sig': hmac(secret, signingString({ method, path, ts, nonce, body }))
  };
}
