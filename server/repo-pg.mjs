// Postgres repository. `db` is { query(text, params) → rows, transaction([{text, params}]) → [rows] }:
// neonDb() below on Vercel, a PGlite wrapper in tests. Every write is one statement or one non-interactive
// transaction, so the Neon HTTP driver needs no session.
import { POOL_MAX_AGE_MS, POOL_MIN_LEFT_MS } from './pool.mjs';

const ALLOWED = `('approved','play_added','issued','delivered')`;
// Gated: on the Play test list, or approved with no Google account to add (a Mac-only sign-up).
const READY_GATED = `(state = 'play_added' or (state = 'approved' and google_email is null))`;
// Instant (pool) sign-ups whose Google account is not on the Play test list yet: the token came on the page.
const ANDROID_WAITING = `(token_source = 'pool' and google_email is not null and play_added_at is null and state in ('issued','delivered'))`;
const DAY = 86400000;

const camel = (row) => {
  if (!row) return null;
  const o = {};
  for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  if (o.body !== undefined) { o.text = o.body; delete o.body; }
  return o;
};
const one = (rows) => camel(rows[0]) || null;
const d = (ms) => new Date(ms);

// Neon reactivates a suspended compute "within a few hundred milliseconds" (neon.com/docs/introduction/scale-to-zero,
// read 2026-10-15): retry once after 400 ms on a connection-level failure.
async function retry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && (e.code === '23505' || /violates|syntax|duplicate/i.test(e.message || ''))) throw e;
    await new Promise(r => setTimeout(r, 400));
    return fn();
  }
}

export async function neonDb(databaseUrl) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  return {
    query: (text, params = []) => retry(() => sql.query(text, params)),
    transaction: (list) => retry(() => sql.transaction(list.map(q => sql.query(q.text, q.params || []))))
  };
}

export class PgRepo {
  constructor(db) { this.db = db; }
  q(text, params) { return this.db.query(text, params); }

  async migrate(schemaSql) {
    const statements = schemaSql.replace(/--[^\n]*/g, '').split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
    for (const s of statements) await this.q(s, []);
  }

  async schemaVersion() { return Number((await this.q('select max(version) as v from schema_migrations', []))[0].v); }

  async upsertSignup(v, now) {
    const t = d(now);
    const ins = await this.q(`insert into signups (id, email, email_norm, name, mac_chip, phone_model, google_email, privacy_accepted_at, marketing_requested_at, created_at, updated_at)
      values (gen_random_uuid(), $1, $2, $3, $4, $5, $8, $6, $7, $6, $6) on conflict (email_norm) do nothing returning *`,
      [v.email, v.emailNorm, v.name, v.macChip ?? null, v.phoneModel ?? null, t, v.marketingOptIn ? t : null, v.googleEmail ?? null]);
    if (ins.length) return { signup: camel(ins[0]), created: true };
    return { signup: await this.getSignupByEmail(v.emailNorm), created: false };
  }
  // The updates choice of the latest submission, for a request not yet confirmed by its own link: ticked keeps (or
  // starts) the request, unticked withdraws it. Confirmed consent is left to unsubscribe and delete-my-data.
  async setMarketingRequest(id, wanted, now) {
    await this.q('update signups set marketing_requested_at = case when $2::boolean then coalesce(marketing_requested_at, $3) else null end, updated_at = $3 where id = $1 and marketing_confirmed_at is null', [id, wanted === true, d(now)]);
    return this.getSignup(id);
  }
  async getSignup(id) { return one(await this.q('select * from signups where id = $1', [id])); }
  async getSignupByEmail(e) { return one(await this.q('select * from signups where email_norm = $1', [e])); }

