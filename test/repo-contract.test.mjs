// One behaviour contract, run against the pure-JS MemoryRepo and against PgRepo on PGlite (real Postgres SQL,
// in memory, no network). PgRepo is what runs on Neon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { PgRepo } from '../server/repo-pg.mjs';

const SCHEMA = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
const T = Date.parse('2026-10-15T10:00:00Z');
const H = 3600000, DAY = 24 * H;

export async function pgliteRepo() {
  const pg = new PGlite();
  const db = {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    transaction: (list) => pg.transaction(async (tx) => { const out = []; for (const q of list) out.push((await tx.query(q.text, q.params || [])).rows); return out; })
  };
  const repo = new PgRepo(db);
  await repo.migrate(SCHEMA);
  await repo.migrate(SCHEMA); // idempotent
  return repo;
}

const person = (email, o = {}) => ({ email, emailNorm: email.toLowerCase(), name: 'Pat ' + email.split('@')[0], macChip: 'apple', phoneModel: 'Pixel 8', marketingOptIn: false, ...o });

for (const [name, make] of [['MemoryRepo', async () => new MemoryRepo()], ['PgRepo on PGlite', pgliteRepo]]) {
  test(`${name}: signup upsert is idempotent and never overwrites`, async () => {
    const r = await make();
    const a = await r.upsertSignup(person('a@example.com', { marketingOptIn: true }), T);
    const b = await r.upsertSignup(person('a@example.com', { name: 'Changed' }), T + 1000);
    assert.equal(a.created, true); assert.equal(b.created, false);
    assert.equal(b.signup.id, a.signup.id);
    assert.equal(b.signup.name, 'Pat a');
    assert.equal(b.signup.state, 'pending_email');
    assert.ok(b.signup.marketingRequestedAt instanceof Date);
    assert.equal(b.signup.marketingConfirmedAt, null);
    assert.equal(await r.getSignupByEmail('nobody@example.com'), null);
  });

  test(`${name}: links are single use or capped, and expire`, async () => {
    const r = await make();
    const { signup } = await r.upsertSignup(person('l@example.com'), T);
    await r.createLink({ hash: 'h1', purpose: 'signup_confirm', refId: signup.id, expiresAt: T + H, maxUses: 1 }, T);
    await r.createLink({ hash: 'h2', purpose: 'access', refId: signup.id, expiresAt: T + H, maxUses: 2 }, T);
    assert.ok(await r.peekLink('h1', T));
    assert.equal((await r.useLink('h1', T)).refId, signup.id);
    assert.equal(await r.useLink('h1', T), null);
    assert.ok(await r.useLink('h2', T)); assert.ok(await r.useLink('h2', T)); assert.equal(await r.useLink('h2', T), null);
    await r.createLink({ hash: 'h3', purpose: 'access', refId: signup.id, expiresAt: T + H, maxUses: 5 }, T);
    assert.equal(await r.useLink('h3', T + H), null, 'expired');
    assert.equal(await r.useLink('nope', T), null);
  });

  test(`${name}: approval cap, allow/deny, promote`, async () => {
    const r = await make();
    await r.setSettings({ betaCap: 1, allow: ['@vip.example'], deny: ['bad@example.com'] });
    const ids = {};
    for (const e of ['one@example.com', 'two@example.com', 'x@vip.example', 'bad@example.com']) ids[e] = (await r.upsertSignup(person(e), T)).signup.id;
    assert.equal(await r.confirmSignup(ids['one@example.com'], T + 1, 25), 'approved');
    assert.equal(await r.confirmSignup(ids['two@example.com'], T + 2, 25), 'waitlisted');
    assert.equal(await r.confirmSignup(ids['x@vip.example'], T + 3, 25), 'approved');
    assert.equal(await r.confirmSignup(ids['bad@example.com'], T + 4, 25), 'denied');
    assert.equal(await r.confirmSignup(ids['one@example.com'], T + 5, 25), 'approved', 'idempotent');
    assert.deepEqual(await r.getSettings(25), { betaCap: 1, allow: ['@vip.example'], deny: ['bad@example.com'] });
    assert.equal(await r.promote(T + 6, 25), 0);
    await r.setSettings({ betaCap: 5 });
    assert.equal(await r.promote(T + 7, 25), 1);
    assert.equal((await r.getSignup(ids['two@example.com'])).state, 'approved');
    assert.equal((await r.getSignup(ids['bad@example.com'])).state, 'denied');
    assert.equal((await r.getSignup(ids['one@example.com'])).approvedAt.getTime(), T + 1);
  });

  test(`${name}: rate-limit windows count and reset`, async () => {
    const r = await make();
    assert.equal(await r.hit('b', 1000), 1);
    assert.equal(await r.hit('b', 1000), 2);
    assert.equal(await r.hit('c', 1000), 1);
    assert.equal(await r.hit('b', 2000), 1, 'new window');
  });

  test(`${name}: signer claim, token once, outbox delivery erases text`, async () => {
    const r = await make();
    const id = (await r.upsertSignup(person('s@example.com'), T)).signup.id;
    await r.confirmSignup(id, T, 25);
    const c1 = await r.claimPending(T, 10, 15 * 60000);
    assert.deepEqual(c1, [{ id, name: 'Pat s' }]);
    assert.deepEqual(await r.claimPending(T + 1000, 10, 15 * 60000), []);
    assert.equal((await r.claimPending(T + 16 * 60000, 10, 15 * 60000)).length, 1);
    assert.equal(await r.storeToken(id, 'TOKEN-A', T), 'ok');
    assert.equal(await r.storeToken(id, 'TOKEN-B', T), 'conflict');
    assert.equal(await r.storeToken('00000000-0000-4000-8000-000000000000', 'X', T), 'not_found');
    assert.equal((await r.getSignup(id)).token, 'TOKEN-A');
    const mid = await r.enqueue({ signupId: id, kind: 'token', toEmail: 's@example.com', subject: 'S', text: 'body TOKEN-A' }, T);
    const got = await r.claimOutbox(T, 20, 15 * 60000);
    assert.equal(got.length, 1); assert.equal(got[0].text, 'body TOKEN-A'); assert.equal(got[0].toEmail, 's@example.com');
    assert.deepEqual(await r.claimOutbox(T, 20, 15 * 60000), [], 'claimed');
    assert.equal(await r.ackOutbox(mid, false, 'smtp', T), true);
    assert.equal((await r.claimOutbox(T, 20, 15 * 60000)).length, 1, 'a failed send is retried');
    assert.equal(await r.ackOutbox(mid, true, null, T + 5), true);
    assert.equal(await r.ackOutbox(mid, true, null, T + 6), false, 'only once');
    const s = await r.getSignup(id);
    assert.equal(s.state, 'delivered'); assert.equal(s.tokenEmailedAt.getTime(), T + 5);
    assert.deepEqual(await r.claimOutbox(T + DAY, 20, 15 * 60000), []);
  });

  test(`${name}: notify, feedback, nonces, stats, export, delete cascades, retention`, async () => {
    const r = await make();
    const n1 = await r.addNotify({ email: 'n@example.com', featureId: 'f1' }, T);
    const n2 = await r.addNotify({ email: 'n@example.com', featureId: 'f1' }, T);
    assert.equal(n1.created, true); assert.equal(n2.created, false); assert.equal(n2.row.id, n1.row.id);
    assert.equal(await r.confirmNotify(n1.row.id, T), true);
    await r.addFeedback({ message: 'hello', email: null }, T);
    assert.equal(await r.useNonce('n1', T), true); assert.equal(await r.useNonce('n1', T), false);
    const id = (await r.upsertSignup(person('d@example.com'), T)).signup.id;
    await r.confirmSignup(id, T, 25);
    await r.logDownload({ signupId: id, platform: 'mac', arch: 'arm64' }, T);
    await r.enqueue({ signupId: id, kind: 'access', toEmail: 'd@example.com', subject: 'S', text: 'x' }, T);
    await r.createLink({ hash: 'dl', purpose: 'access', refId: id, expiresAt: T + H, maxUses: 3 }, T);
    const st = await r.stats();
    assert.equal(st.signups.approved, 1); assert.equal(st.downloads, 1); assert.equal(st.notify, 1); assert.equal(st.feedback, 1); assert.equal(st.outboxPending, 1);
    const ex = await r.exportSignups();
    assert.equal(ex.length, 1); assert.equal(ex[0].downloads, 1); assert.equal(ex[0].token, undefined);
    assert.equal(await r.setState(id, 'waitlisted', T), true);
    assert.equal(await r.deleteSignup(id), 1);
    assert.equal(await r.deleteSignup(id), 0);
    assert.equal(await r.peekLink('dl', T), null, 'links go with the person');
    assert.equal((await r.stats()).downloads, 0);
    assert.equal((await r.stats()).outboxPending, 0);
    // retention
    const old = (await r.upsertSignup(person('old@example.com'), T)).signup.id;
    const kept = (await r.upsertSignup(person('kept@example.com'), T)).signup.id;
    await r.confirmSignup(kept, T, 25);
    await r.storeToken(kept, 'TOK', T);
    const res = await r.retention(T + 47 * DAY, { signupDays: 365 });
    assert.equal(res.signups, 1); assert.equal(res.tokensCleared, 1);
    assert.equal(await r.getSignup(old), null);
    assert.equal((await r.getSignup(kept)).token, null);
    assert.equal((await r.stats()).notify, 1, 'confirmed notify kept');
  });

  test(`${name}: delete-my-data by email also removes roadmap requests and feedback; unsubscribe stops every email list`, async () => {
    const r = await make();
    const id = (await r.upsertSignup(person('e@example.com', { marketingOptIn: true }), T)).signup.id;
    await r.confirmMarketing(id, T);
    const n = await r.addNotify({ email: 'e@example.com', featureId: 'f1' }, T);
    await r.confirmNotify(n.row.id, T);
    await r.addNotify({ email: 'other@example.com', featureId: 'f1' }, T);
    await r.addFeedback({ message: 'from e', email: 'e@example.com' }, T);
    await r.addFeedback({ message: 'anonymous', email: null }, T);
    const u = await r.unsubscribe('e@example.com', T + 1000);
    assert.deepEqual(u, { updates: 1, notify: 1 });
    assert.equal((await r.getSignup(id)).marketingConfirmedAt, null);
    assert.equal((await r.getSignup(id)).marketingRequestedAt, null);
    assert.deepEqual(await r.unsubscribe('e@example.com', T + 2000), { updates: 0, notify: 0 }, 'second time changes nothing');
    await r.addNotify({ email: 'e@example.com', featureId: 'f2' }, T);
    const d = await r.deleteByEmail('e@example.com');
    assert.deepEqual(d, { signups: 1, notify: 1, feedback: 1 });
    assert.equal(await r.getSignup(id), null);
    const st = await r.stats();
    assert.equal(st.feedback, 1, 'anonymous feedback stays');
    assert.equal(st.signups.total, 0);
    assert.deepEqual(await r.deleteByEmail('e@example.com'), { signups: 0, notify: 0, feedback: 0 });
    // A confirmed roadmap request is kept a year after it last changed, then removed.
    const k = await r.addNotify({ email: 'k@example.com', featureId: 'f1' }, T);
    await r.confirmNotify(k.row.id, T);
    await r.retention(T + 364 * DAY, { signupDays: 365 });
    assert.equal((await r.stats()).notify, 1);
    await r.retention(T + 366 * DAY, { signupDays: 365 });
    assert.equal((await r.stats()).notify, 0);
  });
}
