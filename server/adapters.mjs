// Real adapters for outside services. Each takes `fetch` so tests can drive it without a network.
// Hosts are fixed here; no endpoint ever fetches a URL that came from a request (no SSRF).
import crypto from 'node:crypto';

// Cloudflare Turnstile Siteverify (developers.cloudflare.com/turnstile/get-started/server-side-validation, read 2026-10-15):
// tokens last 300 s, are single use, ≤ 2048 chars; set a timeout. Anything but a clean success fails closed.
export class TurnstileBotCheck {
  constructor({ secret, hostname, fetch: f = fetch, timeoutMs = 5000 }) { Object.assign(this, { secret, hostname, f, timeoutMs }); }
  async verify(token, ip) {
    if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, code: 'missing-input-response' };
    const body = new URLSearchParams({ secret: this.secret, response: token, idempotency_key: crypto.randomUUID() });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    let res;
    try {
      res = await this.f('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) { return { ok: false, code: e && e.name === 'TimeoutError' ? 'timeout' : 'network-error' }; }
    let data;
    try { data = await res.json(); } catch { return { ok: false, code: 'bad-response' }; }
    if (!res.ok || !data || data.success !== true) return { ok: false, code: String((data && data['error-codes'] || [])[0] || 'invalid').slice(0, 40) };
    if (this.hostname && data.hostname !== this.hostname) return { ok: false, code: 'hostname-mismatch' };
    return { ok: true };
  }
}

// A release asset in a (private) GitHub repo, through the REST API with a fine-grained token (Contents: read).
// The API answers 302 to a signed URL on GitHub's storage; its lifetime is set by GitHub (observed ~1 h, undocumented).
export class GitHubReleaseStorage {
  constructor({ token, repo, tag, fetch: f = fetch, timeoutMs = 5000 }) { Object.assign(this, { token, repo, tag, f, timeoutMs }); this.ids = new Map(); }
  headers(accept) { return { authorization: `Bearer ${this.token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'sidekick-site' }; }
  async signedUrl({ file, version }) {
    const tag = this.tag || `v${version}`;
    let id = this.ids.get(`${tag}/${file}`);
    if (!id) {
      const r = await this.f(`https://api.github.com/repos/${this.repo}/releases/tags/${encodeURIComponent(tag)}`, { headers: this.headers('application/vnd.github+json'), signal: AbortSignal.timeout(this.timeoutMs) });
      if (!r.ok) throw new Error(`github release lookup ${r.status}`);
      const rel = await r.json();
      const asset = (rel.assets || []).find(a => a.name === file);
      if (!asset) throw new Error('github asset missing');
      id = asset.id;
      this.ids.set(`${tag}/${file}`, id);
    }
    const r = await this.f(`https://api.github.com/repos/${this.repo}/releases/assets/${Number(id)}`, { headers: this.headers('application/octet-stream'), redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
    const loc = r.headers.get('location');
    if (r.status !== 302 || !loc) { this.ids.delete(`${tag}/${file}`); throw new Error(`github asset answered ${r.status} without a redirect`); }
    const host = new URL(loc).hostname;
    if (!loc.startsWith('https://') || !(host.endsWith('.githubusercontent.com') || host === 'github.com')) throw new Error('github redirect to an unexpected host');
    return { url: loc, expiresAt: null };
  }
}

// No file host of our own: the "download" is the unlisted Beta page (Drive folder, SHA-256, install steps, Play
// link). The Drive folder is public to anyone with its link; what controls use of the app is the token.
export class StaticLinkStorage {
  constructor({ url }) { this.url = url; }
  async signedUrl() { return { url: this.url, expiresAt: null }; }
}

// AWS Signature V4 query-string presigning (the scheme R2 uses: developers.cloudflare.com/r2/api/s3/presigned-urls).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function presignV4({ host, path, accessKeyId, secretAccessKey, region, expires, now, service = 's3' }) {
  const amzDate = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const query = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const qs = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalPath = path.split('/').map(enc).join('/');
  const canonical = ['GET', canonicalPath, qs, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const key = h(h(h(h('AWS4' + secretAccessKey, date), region), service), 'aws4_request');
  const sig = crypto.createHmac('sha256', key).update(sts).digest('hex');
  return `https://${host}${canonicalPath}?${qs}&X-Amz-Signature=${sig}`;
}

export class R2Storage {
  constructor({ accountId, accessKeyId, secretAccessKey, bucket, ttl, clock }) {
    if (!/^[0-9a-f]{32}$/.test(accountId || '')) throw new Error('R2 account id must be 32 hex characters');
    Object.assign(this, { accountId, accessKeyId, secretAccessKey, bucket, ttl, clock });
  }
  async signedUrl({ file }) {
    const now = this.clock.now();
    const url = presignV4({ host: `${this.accountId}.r2.cloudflarestorage.com`, path: `/${this.bucket}/${file}`, accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey, region: 'auto', expires: this.ttl, now });
    return { url, expiresAt: now + this.ttl * 1000 };
  }
}

// Resend (resend.com/docs/api-reference/emails/send-email, read 2026-10-15). Needs a verified domain to reach
// anyone but the account owner, so it is off until the owner has a domain.
export class ResendMailer {
  constructor({ apiKey, from, fetch: f = fetch, timeoutMs = 10000 }) { Object.assign(this, { apiKey, from, f, timeoutMs }); }
  async send({ to, subject, text, idempotencyKey }) {
    try {
      const r = await this.f('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'idempotency-key': String(idempotencyKey).slice(0, 256) },
        body: JSON.stringify({ from: this.from, to: [to], subject, text })
      });
      return r.ok ? { ok: true } : { ok: false, code: `http-${r.status}` };
    } catch (e) { return { ok: false, code: e && e.name === 'TimeoutError' ? 'timeout' : 'network-error' }; }
  }
}