  async createLink({ hash, purpose, refId, expiresAt, maxUses }, now) {
    await this.q('insert into email_links (hash, purpose, ref_id, expires_at, max_uses, created_at) values ($1,$2,$3,$4,$5,$6)', [hash, purpose, refId, d(expiresAt), maxUses, d(now)]);
  }
  async peekLink(hash, now) { return one(await this.q('select * from email_links where hash = $1 and expires_at > $2 and uses < max_uses', [hash, d(now)])); }
  async useLink(hash, now) {
    return one(await this.q('update email_links set uses = uses + 1, used_at = $2 where hash = $1 and expires_at > $2 and uses < max_uses returning *', [hash, d(now)]));
  }
  // Why a link can't be used, for the page that says so (launch log Part 20): used wins over expired.
  async linkState(hash, now) {
    const r = (await this.q(`select purpose, case when uses >= max_uses then 'used' when expires_at <= $2 then 'expired' else 'ok' end as state
      from email_links where hash = $1`, [hash, d(now)]))[0];
    return r ? { purpose: r.purpose, state: r.state } : null;
  }

  async confirmSignup(id, now, defaultCap) {
    const t = d(now);
    const [, , , rows] = await this.db.transaction([
      { text: 'select pg_advisory_xact_lock(424242)' },
      { text: `update signups s set confirmed_at = coalesce(s.confirmed_at, $2), updated_at = $2, state = case
          when exists (select 1 from access_rules r where r.kind = 'deny' and (r.pattern = s.email_norm or r.pattern = '@' || split_part(s.email_norm, '@', 2))) then 'denied'
          when exists (select 1 from access_rules r where r.kind = 'allow' and (r.pattern = s.email_norm or r.pattern = '@' || split_part(s.email_norm, '@', 2))) then 'approved'
          when (select count(*) from signups x where x.state in ${ALLOWED}) < coalesce((select value::int from settings where key = 'beta_cap'), $3) then 'approved'
          else 'waitlisted' end
        where s.id = $1 and s.state = 'pending_email'`, params: [id, t, defaultCap] },
      { text: `update signups set approved_at = $2 where id = $1 and state = 'approved' and approved_at is null`, params: [id, t] },
      { text: 'select state from signups where id = $1', params: [id] }
    ]);
    return rows[0] ? rows[0].state : null;
  }
  async confirmMarketing(id, now) {
    return (await this.q('update signups set marketing_confirmed_at = coalesce(marketing_confirmed_at, $2), updated_at = $2 where id = $1 and marketing_requested_at is not null returning id', [id, d(now)])).length > 0;
  }

  async hit(bucket, windowStart) {
    const rows = await this.q(`insert into rate_limits (bucket, window_start, count) values ($1, $2, 1)
      on conflict (bucket) do update set count = case when rate_limits.window_start = excluded.window_start then rate_limits.count + 1 else 1 end,
      window_start = excluded.window_start returning count`, [bucket, windowStart]);
    return Number(rows[0].count);
  }

  async logDownload({ signupId, platform, arch }, now) {
    await this.q('insert into downloads (signup_id, platform, arch, created_at) values ($1,$2,$3,$4)', [signupId, platform, arch, d(now)]);
  }

  // gate: only people whose Google account is on the Play test list (play_added) get a token.
  async claimPending(now, limit, claimTtlMs, { gate = false } = {}) {
    const rows = await this.q(`update signups set signer_claimed_at = $1 where id in (
        select id from signups where ${gate ? READY_GATED : `state = 'approved'`} and token is null and (signer_claimed_at is null or signer_claimed_at < $2)
        order by approved_at limit $3 for update skip locked) returning id, name, approved_at`, [d(now), d(now - claimTtlMs), limit]);
    return rows.sort((a, b) => a.approved_at - b.approved_at).map(r => ({ id: r.id, name: r.name }));
  }
  async storeToken(id, token, now, { gate = false } = {}) {
    const rows = await this.q(`update signups set token = $2, token_issued_at = $3, state = 'issued', updated_at = $3
      where id = $1 and ${gate ? READY_GATED : `state = 'approved'`} and token is null returning id`, [id, token, d(now)]);
    if (rows.length) return 'ok';
    return (await this.getSignup(id)) ? 'conflict' : 'not_found';
  }

