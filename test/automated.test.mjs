// The automated-mode additions of 2026-10-15: static storage (the Beta page), the Google account email for the
// Play test list, the Play gate, the invitation and token emails, opt-in updates with one-use unsubscribe links,
// and the signer's sending budget. Every secret here is generated in memory for this run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, ORIGIN, fakeToken, throwaway } from './helpers.mjs';
import { StaticLinkStorage } from '../server/adapters.mjs';
import { loadConfig, adapterProblems } from '../server/config.mjs';
import { MSG } from '../server/validate.mjs';
import { runCycle, loadSignerConfig } from '../tools/signer/signer.mjs';
import { makeClient } from '../tools/lib/client.mjs';
import { sealSession } from '../server/session.mjs';
import releases from '../data/releases.json' with { type: 'json' };

const CAP = 'XXXX.DUMMY.TOKEN.XXXX';
const GATED = { env: { PLAY_GATE: 'on' } };
const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const fullEnv = (o = {}) => ({
  APP_ORIGIN: ORIGIN, SESSION_SECRET: throwaway(), DATABASE_URL: 'postgres://u@h/d', TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k',
  ADMIN_AUTH_SECRET: throwaway(), ADMIN_AUTH_SIGNER_SECRET: throwaway(), CRON_SECRET: throwaway(16), ...o
});

// Signs up, confirms and (by default) marks the Google account as added to the Play test list.
async function approved(h, email = 'alex@example.com', google = 'alex.rivera@gmail.com') {
  await h.signup({ email, googleEmail: google }, { ip: '198.51.100.' + (email.length % 200) });
  await h.confirm(email);
  return (await h.repo.getSignupByEmail(email)).id;
}

// ── (1) static storage ────────────────────────────────────────────────────────
test('STORAGE_PROVIDER=static needs no storage secret; the link is the Beta page address from config', async () => {
  const cfg = loadConfig(fullEnv({ STORAGE_PROVIDER: 'static' }));
  assert.deepEqual(cfg.problems, []);
  assert.deepEqual(adapterProblems(cfg), []);
  assert.equal(cfg.betaPageUrl, ORIGIN + '/Beta.dc.html', 'defaults to this site\'s Beta page');
  assert.equal(loadConfig(fullEnv({ STORAGE_PROVIDER: 'static', BETA_PAGE_URL: 'https://side.example.test/Beta.dc.html' })).betaPageUrl, 'https://side.example.test/Beta.dc.html');
  for (const bad of ['javascript:alert(1)', 'http://side.example.test/Beta.dc.html', 'https://x.test/a b', 'https://u:p@x.test/']) {
    assert.ok(loadConfig(fullEnv({ STORAGE_PROVIDER: 'static', BETA_PAGE_URL: bad })).problems.includes('BETA_PAGE_URL'), bad);
  }
  // github and r2 still need their own variables.
  assert.ok(adapterProblems(loadConfig(fullEnv({ STORAGE_PROVIDER: 'github' }))).includes('GITHUB_RELEASES_TOKEN'));
  assert.ok(adapterProblems(loadConfig(fullEnv({ STORAGE_PROVIDER: 'r2' }))).includes('R2_BUCKET'));
  const s = new StaticLinkStorage({ url: ORIGIN + '/Beta.dc.html' });
  assert.deepEqual(await s.signedUrl({ file: 'x.dmg' }), { url: ORIGIN + '/Beta.dc.html', expiresAt: null });
});

test('PLAY_GATE is on unless set to off; anything else is a configuration problem', () => {
  assert.equal(loadConfig(fullEnv()).playGate, true);
  assert.equal(loadConfig(fullEnv({ PLAY_GATE: 'on' })).playGate, true);
  assert.equal(loadConfig(fullEnv({ PLAY_GATE: 'off' })).playGate, false);
  assert.ok(loadConfig(fullEnv({ PLAY_GATE: 'maybe' })).problems.includes('PLAY_GATE'));
});

