// Pure-JS repository with the same behaviour as PgRepo (both pass test/repo-contract.test.mjs).
// For tests, the demo and the local dev server; nothing survives a restart.
import crypto from 'node:crypto';
import { POOL_MAX_AGE_MS, POOL_MIN_LEFT_MS, utcDay } from './pool.mjs';

const ALLOWED = ['approved', 'play_added', 'issued', 'delivered'];
const MAILS = ['invite', 'token']; // a signup is delivered once both are sent
const DAY = 86400000;
const clone = (o) => (o ? structuredClone(o) : null);

export class MemoryRepo {
  constructor() {
    this.signups = new Map(); this.links = new Map(); this.rate = new Map(); this.downloads = [];
    this.outbox = []; this.notify = []; this.feedback = []; this.nonces = new Map(); this.settings = {}; this.rules = [];
    this.pool = []; this.dlCounts = new Map();
    this.failNext = null;
  }
  _fail(name) { if (this.failNext === name) { this.failNext = null; throw new Error('simulated database failure'); } }
  async migrate() {}
  async schemaVersion() { return 3; }

  async upsertSignup(v, now) {
    this._fail('upsertSignup');
    for (const s of this.signups.values()) if (s.emailNorm === v.emailNorm) return { signup: clone(s), created: false };
    const t = new Date(now);
    const s = { id: crypto.randomUUID(), email: v.email, emailNorm: v.emailNorm, name: v.name, macChip: v.macChip ?? null, phoneModel: v.phoneModel ?? null, googleEmail: v.googleEmail ?? null, playAddedAt: null, tokenSource: null, copyEmailedAt: null, androidInvitedAt: null,
      privacyAcceptedAt: t, marketingRequestedAt: v.marketingOptIn ? t : null, marketingConfirmedAt: null, state: 'pending_email',
      createdAt: t, updatedAt: t, confirmedAt: null, approvedAt: null, token: null, tokenIssuedAt: null, tokenEmailedAt: null, signerClaimedAt: null };
    this.signups.set(s.id, s);
    return { signup: clone(s), created: true };
  }
  async setMarketingRequest(id, wanted, now) {
    const s = this.signups.get(id);
    if (!s) return null;
    if (!s.marketingConfirmedAt) { s.marketingRequestedAt = wanted === true ? (s.marketingRequestedAt || new Date(now)) : null; s.updatedAt = new Date(now); }
    return clone(s);
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
  // Why a link can't be used, for the page that says so (launch log Part 20): used wins over expired.
  async linkState(hash, now) {
    const l = this.links.get(hash);
    if (!l) return null;
    return { purpose: l.purpose, state: l.uses >= l.maxUses ? 'used' : l.expiresAt.getTime() <= now ? 'expired' : 'ok' };
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

  // gate: only people whose Google account is on the Play test list (play_added) get a token.
  async claimPending(now, limit, claimTtlMs, { gate = false } = {}) {
    const out = [];
    // Gated: on the Play test list, or approved with no Google account to add (a Mac-only sign-up).
    const ready = (s) => gate ? s.state === 'play_added' || (s.state === 'approved' && !s.googleEmail) : s.state === 'approved';
    const list = [...this.signups.values()].filter(s => ready(s) && !s.token && (!s.signerClaimedAt || s.signerClaimedAt.getTime() < now - claimTtlMs))
      .sort((a, b) => a.approvedAt - b.approvedAt).slice(0, limit);
    for (const s of list) { s.signerClaimedAt = new Date(now); out.push({ id: s.id, name: s.name }); }
    return out;
  }
  async storeToken(id, token, now, { gate = false } = {}) {
    const s = this.signups.get(id);
    if (!s) return 'not_found';
    const ok = gate ? s.state === 'play_added' || (s.state === 'approved' && !s.googleEmail) : s.state === 'approved';
    if (s.token || !ok) return 'conflict';
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
    // Transactional emails first; announcements wait behind them (stable order otherwise).
    const rows = this.outbox.filter(m => !m.sentAt && m.attempts < 5 && (!m.claimedAt || m.claimedAt.getTime() < now - claimTtlMs))
      .map((m, i) => [m, i]).sort((a, b) => ((a[0].kind === 'announce') - (b[0].kind === 'announce')) || a[1] - b[1]).map(x => x[0]).slice(0, limit);
    for (const m of rows) { m.claimedAt = new Date(now); m.attempts++; }
    return rows.map(m => ({ id: m.id, kind: m.kind, toEmail: m.toEmail, subject: m.subject, text: m.text }));
  }
  async ackOutbox(id, ok, errorCode, now) {
    const m = this.outbox.find(x => x.id === id);
    if (!m || m.sentAt) return false;
    if (!ok) { m.claimedAt = null; m.lastError = String(errorCode || 'failed').slice(0, 40); return true; }
    m.sentAt = new Date(now); m.toEmail = ''; m.text = '';
    if (MAILS.includes(m.kind) && m.signupId && !this.outbox.some(x => x.signupId === m.signupId && MAILS.includes(x.kind) && !x.sentAt)) {
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

  // The Play test list: approved people whose Google account the owner still has to add, oldest first.
  // Also instant (pool) sign-ups with a Google account not yet added: their token came on the page, Android waits.
  _androidWaiting(s) { return s.tokenSource === 'pool' && s.googleEmail && !s.playAddedAt && ['issued', 'delivered'].includes(s.state); }
  async playPending() {
    return [...this.signups.values()].filter(s => (s.state === 'approved' && s.googleEmail) || this._androidWaiting(s)).sort((a, b) => a.approvedAt - b.approvedAt)
      .map(s => ({ id: s.id, googleEmail: s.googleEmail }));
  }
  async androidPendingCount() { return (await this.playPending()).length; }
  // google-group: pool sign-ups whose Google account the signer adds to the group (the old flow keeps play-mark-added).
  async androidPending(limit = 20) {
    return [...this.signups.values()].filter(s => this._androidWaiting(s)).sort((a, b) => a.approvedAt - b.approvedAt).slice(0, limit)
      .map(s => ({ id: s.id, googleEmail: s.googleEmail }));
  }
  async markAndroidAdded(id, now) {
    const s = this.signups.get(id);
    if (!s || !this._androidWaiting(s)) return false;
    s.playAddedAt = new Date(now); s.updatedAt = new Date(now);
    return true;
  }
  // Everyone who should be on the Play test list: already added, or approved and waiting to be added.
  async playListAll() {
    return [...this.signups.values()].filter(s => s.googleEmail && ['approved', 'play_added', 'issued', 'delivered'].includes(s.state))
      .sort((a, b) => a.createdAt - b.createdAt).map(s => s.googleEmail);
  }
  // Marks approved people whose Google account is in the list as added. Returns how many matched and how many didn't.
  async markPlayAdded(googleEmails, now) {
    const want = new Set(googleEmails);
    let marked = 0;
    const hit = new Set();
    const androidInvite = [];
    for (const s of this.signups.values()) {
      if (s.state === 'approved' && want.has(s.googleEmail)) { s.state = 'play_added'; s.playAddedAt = new Date(now); s.updatedAt = new Date(now); marked++; hit.add(s.googleEmail); }
      else if (this._androidWaiting(s) && want.has(s.googleEmail)) { s.playAddedAt = new Date(now); s.updatedAt = new Date(now); marked++; hit.add(s.googleEmail); androidInvite.push(s.id); }
    }
    return { marked, unmatched: [...want].filter(e => !hit.has(e)).length, androidInvite };
  }
  // Update emails go only to people who asked for them on the form AND confirmed by email.
  async announceRecipients() {
    return [...this.signups.values()].filter(s => s.marketingRequestedAt && s.marketingConfirmedAt).sort((a, b) => a.createdAt - b.createdAt)
      .map(s => ({ id: s.id, emailNorm: s.emailNorm, name: s.name }));
  }

  // ── the token pool ──
  async addPoolTokens(list, now) {
    let added = 0;
    for (const { token, notAfter } of list) {
      if (this.pool.some(p => p.token === token)) continue;
      this.pool.push({ id: crypto.randomUUID(), token, notAfter: new Date(notAfter), createdAt: new Date(now), issuedAt: null, signupId: null });
      added++;
    }
    return added;
  }
  _usable(p, now, { maxAgeMs, minLeftMs }) { return !p.issuedAt && p.createdAt.getTime() >= now - maxAgeMs && p.notAfter.getTime() >= now + minLeftMs; }
  async poolStatus(now, o) {
    const free = this.pool.filter(p => !p.issuedAt);
    const ready = free.filter(p => this._usable(p, now, o)).length;
    return { ready, stale: free.length - ready, issuedToday: this.pool.filter(p => p.issuedAt && p.issuedAt.getTime() >= o.dayStart).length };
  }
  // Hands the oldest usable token (earliest end date) to a sign-up that has none, under the daily cap. One step.
  async issuePoolToken(signupId, now, o) {
    this._fail('issuePoolToken');
    const s = this.signups.get(signupId);
    if (!s || s.state !== 'pending_email' || s.tokenIssuedAt) return null;
    if (this.pool.filter(p => p.issuedAt && p.issuedAt.getTime() >= o.dayStart).length >= o.dailyCap) return null;
    const p = this.pool.map((x, i) => [x, i]).filter(([x]) => this._usable(x, now, o)).sort((a, b) => (a[0].notAfter - b[0].notAfter) || (a[0].createdAt - b[0].createdAt) || (a[1] - b[1]))[0];
    if (!p) return null;
    const t = new Date(now);
    p[0].issuedAt = t; p[0].signupId = s.id;
    s.state = 'delivered'; s.tokenSource = 'pool'; s.tokenIssuedAt = t; s.approvedAt = s.approvedAt || t; s.updatedAt = t;
    return p[0].token;
  }
  async poolTokenFor(signupId) { const p = this.pool.find(x => x.signupId === signupId); return p ? p.token : null; }
  async prunePool(now, o) { const n = this.pool.length; this.pool = this.pool.filter(p => p.issuedAt || this._usable(p, now, o)); return n - this.pool.length; }
  async markCopyEmailed(id, now) { const s = this.signups.get(id); if (!s || s.copyEmailedAt) return false; s.copyEmailedAt = new Date(now); return true; }
  async markAndroidInvited(id, now) { const s = this.signups.get(id); if (!s || s.androidInvitedAt) return false; s.androidInvitedAt = new Date(now); return true; }
  // A plain counter per UTC day, platform and target ('direct' | 'drive'): no IP, no sign-up, nothing personal.
  async countDownload({ platform, target }, now) {
    this._fail('countDownload');
    const day = utcDay(now), k = `${day}|${platform}|${target}`;
    const c = this.dlCounts.get(k) || { day, platform, target, count: 0 };
    c.count++; this.dlCounts.set(k, c);
  }
  async downloadCounts() { return [...this.dlCounts.values()].map(c => ({ ...c })).sort((a, b) => a.day.localeCompare(b.day) || a.platform.localeCompare(b.platform) || a.target.localeCompare(b.target)); }

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
    const signups = { pending_email: 0, approved: 0, play_added: 0, issued: 0, delivered: 0, waitlisted: 0, denied: 0, total: 0 };
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
    this.pool = this.pool.filter(p => p.signupId !== id); // the issued token's record goes with the row
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
    for (const [k, c] of this.dlCounts) if (c.day < new Date(before(180)).toISOString().slice(0, 10)) this.dlCounts.delete(k);
    this.pool = this.pool.filter(p => p.issuedAt ? p.issuedAt.getTime() >= before(46) : this._usable(p, now, { maxAgeMs: POOL_MAX_AGE_MS, minLeftMs: POOL_MIN_LEFT_MS }));
    this.notify = this.notify.filter(n => n.confirmedAt ? n.confirmedAt.getTime() >= before(365) : n.createdAt.getTime() >= before(7));
    this.feedback = this.feedback.filter(f => f.createdAt.getTime() >= before(365));
    return c;
  }

  // Test helpers only.
  debugOutbox() { return this.outbox.map(m => ({ ...m })); }
  debugCount(t) { return ({ signups: this.signups.size, links: this.links.size, downloads: this.downloads.length, notify: this.notify.length, feedback: this.feedback.length, outbox: this.outbox.length, pool: this.pool.length })[t]; }
  debugAll(t) { return structuredClone(({ downloads: this.downloads, signups: [...this.signups.values()] })[t]); }
}