  async enqueue({ signupId = null, kind, toEmail, subject, text }, now) {
    const rows = await this.q('insert into outbox (id, signup_id, kind, to_email, subject, body, created_at) values (gen_random_uuid(),$1,$2,$3,$4,$5,$6) returning id',
      [signupId, kind, toEmail, subject, text, d(now)]);
    return rows[0].id;
  }
  async claimOutbox(now, limit, claimTtlMs) {
    const rows = await this.q(`update outbox set claimed_at = $1, attempts = attempts + 1 where id in (
        select id from outbox where sent_at is null and attempts < 5 and (claimed_at is null or claimed_at < $2)
        order by (kind = 'announce'), created_at limit $3 for update skip locked) returning id, kind, to_email, subject, body, created_at`, [d(now), d(now - claimTtlMs), limit]);
    // Transactional emails first; announcements wait behind them.
    return rows.sort((a, b) => ((a.kind === 'announce') - (b.kind === 'announce')) || (a.created_at - b.created_at)).map(r => ({ id: r.id, kind: r.kind, toEmail: r.to_email, subject: r.subject, text: r.body }));
  }
  async ackOutbox(id, ok, errorCode, now) {
    if (!ok) return (await this.q('update outbox set claimed_at = null, last_error = $2 where id = $1 and sent_at is null returning id', [id, String(errorCode || 'failed').slice(0, 40)])).length > 0;
    const t = d(now);
    const [rows] = await this.db.transaction([
      { text: `update outbox set sent_at = $2, to_email = '', body = '' where id = $1 and sent_at is null returning kind, signup_id`, params: [id, t] },
      // Delivered once both the invitation and the token email are sent.
      { text: `update signups s set state = 'delivered', token_emailed_at = $2, updated_at = $2
        where s.id = (select signup_id from outbox where id = $1 and kind in ('invite', 'token')) and s.state = 'issued'
          and not exists (select 1 from outbox o where o.signup_id = s.id and o.kind in ('invite', 'token') and o.sent_at is null)`, params: [id, t] }
    ]);
    return rows.length > 0;
  }

  async addNotify({ email, featureId }, now) {
    const ins = await this.q('insert into roadmap_notify (id, email_norm, feature_id, created_at) values (gen_random_uuid(),$1,$2,$3) on conflict (email_norm, feature_id) do nothing returning *', [email, featureId, d(now)]);
    if (ins.length) return { row: camel(ins[0]), created: true };
    return { row: one(await this.q('select * from roadmap_notify where email_norm = $1 and feature_id = $2', [email, featureId])), created: false };
  }
  async confirmNotify(id, now) { return (await this.q('update roadmap_notify set confirmed_at = coalesce(confirmed_at, $2) where id = $1 returning id', [id, d(now)])).length > 0; }
  async addFeedback({ message, email }, now) { await this.q('insert into feedback (id, message, email, created_at) values (gen_random_uuid(),$1,$2,$3)', [message, email, d(now)]); }

  // The Play test list: approved people whose Google account the owner still has to add, oldest first.
  async playPending() {
    return (await this.q(`select id, google_email from signups where (state = 'approved' and google_email is not null) or ${ANDROID_WAITING} order by approved_at, created_at`, []))
      .map(r => ({ id: r.id, googleEmail: r.google_email }));
  }
  async androidPendingCount() { return (await this.q(`select count(*)::int as n from signups where (state = 'approved' and google_email is not null) or ${ANDROID_WAITING}`, []))[0].n; }
  // google-group: pool sign-ups whose Google account the signer adds to the group (the old flow keeps play-mark-added).
  async androidPending(limit = 20) {
    return (await this.q(`select id, google_email from signups where ${ANDROID_WAITING} order by approved_at, created_at limit $1`, [limit])).map(r => ({ id: r.id, googleEmail: r.google_email }));
  }
  async markAndroidAdded(id, now) {
    return (await this.q(`update signups set play_added_at = $2, updated_at = $2 where id = $1 and ${ANDROID_WAITING} returning id`, [id, d(now)])).length > 0;
  }
  // Everyone who should be on the Play test list: already added, or approved and waiting to be added.
  async playListAll() {
    return (await this.q(`select google_email from signups where google_email is not null and state in ('approved','play_added','issued','delivered') order by created_at`, []))
      .map(r => r.google_email);
  }
  // Marks approved people whose Google account is in the list as added. Returns how many matched and how many didn't.
  async markPlayAdded(googleEmails, now) {
    const list = [...new Set(googleEmails)];
    if (!list.length) return { marked: 0, unmatched: 0 };
    const [rows, pool] = await this.db.transaction([
      { text: `update signups set state = 'play_added', play_added_at = $2, updated_at = $2
        where state = 'approved' and google_email = any($1::text[]) returning google_email`, params: [list, d(now)] },
      { text: `update signups set play_added_at = $2, updated_at = $2 where ${ANDROID_WAITING} and google_email = any($1::text[]) returning id, google_email`, params: [list, d(now)] }
    ]);
    const hit = new Set(rows.concat(pool).map(r => r.google_email));
    return { marked: rows.length + pool.length, unmatched: list.filter(e => !hit.has(e)).length, androidInvite: pool.map(r => r.id) };
  }
  // Update emails go only to people who asked for them on the form AND confirmed by email.
  async announceRecipients() {
    return (await this.q(`select id, email_norm, name from signups where marketing_requested_at is not null and marketing_confirmed_at is not null order by created_at`, []))
      .map(r => ({ id: r.id, emailNorm: r.email_norm, name: r.name }));
  }

