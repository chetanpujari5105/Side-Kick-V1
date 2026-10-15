// Pure-JS repository with the same behaviour as PgRepo (both pass test/repo-contract.test.mjs).
// For tests, the demo and the local dev server; nothing survives a restart.
import crypto from 'node:crypto';

const ALLOWED = ['approved', 'issued', 'delivered'];
const DAY = 86400000;
const clone = (o) => (o ? structuredClone(o) : null);

export class MemoryRepo {
  constructor() {
    this.signups = new Map(); this.links = new Map(); this.rate = new Map(); this.downloads = [];
    this.outbox = []; this.notify = []; this.feedback = []; this.nonces = new Map(); this.settings = {}; this.rules = [];
    this.failNext = null;
  }
  _fail(name) { if (this.failNext === name) { this.failNext = null; throw new Error('simulated database failure'); } }
  async migrate() {}

  async upsertSignup(v, now) {
    this._fail('upsertSignup');
    for (const s of this.signups.values()) if (s.emailNorm === v.emailNorm) return { signup: clone(s), created: false };
    const t = new Date(now);
    const s = { id: crypto.randomUUID(), email: v.email, emailNorm: v.emailNorm, name: v.name, macChip: v.macChip, phoneModel: v.phoneModel,
      privacyAcceptedAt: t, marketingRequestedAt: v.marketingOptIn ? t : null, marketingConfirmedAt: null, state: 'pending_email',
      createdAt: t, updatedAt: t, confirmedAt: null, approvedAt: null, token: null, tokenIssuedAt: null, tokenEmailedAt: null, signerClaimedAt: null };
    this.signups.set(s.id, s);
    return { signup: clone(s), created: true };
  }
  async getSignup(id) { return clone(this.signups.get(id)); }
  async getSignupByEmail(emailNorm) { for (const s of this.signups.values()) if (s.emailNorm === emailNorm) return clone(s); return null; }

  async createLink({ hash, purpose, refId, expiresAt, maxUses }, now) {
    this._fail('createLink');
    this.links.set(hash, { hash, purpose, refId, expiresAt: new Date(expiresAt), maxUses, uses: 0, usedAt: null, createdAt: new Date(now) });
  }
  async peekLink(hash, now) { const l = this.links.get(hash); return l && l.expiresAt.getTime() > now && l.uses < l.maxUses ? clone(l) : null; }
  async useLink(hash, now) {
    const l = this.links.get(hash);
    if (!l || l.expiresAt.getTime() <= now || l.uses >= l.maxUses) return null;
    l.uses++; l.usedAt = new Date(now);
    return clone(l);
  }

  _match(list, email) { const dom = '@' + email.split('@')[1]; return list.some(p => p === email || p === dom); }
  async _cap(defaultCap) { return this.settings.betaCap ?? defaultCap; }
  _countAllowed() { let n = 0; for (const s of this.signups.values()) if (ALLOWED.includes(s.state)) n++; return n; }

  async confirmSignup(id, now, defaultCap) {
    const s = this.signups.get(id);
    if (!s) return null;
    if (s.state !== 'pending_email') return s.state;
    const t = new Date(now);
    s.confirmedAt = s.confirmedAt || t; s.updatedAt = t;
    const deny = this.rules.filter(r => r.kind === 'deny').map(r => r.pattern), allow = this.rules.filter(r => r.kind === 'allow').map(r => r.pattern);
    if (this._match(deny, s.emailNorm)) s.state = 'denied';
    else if (this._match(allow, s.emailNorm) || this._countAllowed() < await this._cap(defaultCap)) { s.state = 'approved'; s.approvedAt = t; }
    else s.state = 'waitlisted';
    return s.state;
  }
  async confirmMarketing(id, now) { const s = this.signups.get(id); if (!s || !s.marketingRequestedAt) return false; s.marketingConfirmedAt = s.marketingConfirmedAt || new Date(now); s.updatedAt = new Date(now); return true; }

  async hit(bucket, windowStart) {
    const r = this.rate.get(bucket);
    if (!r || r.windowStart !== windowStart) { this.rate.set(bucket, { windowStart, count: 1 }); return 1; }
    return ++r.count;
  }

  async logDownload({ signupId, platform, arch }, now) { this._fail('logDownload'); this.downloads.push({ id: this.downloads.length + 1, signupId, platform, arch, createdAt: new Date(now) }); }