// ── (2) the Google account email ──────────────────────────────────────────────
test('signup requires the Google account email for Google Play, in the existing message style', async () => {
  const h = setup(GATED);
  const none = await h.signup({ googleEmail: undefined });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).fieldErrors.googleEmail, MSG.googleEmpty);
  const bad = await h.signup({ googleEmail: 'alex at gmail' });
  assert.equal((await bad.json()).fieldErrors.googleEmail, MSG.google);
  assert.match(MSG.googleEmpty, /^Enter /); assert.match(MSG.google, /^Enter /);
  const ok = await h.signup({ googleEmail: '  Alex.Rivera@Gmail.com ' });
  assert.equal(ok.status, 200);
  const s = await h.repo.getSignupByEmail('alex@example.com');
  assert.equal(s.googleEmail, 'alex.rivera@gmail.com', 'stored trimmed and lower-cased');
  assert.ok(s.privacyAcceptedAt instanceof Date, 'consent has a timestamp');
});

test('no-JavaScript form: the Google account field is there, and its error comes back in the page', async () => {
  const h = setup(GATED);
  const r = await h.call('POST', '/api/get-sidekick', { form: { name: 'Alex', email: 'alex@example.com', macChip: 'apple', phoneModel: 'Pixel 8', privacyAccepted: 'on' }, headers: { origin: ORIGIN, accept: 'text/html' } });
  assert.equal(r.status, 400);
  const page = await r.text();
  assert.ok(page.includes('name="googleEmail"'), 'the field is in the no-JS form');
  assert.ok(page.includes('id="f-google"'));
  assert.ok(page.includes(MSG.googleEmpty), 'its error is shown');
});

// ── (3) the Play gate state machine ───────────────────────────────────────────
test('Play gate (default): confirmed → approved → play-added → token issued → invitation delivered', async () => {
  const h = setup(GATED);
  const id = await approved(h);
  assert.equal((await h.repo.getSignup(id)).state, 'approved');
  // Approved but not on the Play test list yet: the signer gets nothing, and a token for this person is refused.
  const p0 = await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json();
  assert.deepEqual(p0.pending, [], 'no token before play-added');
  assert.equal((await h.admin('/api/admin/token', { signupId: id, token: fakeToken() }, { key: 'signer' })).status, 409, 'the gate holds even if the signer is asked');
  assert.equal(h.repo.debugOutbox().filter(m => ['invite', 'token'].includes(m.kind)).length, 0, 'no invitation before play-added');

  const pp = await (await h.admin('/api/admin/play-pending')).json();
  assert.equal(pp.csv, 'alex.rivera@gmail.com\n', 'CSV, one Google account per line');
  assert.equal(pp.count, 1);
  const mk = await (await h.admin('/api/admin/play-mark-added', { googleEmails: ['ALEX.RIVERA@gmail.com', 'stranger@gmail.com'] })).json();
  assert.deepEqual({ marked: mk.marked, unmatched: mk.unmatched }, { marked: 1, unmatched: 1 });
  const s1 = await h.repo.getSignup(id);
  assert.equal(s1.state, 'play_added');
  assert.ok(s1.playAddedAt instanceof Date);
  const after = await (await h.admin('/api/admin/play-pending')).json();
  assert.equal(after.csv, '', 'not listed twice');
  assert.equal(after.fullCsv, 'alex.rivera@gmail.com\n', 'the full list (a Play CSV upload replaces the list) still has them');

  const p1 = await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json();
  assert.equal(p1.pending.length, 1);
  const token = fakeToken();
  assert.equal((await h.admin('/api/admin/token', { signupId: id, token }, { key: 'signer' })).status, 200);
  assert.equal((await h.repo.getSignup(id)).state, 'issued');
  const ob = await (await h.admin('/api/admin/outbox', {}, { key: 'signer' })).json();
  const kinds = ob.messages.filter(m => m.to === 'alex@example.com').map(m => m.kind);
  assert.ok(kinds.includes('invite') && kinds.includes('token'), kinds.join());
  for (const m of ob.messages.filter(m => m.kind === 'invite')) await h.admin('/api/admin/outbox-ack', { id: m.id, ok: true }, { key: 'signer' });
  assert.equal((await h.repo.getSignup(id)).state, 'issued', 'not delivered until both emails are sent');
  for (const m of ob.messages.filter(m => m.kind !== 'invite')) await h.admin('/api/admin/outbox-ack', { id: m.id, ok: true }, { key: 'signer' });
  assert.equal((await h.repo.getSignup(id)).state, 'delivered');
  const st = await (await h.admin('/api/admin/stats')).json();
  assert.equal(st.signups.delivered, 1);
});