  // ── the token pool ──
  async addPoolTokens(list, now) {
    if (!list.length) return 0;
    const rows = await this.q(`insert into token_pool (id, token, not_after, created_at)
      select gen_random_uuid(), x.t, x.n, $3 from unnest($1::text[], $2::timestamptz[]) as x(t, n) on conflict (token) do nothing returning id`,
      [list.map(x => x.token), list.map(x => d(x.notAfter)), d(now)]);
    return rows.length;
  }
  async poolStatus(now, { maxAgeMs, minLeftMs, dayStart }) {
    const [x] = await this.q(`select count(*) filter (where issued_at is null and created_at >= $1 and not_after >= $2)::int as ready,
      count(*) filter (where issued_at is null and not (created_at >= $1 and not_after >= $2))::int as stale,
      count(*) filter (where issued_at >= $3)::int as issued_today from token_pool`, [d(now - maxAgeMs), d(now + minLeftMs), d(dayStart)]);
    return { ready: x.ready, stale: x.stale, issuedToday: x.issued_today };
  }
  // Hands the oldest usable token (earliest end date) to a sign-up that has none, under the daily cap: one
  // transaction behind an advisory lock, so two sign-ups never get the same token and the cap holds.
  async issuePoolToken(signupId, now, { maxAgeMs, minLeftMs, dayStart, dailyCap }) {
    const t = d(now);
    const [, rows] = await this.db.transaction([
      { text: 'select pg_advisory_xact_lock(424243)' },
      { text: `with s as (select id from signups where id = $1 and state = 'pending_email' and token_issued_at is null),
          pick as (select p.id from token_pool p where exists (select 1 from s) and p.issued_at is null and p.created_at >= $3 and p.not_after >= $4
            and (select count(*) from token_pool where issued_at >= $5) < $6 order by p.not_after, p.created_at limit 1 for update skip locked),
          upd as (update token_pool p set issued_at = $2, signup_id = $1 from pick where p.id = pick.id returning p.token)
        update signups set state = 'delivered', token_source = 'pool', token_issued_at = $2, approved_at = coalesce(approved_at, $2), updated_at = $2
        where id = $1 and exists (select 1 from upd) returning (select token from upd) as token`,
        params: [signupId, t, d(now - maxAgeMs), d(now + minLeftMs), d(dayStart), dailyCap] }
    ]);
    return rows[0] ? rows[0].token : null;
  }
  async poolTokenFor(signupId) { const r = await this.q('select token from token_pool where signup_id = $1 limit 1', [signupId]); return r[0] ? r[0].token : null; }
  async prunePool(now, { maxAgeMs, minLeftMs }) {
    return (await this.q('delete from token_pool where issued_at is null and (created_at < $1 or not_after < $2) returning id', [d(now - maxAgeMs), d(now + minLeftMs)])).length;
  }
  async markCopyEmailed(id, now) { return (await this.q('update signups set copy_emailed_at = $2 where id = $1 and copy_emailed_at is null returning id', [id, d(now)])).length > 0; }
  async markAndroidInvited(id, now) { return (await this.q('update signups set android_invited_at = $2 where id = $1 and android_invited_at is null returning id', [id, d(now)])).length > 0; }
  // A plain counter per UTC day, platform and target ('direct' | 'drive'): no IP, no sign-up, nothing personal.
  async countDownload({ platform, target }, now) {
    await this.q(`insert into download_counts (day, platform, target, count) values ($1::date, $2, $3, 1)
      on conflict (day, platform, target) do update set count = download_counts.count + 1`, [new Date(now).toISOString().slice(0, 10), platform, target]);
  }
  async downloadCounts() {
    return (await this.q(`select to_char(day, 'YYYY-MM-DD') as day, platform, target, count from download_counts order by day, platform, target`, []))
      .map(r => ({ day: r.day, platform: r.platform, target: r.target, count: Number(r.count) }));
  }