  async claimPending(now, limit, claimTtlMs) {
    const out = [];
    const list = [...this.signups.values()].filter(s => s.state === 'approved' && !s.token && (!s.signerClaimedAt || s.signerClaimedAt.getTime() < now - claimTtlMs))
      .sort((a, b) => a.approvedAt - b.approvedAt).slice(0, limit);
    for (const s of list) { s.signerClaimedAt = new Date(now); out.push({ id: s.id, name: s.name }); }
    return out;
  }
  async storeToken(id, token, now) {
    const s = this.signups.get(id);
    if (!s) return 'not_found';
    if (s.token || s.state !== 'approved') return 'conflict';
    s.token = token; s.tokenIssuedAt = new Date(now); s.state = 'issued'; s.updatedAt = new Date(now);
    return 'ok';
  }

  async enqueue({ signupId = null, kind, toEmail, subject, text }, now) {
    this._fail('enqueue');
    const id = crypto.randomUUID();
    this.outbox.push({ id, signupId, kind, toEmail, subject, text, createdAt: new Date(now), claimedAt: null, sentAt: null, attempts: 0, lastError: null });
    return id;
  }
  async claimOutbox(now, limit, claimTtlMs) {
    const rows = this.outbox.filter(m => !m.sentAt && m.attempts < 5 && (!m.claimedAt || m.claimedAt.getTime() < now - claimTtlMs)).slice(0, limit);
    for (const m of rows) { m.claimedAt = new Date(now); m.attempts++; }
    return rows.map(m => ({ id: m.id, kind: m.kind, toEmail: m.toEmail, subject: m.subject, text: m.text }));
  }
  async ackOutbox(id, ok, errorCode, now) {
    const m = this.outbox.find(x => x.id === id);
    if (!m || m.sentAt) return false;
    if (!ok) { m.claimedAt = null; m.lastError = String(errorCode || 'failed').slice(0, 40); return true; }
    m.sentAt = new Date(now); m.toEmail = ''; m.text = '';
    if (m.kind === 'token' && m.signupId) {
      const s = this.signups.get(m.signupId);
      if (s && s.state === 'issued') { s.state = 'delivered'; s.tokenEmailedAt = new Date(now); s.updatedAt = new Date(now); }
    }
    return true;
  }

  async addNotify({ email, featureId }, now) {
    const ex = this.notify.find(n => n.emailNorm === email && n.featureId === featureId);
    if (ex) return { row: clone(ex), created: false };
    const row = { id: crypto.randomUUID(), emailNorm: email, featureId, confirmedAt: null, createdAt: new Date(now) };
    this.notify.push(row);
    return { row: clone(row), created: true };
  }
  async confirmNotify(id, now) { const n = this.notify.find(x => x.id === id); if (!n) return false; n.confirmedAt = n.confirmedAt || new Date(now); return true; }
  async addFeedback({ message, email }, now) { this.feedback.push({ id: crypto.randomUUID(), message, email, createdAt: new Date(now) }); }

  async useNonce(nonce, now) { if (this.nonces.has(nonce)) return false; this.nonces.set(nonce, new Date(now)); return true; }

  async getSettings(defaultCap) {
    return { betaCap: this.settings.betaCap ?? defaultCap, allow: this.rules.filter(r => r.kind === 'allow').map(r => r.pattern), deny: this.rules.filter(r => r.kind === 'deny').map(r => r.pattern) };
  }
  async setSettings({ betaCap, allow, deny }) {
    if (betaCap !== undefined) this.settings.betaCap = betaCap;
    if (allow) this.rules = this.rules.filter(r => r.kind !== 'allow').concat(allow.map(pattern => ({ kind: 'allow', pattern })));
    if (deny) this.rules = this.rules.filter(r => r.kind !== 'deny').concat(deny.map(pattern => ({ kind: 'deny', pattern })));
  }

