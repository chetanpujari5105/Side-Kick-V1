// Response helpers, security headers, body and cookie parsing.
import crypto from 'node:crypto';

export const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin'
};

const JSON_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function json(status, body, extra = {}) {
  const h = new Headers({ ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'content-security-policy': JSON_CSP });
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else if (v !== undefined) h.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function html(status, markup, nonce, extra = {}) {
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
  const h = new Headers({ ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp });
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else if (v !== undefined) h.set(k, v);
  }
  return new Response(markup, { status, headers: h });
}

// Redirect to a fixed same-site path or to a URL produced by our own storage adapter. Never call with input.
export function redirect(status, location, extra = {}) {
  const h = new Headers({ ...SECURITY_HEADERS, location, 'content-security-policy': JSON_CSP });
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else if (v !== undefined) h.set(k, v);
  }
  return new Response(null, { status, headers: h });
}

export const newNonce = () => crypto.randomBytes(16).toString('base64');

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const MAX_BODY = 16 * 1024;

// Reads a JSON or form-urlencoded body. Returns {data, form:boolean, raw}.
export async function readBody(request, { allowForm = true } = {}) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'TOO_LARGE');
  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length > MAX_BODY) throw new HttpError(413, 'TOO_LARGE');
  const raw = buf.toString('utf8');
  if (type === 'application/json') {
    try {
      const data = raw ? JSON.parse(raw) : {};
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
      return { data, form: false, raw };
    } catch { throw new HttpError(400, 'BAD_JSON'); }
  }
  if (allowForm && type === 'application/x-www-form-urlencoded') {
    const data = {};
    for (const [k, v] of new URLSearchParams(raw)) data[k] = v;
    return { data, form: true, raw };
  }
  throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE');
}

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Client IP. Vercel overwrites x-forwarded-for and does not forward external IPs
// (vercel.com/docs/headers/request-headers, read 2026-10-15). Only used hashed, for rate limits.
export function clientIp(request) {
  const v = request.headers.get('x-real-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0];
  return (v || 'unknown').trim().slice(0, 64);
}

// A browser sends Origin on every POST; when present it must be ours. Absent (curl, old clients) is allowed:
// those requests still need Turnstile, and signup carries no ambient authority.
export function originAllowed(request, appOrigin) {
  const o = request.headers.get('origin');
  if (!o) return true;
  return o === appOrigin;
}

export const wantsHtml = (request) => /text\/html/.test(request.headers.get('accept') || '') && !/application\/json/.test(request.headers.get('accept') || '');
