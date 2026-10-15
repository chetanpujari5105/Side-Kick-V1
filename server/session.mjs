// Signed session cookie: base64url(payload).base64url(HMAC-SHA256). No server-side session store.
import { b64url, fromB64url, hmac, safeEqual } from './crypto.mjs';

export const COOKIE = 'sk_session';
export const SESSION_TTL_S = 24 * 60 * 60;

export function sealSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(secret, body, 'base64url')}`;
}

// Returns the payload or null. Accepts the current secret and, during a rotation, the previous one.
export function openSession(value, secrets, nowMs) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const good = secrets.filter(Boolean).some(s => safeEqual(sig, hmac(s, body, 'base64url')));
  if (!good) return null;
  let p;
  try { p = JSON.parse(fromB64url(body).toString('utf8')); } catch { return null; }
  if (!p || p.v !== 1 || (p.k !== 'form' && p.k !== 'email')) return null;
  if (typeof p.exp !== 'number' || p.exp * 1000 <= nowMs) return null;
  if (p.k === 'email' && typeof p.sid !== 'string') return null;
  return p;
}

export function sessionCookie(payload, secret, { secure = true } = {}) {
  return `${COOKIE}=${sealSession(payload, secret)}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