  async stats() {
    const signups = { pending_email: 0, approved: 0, issued: 0, delivered: 0, waitlisted: 0, denied: 0, total: 0 };
    for (const s of this.signups.values()) { signups[s.state]++; signups.total++; }
    return { signups, downloads: this.downloads.length, outboxPending: this.outbox.filter(m => !m.sentAt).length,
      marketingConfirmed: [...this.signups.values()].filter(s => s.marketingConfirmedAt).length,
      notify: this.notify.filter(n => n.confirmedAt).length, feedback: this.feedback.length };
  }
  async exportSignups() {
    return [...this.signups.values()].sort((a, b) => a.createdAt - b.createdAt).map(s => ({ ...clone(s), token: undefined,
      downloads: this.downloads.filter(d => d.signupId === s.id).length }));
  }
  async setState(id, state, now) {
    const s = this.signups.get(id);
    if (!s) return false;
    s.state = state; s.updatedAt = new Date(now);
    if (state === 'approved' && !s.approvedAt) s.approvedAt = new Date(now);
    if (state === 'approved' && !s.confirmedAt) s.confirmedAt = new Date(now);
    return true;
  }
  async deleteSignup(id) {
    if (!this.signups.delete(id)) return 0;
    for (const [h, l] of this.links) if (l.refId === id) this.links.delete(h);
    this.downloads = this.downloads.filter(d => d.signupId !== id);
    this.outbox = this.outbox.filter(m => m.signupId !== id);
    return 1;
  }
  // Delete-my-data by address: the sign-up (with everything linked to it), roadmap requests and feedback.
  async deleteByEmail(emailNorm) {
    const s = await this.getSignupByEmail(emailNorm);
    const signups = s ? await this.deleteSignup(s.id) : 0;
    const n0 = this.notify.length, f0 = this.feedback.length;
    this.notify = this.notify.filter(n => n.emailNorm !== emailNorm);
    this.feedback = this.feedback.filter(f => f.email !== emailNorm);
    return { signups, notify: n0 - this.notify.length, feedback: f0 - this.feedback.length };
  }
  // Stops every email list for an address: updates consent is withdrawn and roadmap requests are removed.
  async unsubscribe(emailNorm, now) {
    const s = [...this.signups.values()].find(x => x.emailNorm === emailNorm);
    let updates = 0;
    if (s && (s.marketingRequestedAt || s.marketingConfirmedAt)) { s.marketingRequestedAt = null; s.marketingConfirmedAt = null; s.updatedAt = new Date(now); updates = 1; }
    const n0 = this.notify.length;
    this.notify = this.notify.filter(n => n.emailNorm !== emailNorm);
    return { updates, notify: n0 - this.notify.length };
  }
  async promote(now, defaultCap) {
    const cap = await this._cap(defaultCap);
    let room = cap - this._countAllowed(), n = 0;
    const waiting = [...this.signups.values()].filter(s => s.state === 'waitlisted').sort((a, b) => a.confirmedAt - b.confirmedAt);
    for (const s of waiting) { if (room <= 0) break; s.state = 'approved'; s.approvedAt = new Date(now); s.updatedAt = new Date(now); room--; n++; }
    return n;
  }
  async retention(now, { signupDays }) {
    const before = (days) => now - days * DAY;
    const c = {};
    const staleIds = [...this.signups.values()].filter(s => (s.state === 'pending_email' && s.createdAt.getTime() < before(7)) || s.updatedAt.getTime() < before(signupDays)).map(s => s.id);
    for (const id of staleIds) await this.deleteSignup(id);
    c.signups = staleIds.length;
    c.tokensCleared = 0;
    for (const s of this.signups.values()) if (s.token && s.tokenIssuedAt.getTime() < before(46)) { s.token = null; c.tokensCleared++; }
    for (const [h, l] of this.links) if (l.expiresAt.getTime() < before(7)) this.links.delete(h);
    for (const [k, r] of this.rate) if (r.windowStart < before(2)) this.rate.delete(k);
    for (const [k, t] of this.nonces) if (t.getTime() < before(1)) this.nonces.delete(k);
    this.outbox = this.outbox.filter(m => !((m.sentAt && m.sentAt.getTime() < before(7)) || m.createdAt.getTime() < before(30)));
    this.downloads = this.downloads.filter(d => d.createdAt.getTime() >= before(180));
    this.notify = this.notify.filter(n => n.confirmedAt ? n.confirmedAt.getTime() >= before(365) : n.createdAt.getTime() >= before(7));
    this.feedback = this.feedback.filter(f => f.createdAt.getTime() >= before(365));
    return c;
  }

  // Test helpers only.
  debugOutbox() { return this.outbox.map(m => ({ ...m })); }
  debugCount(t) { return ({ signups: this.signups.size, links: this.links.size, downloads: this.downloads.length, notify: this.notify.length, feedback: this.feedback.length, outbox: this.outbox.length })[t]; }
  debugAll(t) { return structuredClone(({ downloads: this.downloads, signups: [...this.signups.values()] })[t]); }
}
