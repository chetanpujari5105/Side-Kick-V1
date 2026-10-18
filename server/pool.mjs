// The token pool's rules, shared by the API and both repositories (launch log Part 7). The signer mints tokens on the
// owner's Mac with the Mac app's issuer and uploads only the token strings; a visitor gets the oldest usable one.
import { isTokenShaped } from './validate.mjs';

const DAY = 86400000;
// Usable: uploaded at most 10 days ago AND at least 35 of its 45 days left, so every visitor gets 35 days or more.
export const POOL_MAX_AGE_MS = 10 * DAY;
export const POOL_MIN_LEFT_MS = 35 * DAY;
export const POOL_ADD_MAX = 40; // tokens per pool-add request (each is about 300 bytes; the API body limit is 16 KB)
export const POOL_LABEL = 'Sidekick beta'; // what the signer writes into a pool token; the app shows "for Sidekick beta"
export const poolRules = (now) => ({ maxAgeMs: POOL_MAX_AGE_MS, minLeftMs: POOL_MIN_LEFT_MS, dayStart: utcDayStart(now) });
export const utcDayStart = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
export const utcDay = (ms) => new Date(utcDayStart(ms)).toISOString().slice(0, 10);

// The end date inside a token, read from its payload (the issuer's {v, id, label, notBefore, notAfter}). Only the
// shape can be checked here; the Mac app checks the signature. null when it isn't the issuer's layout.
export function poolTokenEnd(token) {
  if (!isTokenShaped(token)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.v !== 1 || typeof p.notBefore !== 'string' || typeof p.notAfter !== 'string') return null;
  const from = Date.parse(p.notBefore), to = Date.parse(p.notAfter);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? to : null;
}