  async useNonce(nonce, now) { return (await this.q('insert into admin_nonces (nonce, seen_at) values ($1,$2) on conflict do nothing returning nonce', [nonce, d(now)])).length > 0; }

  async getSettings(defaultCap) {
    const cap = await this.q(`select value from settings where key = 'beta_cap'`, []);
    const rules = await this.q('select pattern, kind from access_rules order by pattern', []);
    return { betaCap: cap.length ? Number(cap[0].value) : defaultCap, allow: rules.filter(r => r.kind === 'allow').map(r => r.pattern), deny: rules.filter(r => r.kind === 'deny').map(r => r.pattern) };
  }
  async setSettings({ betaCap, allow, deny }) {
    const list = [];
    if (betaCap !== undefined) list.push({ text: `insert into settings (key, value) values ('beta_cap', $1) on conflict (key) do update set value = excluded.value`, params: [String(betaCap)] });
    for (const [kind, pats] of [['allow', allow], ['deny', deny]]) if (pats) {
      list.push({ text: 'delete from access_rules where kind = $1', params: [kind] });
      for (const p of [...new Set(pats)]) list.push({ text: 'insert into access_rules (pattern, kind) values ($1,$2)', params: [p, kind] });
    }
    if (list.length) await this.db.transaction(list);
  }