test('play-pending lists only approved people (not waitlisted, unconfirmed or already added); signer key cannot use it', async () => {
  const h = setup({ env: { PLAY_GATE: 'on', BETA_CAP: '1' } });
  await approved(h, 'a@example.com', 'a@gmail.com');
  await approved(h, 'b@example.com', 'b@gmail.com'); // over the cap: waitlisted
  await h.signup({ email: 'c@example.com', googleEmail: 'c@gmail.com' }, { ip: '192.0.2.9' }); // never confirmed
  assert.equal((await (await h.admin('/api/admin/play-pending')).json()).csv, 'a@gmail.com\n');
  assert.equal((await h.admin('/api/admin/play-pending', {}, { key: 'signer' })).status, 403);
  assert.equal((await h.admin('/api/admin/play-mark-added', { googleEmails: ['a@gmail.com'] }, { key: 'signer' })).status, 403);
  assert.equal((await h.admin('/api/admin/play-mark-added', { googleEmails: 'a@gmail.com' })).status, 400);
  // Marking a waitlisted person's account does not let them skip the queue.
  const mk = await (await h.admin('/api/admin/play-mark-added', { googleEmails: ['b@gmail.com'] })).json();
  assert.equal(mk.marked, 0);
  assert.equal((await h.repo.getSignupByEmail('b@example.com')).state, 'waitlisted');
});

test('PLAY_GATE=off: approved people go straight to the signer (the old flow)', async () => {
  const h = setup({ env: { PLAY_GATE: 'off' } });
  const id = await approved(h);
  const p = await (await h.admin('/api/admin/pending', {}, { key: 'signer' })).json();
  assert.equal(p.pending[0].signupId, id);
  assert.equal((await h.admin('/api/admin/token', { signupId: id, token: fakeToken() }, { key: 'signer' })).status, 200);
});

// ── (4) the invitation and token emails ───────────────────────────────────────
async function delivered(h) {
  const id = await approved(h);
  await h.admin('/api/admin/play-mark-added', { googleEmails: ['alex.rivera@gmail.com'] });
  const token = fakeToken();
  await h.admin('/api/admin/token', { signupId: id, token }, { key: 'signer' });
  const out = h.repo.debugOutbox().filter(m => m.toEmail === 'alex@example.com');
  return { id, token, invite: out.find(m => m.kind === 'invite'), tokenMail: out.find(m => m.kind === 'token') };
}

test('invitation email: Beta page, checksum, install steps, Play link and when it works, contact, removal; never the token', async () => {
  const h = setup({ env: { PLAY_GATE: 'on', STORAGE_PROVIDER: 'static' } });
  const { invite, token } = await delivered(h);
  const t = invite.text;
  assert.ok(t.includes(ORIGIN + '/Beta.dc.html'), 'the Beta page address');
  assert.ok(t.includes(releases.mac.builds.arm64.sha256), 'the SHA-256');
  assert.ok(t.includes(releases.mac.builds.arm64.file));
  assert.ok(releases.mac.installSteps.length >= 4);
  for (const step of releases.mac.installSteps) assert.ok(t.includes(step), 'install step: ' + step.slice(0, 40));
  assert.ok(t.includes(releases.android.playTestUrl), 'the Play test link');
  assert.match(t, /works only (once|after) we('ve| have) added your Google account/i);
  assert.ok(t.includes('alex.rivera@gmail.com'), 'names the Google account we added');
  assert.ok(t.includes('chetanpujari.sitit@gmail.com'), 'contact');
  assert.match(t, /remove/i, 'how to be removed');
  assert.ok(!t.includes(token) && !t.includes('SIDEKICK-TRIAL-1.'), 'the token is not in the invitation');
  assert.ok(!/\/api\/access/.test(t), 'static mode needs no download-page link');
  assert.ok(!/[\r]/.test(invite.subject + t) && !/\n/.test(invite.subject));
});

test('token email: the token alone on its own line, how to paste it, 45 days (Mac docs), contact, removal; no download link', async () => {
  const h = setup({ env: { PLAY_GATE: 'on', STORAGE_PROVIDER: 'static' } });
  const { tokenMail, token } = await delivered(h);
  const lines = tokenMail.text.split('\n');
  const i = lines.indexOf(token);
  assert.ok(i > 0, 'the token is a line by itself');
  assert.equal(lines[i - 1], ''); assert.equal(lines[i + 1], '', 'with a blank line either side');
  assert.equal(tokenMail.text.split(token).length, 2, 'exactly once');
  assert.match(tokenMail.text, /Paste token/);
  assert.match(tokenMail.text, /Settings › About › Beta access/);
  assert.match(tokenMail.text, /45 days/);
  assert.ok(!/https?:\/\//.test(tokenMail.text), 'no link of any kind: the token travels apart from the download');
  assert.match(tokenMail.text, /not the (download )?checksum|isn't the SHA-256|is not the SHA-256/i);
  assert.ok(tokenMail.text.includes('chetanpujari.sitit@gmail.com'));
  assert.match(tokenMail.text, /remove/i);
});

test('static storage: the download button sends an approved person to the Beta page', async () => {
  const h = setup({ env: { PLAY_GATE: 'on', STORAGE_PROVIDER: 'static' }, storage: new StaticLinkStorage({ url: ORIGIN + '/Beta.dc.html' }) });
  await delivered(h);
  const s = await h.repo.getSignupByEmail('alex@example.com');
  const c = 'sk_session=' + sealSession({ v: 1, k: 'email', sid: s.id, iat: Math.floor(h.clock.now() / 1000), exp: Math.floor(h.clock.now() / 1000) + 3600 }, h.env.SESSION_SECRET);
  const r = await h.call('GET', '/api/download/mac/arm64', { cookie: c });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), ORIGIN + '/Beta.dc.html');
});

// ── (5) updates: opt-in only, announce, one-use unsubscribe ────────────────────
async function people(h) {
  await h.signup({ email: 'yes@example.com', googleEmail: 'yes@gmail.com', marketingOptIn: true }, { ip: '192.0.2.1' });
  await h.signup({ email: 'unconfirmed@example.com', googleEmail: 'u@gmail.com', marketingOptIn: true }, { ip: '192.0.2.2' });
  await h.signup({ email: 'no@example.com', googleEmail: 'no@gmail.com', marketingOptIn: false }, { ip: '192.0.2.3' });
  const t = h.linkFrom('yes@example.com', '/api/confirm-email?for=updates') || (() => {
    const m = h.repo.debugOutbox().find(x => x.toEmail === 'yes@example.com').text.match(/confirm-email\?for=updates#t=([A-Za-z0-9_-]{43})/);
    return m && m[1];
  })();
  const r = await h.call('POST', '/api/confirm-email', { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } });
  assert.equal(r.status, 200, 'updates confirmed for yes@');
}

test('announce goes only to people who asked for updates AND confirmed by email; dry run sends nothing and prints counts', async () => {
  const h = setup(GATED);
  await people(h);
  const before = h.repo.debugOutbox().length;
  const dry = await (await h.admin('/api/admin/announce', { subject: 'Sidekick 2.0.2', body: 'Hello.\nNew build.', dryRun: true })).json();
  assert.deepEqual({ recipients: dry.recipients, queued: dry.queued }, { recipients: 1, queued: 0 });
  assert.equal(h.repo.debugOutbox().length, before, 'dry run queued nothing');
  assert.ok(!JSON.stringify(dry).includes('@'), 'counts only, no addresses');
  const real = await (await h.admin('/api/admin/announce', { subject: 'Sidekick 2.0.2', body: 'Hello.\nNew build.' })).json();
  assert.equal(real.queued, 1);
  const sent = h.repo.debugOutbox().filter(m => m.kind === 'announce');
  assert.deepEqual(sent.map(m => m.toEmail), ['yes@example.com'], 'opt-in only');
  assert.match(sent[0].text, /\/api\/unsubscribe#t=[A-Za-z0-9_-]{43}/, 'a personal unsubscribe link');
  assert.match(sent[0].text, /reply/i, '…and "reply to be removed"');
  assert.equal(sent[0].subject, 'Sidekick 2.0.2');
});

test('announce refuses unsafe input and the signer key', async () => {
  const h = setup(GATED);
  for (const bad of [{ subject: 'a\nBcc: x@example.com', body: 'b' }, { subject: '', body: 'b' }, { subject: 's', body: '' }, { subject: 'x'.repeat(200), body: 'b' }, { subject: 's', body: 'b'.repeat(10001) }]) {
    assert.equal((await h.admin('/api/admin/announce', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal((await h.admin('/api/admin/announce', { subject: 's', body: 'b', dryRun: true }, { key: 'signer' })).status, 403);
});

test('unsubscribe: GET is a page that changes nothing; POST once stops updates; reuse is 410; no human check needed', async () => {
  const h = setup(GATED);
  await people(h);
  await h.admin('/api/admin/announce', { subject: 'S', body: 'B' });
  const text = h.repo.debugOutbox().find(m => m.kind === 'announce').text;
  const t = text.match(/\/api\/unsubscribe#t=([A-Za-z0-9_-]{43})/)[1];
  // An unsubscribe token never opens a session or confirms anything on the other link routes.
  for (const route of ['/api/confirm-email', '/api/access']) {
    assert.equal((await h.call('POST', route, { json: { t, captchaToken: CAP }, headers: { origin: ORIGIN } })).status, 410, route);
  }
  const page = await h.call('GET', '/api/unsubscribe');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(!/turnstile|challenges\.cloudflare/i.test(html), 'no human check on the unsubscribe page');
  assert.match(html, /reply/i, 'the no-JS fallback: reply to be removed');
  assert.ok((await h.repo.getSignupByEmail('yes@example.com')).marketingConfirmedAt, 'GET changed nothing');
  assert.equal((await h.call('POST', '/api/unsubscribe', { json: { t }, headers: { origin: 'https://evil.example' } })).status, 403, 'other origins refused');
  h.botCheck.mode = 'fail';
  const ok = await h.call('POST', '/api/unsubscribe', { json: { t }, headers: { origin: ORIGIN } });
  assert.equal(ok.status, 200);
  assert.equal((await h.repo.getSignupByEmail('yes@example.com')).marketingConfirmedAt, null);
  assert.equal((await h.call('POST', '/api/unsubscribe', { json: { t }, headers: { origin: ORIGIN } })).status, 410, 'one use');
  assert.equal((await h.call('POST', '/api/unsubscribe', { form: { t }, headers: { origin: ORIGIN, accept: 'text/html' } })).status, 410);
  assert.equal((await (await h.admin('/api/admin/announce', { subject: 'S', body: 'B', dryRun: true })).json()).recipients, 0);
  // A confirm-email token cannot be used to unsubscribe, nor an unsubscribe token to confirm.
  h.botCheck.mode = 'pass';
  assert.equal((await h.signup({ email: 'z@example.com', googleEmail: 'z@gmail.com', marketingOptIn: true }, { ip: '192.0.2.77' })).status, 200);
  const zt = h.linkFrom('z@example.com');
  assert.match(zt, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await h.call('POST', '/api/unsubscribe', { json: { t: zt }, headers: { origin: ORIGIN } })).status, 410, 'a confirm token is not an unsubscribe token');
  assert.ok((await h.repo.getSignupByEmail('z@example.com')).marketingRequestedAt, 'and changed nothing');
});

test('signer: transactional emails first, then at most SK_MAIL_PER_HOUR per rolling hour; the log keeps times only', async () => {
  const h = setup(GATED);
  for (let i = 0; i < 4; i++) {
    await h.signup({ email: `p${i}@example.com`, googleEmail: `p${i}@gmail.com`, marketingOptIn: true }, { ip: '192.0.2.' + (20 + i) });
    const m = h.repo.debugOutbox().find(x => x.toEmail === `p${i}@example.com`).text.match(/for=updates#t=([A-Za-z0-9_-]{43})/);
    await h.call('POST', '/api/confirm-email', { json: { t: m[1], captchaToken: CAP }, headers: { origin: ORIGIN } });
  }
  await h.admin('/api/admin/announce', { subject: 'S', body: 'B' });
  await h.signup({ email: 'late@example.com', googleEmail: 'late@gmail.com' }, { ip: '192.0.2.99' }); // a confirm email, queued after the announcement
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-rate-test-')); dirs.push(dir);
  const cfg = { ...loadSignerConfig({}), tokensDir: path.join(dir, 'tokens'), stateDir: path.join(dir, 'state'), perHour: 3, perDay: 400 };
  const post = makeClient({ base: ORIGIN, keyId: 'signer', secret: h.env.ADMIN_AUTH_SIGNER_SECRET, fetch: (u, o) => h.app.fetch(new Request(u, o)), now: () => h.clock.now() });
  const sent = [];
  const mail = async (m) => { sent.push(m); };
  // Everything except the 4 announcements is transactional (signup confirmations, updates confirmations were used).
  const transactional = h.repo.debugOutbox().filter(m => !m.sentAt && m.kind !== 'announce').length;
  const r1 = await runCycle({ cfg: { ...cfg, perHour: transactional + 1 }, post, mail, now: () => h.clock.now(), log: () => {} });
  assert.equal(r1.mailed, transactional + 1);
  assert.ok(sent.slice(0, transactional).every(m => m.kind !== 'announce'), 'transactional first');
  assert.ok(sent.some(m => m.to === 'late@example.com'), 'a later confirm email jumps the announcement queue');
  const r2 = await runCycle({ cfg: { ...cfg, perHour: transactional + 1 }, post, mail, now: () => h.clock.now(), log: () => {} });
  assert.equal(r2.mailed, 0, 'hourly budget used up');
  assert.equal(r2.deferred, true);
  h.clock.advance(3600 * 1000 + 1);
  const r3 = await runCycle({ cfg: { ...cfg, perHour: 2 }, post, mail, now: () => h.clock.now(), log: () => {} });
  assert.equal(r3.mailed, 2);
  const logFile = path.join(cfg.stateDir, 'sent-times.json');
  const raw = fs.readFileSync(logFile, 'utf8');
  assert.ok(!raw.includes('@') && !raw.includes('Sidekick'), 'only times in the send log');
  assert.equal((fs.statSync(logFile).mode & 0o777).toString(8), '600');
  assert.equal(loadSignerConfig({}).perHour, 30, 'default 30 an hour');
});

// ── the admin CLI, end to end over HTTP (a local server around the in-memory API) ──
test('admin CLI: play-pending prints the new accounts and writes the full list (600); announce --dry-run prints counts only', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  const h = setup(GATED);
  await approved(h);
  await people(h);
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await h.app.fetch(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-admin-cli-')); dirs.push(dir);
  const secretFile = path.join(dir, 'admin.secret');
  fs.writeFileSync(secretFile, h.env.ADMIN_AUTH_SECRET + '\n', { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: dir, SK_API_BASE: `http://127.0.0.1:${server.address().port}`, SK_ADMIN_SECRET_FILE: secretFile };
  const run = (...args) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['tools/admin/admin.mjs', ...args], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), env });
    let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    c.on('close', code => resolve({ code, out }));
  });
  try {
    // The CLI signs with the real clock; keep the in-memory API on it for this test.
    h.clock.set(Date.now());
    const csv = path.join(dir, 'play.csv');
    const p = await run('play-pending', '--out', csv);
    assert.equal(p.code, 0, p.out);
    assert.match(p.out, /alex\.rivera@gmail\.com/);
    assert.match(p.out, /REPLACES the list/);
    assert.equal((fs.statSync(csv).mode & 0o777).toString(8), '600');
    assert.ok(fs.readFileSync(csv, 'utf8').split('\n').includes('alex.rivera@gmail.com'));
    const m = await run('play-mark-added', '--file', csv);
    assert.equal(m.code, 0, m.out);
    assert.equal((await h.repo.getSignupByEmail('alex@example.com')).state, 'play_added');
    const body = path.join(dir, 'update.txt'); fs.writeFileSync(body, 'Hello.\n');
    const d = await run('announce', '--subject', 'Test', '--body-file', body, '--dry-run');
    assert.equal(d.code, 0, d.out);
    assert.match(d.out, /Dry run: 1 subscriber/);
    assert.ok(!d.out.includes('@'), 'no addresses printed');
    assert.equal(h.repo.debugOutbox().filter(x => x.kind === 'announce').length, 0);
    fs.chmodSync(secretFile, 0o644);
    const loose = await run('stats');
    assert.notEqual(loose.code, 0, 'a secret file others can read is refused');
  } finally { server.close(); }
});

test('install steps: releases.json holds exactly the steps the Beta page showed before (its no-JS copy), in order', () => {
  const page = fs.readFileSync(new URL('../Beta.dc.html', import.meta.url), 'utf8');
  const esc = (t) => t.replace(/&/g, '&amp;');
  let at = 0;
  for (const step of releases.mac.installSteps) {
    const i = page.indexOf('<li>' + esc(step) + '</li>', at);
    assert.ok(i > 0, 'in the no-JS copy, in order: ' + step.slice(0, 50));
    at = i;
  }
});

test('Turnstile test keys: allowed on Preview (no hostname check), refused on Production', () => {
  const pre = loadConfig(fullEnv({ VERCEL_ENV: 'preview', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA', TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }));
  assert.deepEqual(pre.problems, []);
  assert.equal(pre.turnstileHostname, null);
  const prod = loadConfig(fullEnv({ VERCEL_ENV: 'production', TURNSTILE_SECRET: '1x0000000000000000000000000000000AA', TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }));
  assert.ok(prod.problems.includes('TURNSTILE_SECRET'));
  assert.ok(loadConfig(fullEnv({ VERCEL_ENV: 'production', TURNSTILE_SITE_KEY: '1x00000000000000000000AA' })).problems.includes('TURNSTILE_SITE_KEY'));
  const real = loadConfig(fullEnv({ VERCEL_ENV: 'production', TURNSTILE_SECRET: '0x4AAAAAAAreal-looking-secret', TURNSTILE_SITE_KEY: '0x4AAAAAAAsitekey' }));
  assert.equal(real.turnstileHostname, new URL(ORIGIN).hostname, 'real keys keep the hostname check');
});

test('admin migrate: owner key only, runs every schema on the real SQL (PGlite), idempotent', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PgRepo } = await import('../server/repo-pg.mjs');
  const pg = new PGlite();
  const repo = new PgRepo({ query: async (t, p = []) => (await pg.query(t, p)).rows, transaction: (l) => pg.transaction(async (tx) => { const o = []; for (const q of l) o.push((await tx.query(q.text, q.params || [])).rows); return o; }) });
  const schemas = ['schema.sql', 'schema-v2.sql'].map(f => fs.readFileSync(new URL('../server/' + f, import.meta.url), 'utf8'));
  const { createApp } = await import('../server/app.mjs');
  const h = setup(GATED);
  const app = createApp({ config: h.config, repo, botCheck: h.botCheck, storage: h.storage, clock: h.clock, log: { info() {}, warn() {}, error() {} }, releases, roadmapIds: [], schemas });
  const { signRequest } = await import('../server/crypto.mjs');
  const call = (key, secret) => { const body = '{}'; return app.fetch(new Request(ORIGIN + '/api/admin/migrate', { method: 'POST', body, headers: { 'content-type': 'application/json', ...signRequest({ keyId: key, secret, method: 'POST', path: '/api/admin/migrate', body, now: h.clock.now() }) } })); };
  assert.equal((await call('signer', h.env.ADMIN_AUTH_SIGNER_SECRET)).status, 403, 'the signer key cannot migrate');
  assert.equal((await call('admin', 'wrong-secret-wrong-secret-wrong-secret')).status, 401, 'a bad signature never reaches the database');
  // An empty database: no nonce table yet. Other admin calls fail there; migrate creates the tables.
  assert.equal((await call('admin', h.env.ADMIN_AUTH_SECRET).then(r => r)).status, 200);
  const r1 = await call('admin', h.env.ADMIN_AUTH_SECRET);
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).version, 2);
  assert.equal((await call('admin', h.env.ADMIN_AUTH_SECRET)).status, 200, 'twice is fine');
});

test('client: the Vercel protection-bypass header comes from a mode-600 file only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-bypass-')); dirs.push(dir);
  const f = path.join(dir, 'bypass'); fs.writeFileSync(f, 'bypass-value-for-test\n', { mode: 0o600 });
  const seen = [];
  const fake = async (u, o) => { seen.push(o.headers); return new Response('{"ok":true}', { status: 200 }); };
  process.env.SK_VERCEL_BYPASS_FILE = f;
  try {
    await makeClient({ base: ORIGIN, keyId: 'admin', secret: 'x'.repeat(64), fetch: fake })('stats');
    assert.equal(seen[0]['x-vercel-protection-bypass'], 'bypass-value-for-test');
    fs.chmodSync(f, 0o644);
    assert.throws(() => makeClient({ base: ORIGIN, keyId: 'admin', secret: 'x'.repeat(64), fetch: fake }), /chmod 600/);
  } finally { delete process.env.SK_VERCEL_BYPASS_FILE; }
  await makeClient({ base: ORIGIN, keyId: 'admin', secret: 'x'.repeat(64), fetch: fake })('stats');
  assert.equal(seen[1]['x-vercel-protection-bypass'], undefined, 'no header unless asked');
});