  async stats() {
    const signups = { pending_email: 0, approved: 0, play_added: 0, issued: 0, delivered: 0, waitlisted: 0, denied: 0, total: 0 };
    for (const r of await this.q('select state, count(*)::int as n from signups group by state', [])) { signups[r.state] = r.n; signups.total += r.n; }
    const [x] = await this.q(`select (select count(*)::int from downloads) as downloads, (select count(*)::int from outbox where sent_at is null) as outbox_pending,
      (select count(*)::int from signups where marketing_confirmed_at is not null) as marketing_confirmed,
      (select count(*)::int from roadmap_notify where confirmed_at is not null) as notify, (select count(*)::int from feedback) as feedback`, []);
    return { signups, downloads: x.downloads, outboxPending: x.outbox_pending, marketingConfirmed: x.marketing_confirmed, notify: x.notify, feedback: x.feedback };
  }
  async exportSignups() {
    const rows = await this.q(`select s.id, s.created_at, s.state, s.name, s.email, s.mac_chip, s.phone_model, s.marketing_confirmed_at, s.confirmed_at, s.approved_at, s.google_email, s.play_added_at,
      s.token_issued_at, s.token_emailed_at, (select count(*)::int from downloads d where d.signup_id = s.id) as downloads from signups s order by s.created_at`, []);
    return rows.map(camel);
  }
  async setState(id, state, now) {
    return (await this.q(`update signups set state = $2, updated_at = $3,
      approved_at = case when $2 = 'approved' then coalesce(approved_at, $3) else approved_at end,
      confirmed_at = case when $2 = 'approved' then coalesce(confirmed_at, $3) else confirmed_at end where id = $1 returning id`, [id, state, d(now)])).length > 0;
  }
  async deleteSignup(id) {
    const [, , rows] = await this.db.transaction([
      { text: 'delete from email_links where ref_id = $1', params: [id] },
      { text: 'delete from token_pool where signup_id = $1', params: [id] },
      { text: 'delete from signups where id = $1 returning id', params: [id] }
    ]);
    return rows.length;
  }
  // Delete-my-data by address: the sign-up (with everything linked to it), roadmap requests and feedback.
  async deleteByEmail(emailNorm) {
    const r = await this.db.transaction([
      { text: 'delete from email_links where ref_id in (select id from signups where email_norm = $1) or ref_id in (select id from roadmap_notify where email_norm = $1)', params: [emailNorm] },
      // The issued token's pool record goes with the row (the foreign key would cascade too; this says it plainly).
      { text: 'delete from token_pool where signup_id in (select id from signups where email_norm = $1)', params: [emailNorm] },
      { text: 'delete from signups where email_norm = $1 returning id', params: [emailNorm] },
      { text: 'delete from roadmap_notify where email_norm = $1 returning id', params: [emailNorm] },
      { text: 'delete from feedback where email = $1 returning id', params: [emailNorm] }
    ]);
    return { signups: r[2].length, notify: r[3].length, feedback: r[4].length };
  }
  // Stops every email list for an address: updates consent is withdrawn and roadmap requests are removed.
  async unsubscribe(emailNorm, now) {
    const r = await this.db.transaction([
      { text: `update signups set marketing_requested_at = null, marketing_confirmed_at = null, updated_at = $2
        where email_norm = $1 and (marketing_requested_at is not null or marketing_confirmed_at is not null) returning id`, params: [emailNorm, d(now)] },
      { text: 'delete from email_links where purpose = $2 and ref_id in (select id from roadmap_notify where email_norm = $1)', params: [emailNorm, 'roadmap_confirm'] },
      { text: 'delete from roadmap_notify where email_norm = $1 returning id', params: [emailNorm] }
    ]);
    return { updates: r[0].length, notify: r[2].length };
  }
  async promote(now, defaultCap) {
    const [, rows] = await this.db.transaction([
      { text: 'select pg_advisory_xact_lock(424242)' },
      { text: `update signups set state = 'approved', approved_at = $1, updated_at = $1 where id in (
          select id from signups where state = 'waitlisted' order by confirmed_at
          limit greatest(0, coalesce((select value::int from settings where key = 'beta_cap'), $2) - (select count(*) from signups where state in ${ALLOWED})))
        returning id`, params: [d(now), defaultCap] }
    ]);
    return rows.length;
  }
  async retention(now, { signupDays }) {
    const b = (days) => d(now - days * DAY);
    const r = await this.db.transaction([
      { text: `delete from email_links where ref_id in (select id from signups where (state = 'pending_email' and created_at < $1) or updated_at < $2)`, params: [b(7), b(signupDays)] },
      { text: `delete from signups where (state = 'pending_email' and created_at < $1) or updated_at < $2 returning id`, params: [b(7), b(signupDays)] },
      { text: `update signups set token = null where token is not null and token_issued_at < $1 returning id`, params: [b(46)] },
      { text: 'delete from email_links where expires_at < $1', params: [b(7)] },
      { text: 'delete from rate_limits where window_start < $1', params: [now - 2 * DAY] },
      { text: 'delete from admin_nonces where seen_at < $1', params: [b(1)] },
      { text: 'delete from outbox where (sent_at is not null and sent_at < $1) or created_at < $2', params: [b(7), b(30)] },
      { text: 'delete from downloads where created_at < $1', params: [b(180)] },
      { text: 'delete from download_counts where day < $1::date', params: [b(180).toISOString().slice(0, 10)] },
      { text: 'delete from token_pool where (issued_at is not null and issued_at < $1) or (issued_at is null and (created_at < $2 or not_after < $3))', params: [b(46), d(now - POOL_MAX_AGE_MS), d(now + POOL_MIN_LEFT_MS)] },
      { text: 'delete from roadmap_notify where (confirmed_at is null and created_at < $1) or confirmed_at < $2', params: [b(7), b(365)] },
      { text: 'delete from feedback where created_at < $1', params: [b(365)] }
    ]);
    return { signups: r[1].length, tokensCleared: r[2].length };
  }
}