test('invitation (static storage): the Beta page AND the Drive folder itself, so the download works even if the Beta page does not', async () => {
  const h = setup({ env: { PLAY_GATE: 'on', STORAGE_PROVIDER: 'static' } });
  const { invite } = await delivered(h);
  const t = invite.text;
  assert.ok(t.includes(ORIGIN + '/Beta.dc.html'), 'Beta page');
  assert.ok(t.includes('\n' + releases.mac.betaDriveUrl + '\n'), 'the Drive folder link on its own line');
  assert.ok(t.indexOf(ORIGIN + '/Beta.dc.html') < t.indexOf(releases.mac.betaDriveUrl), 'Beta page first (it has the checks)');
  const { emails } = await import('../server/emails.mjs');
  const { betaDriveUrl: _d, ...macNoDrive } = releases.mac;
  const noDrive = emails.invite({ name: 'A', macUrl: ORIGIN + '/Beta.dc.html', macIsBetaPage: true, release: { ...releases, mac: macNoDrive }, googleEmail: 'a@gmail.com' }).text;
  assert.ok(!/undefined|drive\.google/.test(noDrive), 'no Drive line without a Drive link');
});

test('Download page (automated): Android is by invitation through Google Play testing, not "not available"', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../Download.dc.html', import.meta.url), 'utf8');
  assert.ok(page.includes('By invitation through Google Play testing.'), 'Android card');
  assert.ok(page.includes('The Android app is by invitation through Google Play testing: its link comes in your invitation email.'), 'intro line');
  assert.ok(page.includes('Install the Android app from the Google Play test link in your invitation email.'), 'step list');
  for (const old of ['Not available yet. When it is', "The Android app isn't available yet"]) assert.ok(!page.includes(old), 'still says: ' + old);
});
