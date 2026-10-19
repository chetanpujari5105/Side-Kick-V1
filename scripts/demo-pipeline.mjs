// The whole beta pipeline on fake adapters, in one process, with a pass/fail table:
//   npm run demo
// signup → bot check → stored → confirm email → approval rule (cap, waitlist) → signer signs with a THROWAWAY
// Ed25519 key through the issuer interface → token email → download (nothing about the person logged); then the
// one-click flow (launch log Part 7): the signer fills the token pool, a sign-up gets "You're in" with a token at once,
// a repeat never sees it.
// No network, no accounts, nothing written outside a temp folder that is removed at the end.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { FakeBotCheck, FakeStorage, FakeClock } from '../server/fakes.mjs';
import { loadConfig } from '../server/config.mjs';
import { createLogger } from '../server/log.mjs';
import { runCycle, runPool, loadSignerConfig } from '../tools/signer/signer.mjs';
import { makeClient } from '../tools/lib/client.mjs';
import releases from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const O = 'https://sidekick-demo.example.test';
const rnd = (n) => crypto.randomBytes(n).toString('hex');
const env = { APP_ORIGIN: O, SESSION_SECRET: rnd(32), ADMIN_AUTH_SECRET: rnd(32), ADMIN_AUTH_SIGNER_SECRET: rnd(32), CRON_SECRET: rnd(16), BETA_CAP: '2' };
const clock = new FakeClock(Date.now());
const repo = new MemoryRepo(), bot = new FakeBotCheck(), storage = new FakeStorage(clock, 600), logs = [];
const app = createApp({ config: loadConfig(env), repo, botCheck: bot, storage, mailer: null, clock, log: createLogger(l => logs.push(l)), releases, roadmapIds: roadmap.ids });
const call = (method, p, { json, cookie, ip = '198.51.100.1' } = {}) => app.fetch(new Request(O + p, { method, redirect: 'manual',
  headers: { origin: O, 'x-real-ip': ip, ...(json ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(json) : undefined }));
const cookie = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
const linkFor = (to, p) => { const m = repo.debugOutbox().filter(x => x.toEmail === to && x.text.includes(O + p)).pop(); return m && m.text.match(new RegExp(p.replace(/\//g, '\\/') + '(?:\\?[a-z=]+)?#t=([A-Za-z0-9_-]+)'))[1]; };
const rows = [];
const step = (name, ok, note = '') => rows.push([ok ? 'PASS' : 'FAIL', name, note]);
const CAP = 'XXXX.DUMMY.TOKEN.XXXX';
const person = (name, email) => ({ name, email, macChip: 'apple', phoneModel: 'Pixel 8', googleEmail: email.split('@')[0] + '.play@gmail.com', privacyAccepted: true, marketingOptIn: email.toLowerCase().startsWith('asha'), captchaToken: CAP });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-demo-'));
try {
  bot.mode = 'fail';
  let r = await call('POST', '/api/get-sidekick', { json: person('Bot', 'bot@example.com') });
  step('bot check fails closed', r.status === 403 && repo.debugCount('signups') === 0, `HTTP ${r.status}`);
  bot.mode = 'pass';
  r = await call('POST', '/api/get-sidekick', { json: { ...person('', 'nope'), macChip: 'x64' } });
  step('validation: Handoff error strings', r.status === 400, Object.values((await r.json()).fieldErrors).join(' / ').slice(0, 70) + '…');

  const people = [['Asha Rao', 'asha@example.com'], ['Ben Ode', 'ben@example.com'], ['Cleo Park', 'cleo@example.com']];
  for (const [i, [n, e]] of people.entries()) r = await call('POST', '/api/get-sidekick', { json: person(n, e), ip: '198.51.100.' + (10 + i) });
  step('three signups stored before 200', r.status === 200 && repo.debugCount('signups') === 3, `${repo.debugCount('signups')} rows`);
  r = await call('POST', '/api/get-sidekick', { json: person('Asha Again', 'ASHA@example.com'), ip: '198.51.100.99' });
  step('same email again: 200, still 3 rows', r.status === 200 && repo.debugCount('signups') === 3);

  const stages = [];
  const sessions = {};
  for (const [, e] of people) {
    r = await call('POST', '/api/confirm-email', { json: { t: linkFor(e, '/api/confirm-email'), captchaToken: CAP } });
    stages.push((await r.json()).stage); sessions[e] = cookie(r);
  }
  step('confirm → approval rule (cap 2)', stages.join(',') === 'approved,approved,waitlisted', stages.join(', '));
  r = await call('GET', '/api/download/mac/arm64', { cookie: sessions['cleo@example.com'] });
  step('waitlisted person cannot download', r.status === 403);

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const keyFile = path.join(tmp, 'throwaway.pem');
  fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const cfg = { ...loadSignerConfig({}), issuer: path.join(ROOT, 'test/fixtures/fake-issuer.mjs'), keyFile, tokensDir: path.join(tmp, 'tokens') };
  const post = makeClient({ base: O, keyId: 'signer', secret: env.ADMIN_AUTH_SIGNER_SECRET, fetch: (u, o) => app.fetch(new Request(u, o)), now: () => clock.now() });
  const inbox = [];
  const admin = makeClient({ base: O, keyId: 'admin', secret: env.ADMIN_AUTH_SECRET, fetch: (u, o) => app.fetch(new Request(u, o)), now: () => clock.now() });
  let res = await runCycle({ cfg, post, mail: async (m) => inbox.push(m), log: () => {} });
  step('Play gate: approved is not enough for a token', res.issued === 0 && !inbox.some(m => m.kind === 'token' || m.kind === 'invite'), JSON.stringify(res));
  const pp = await admin('play-pending');
  step('play-pending: the two approved Google accounts, one per line', pp.csv === 'asha.play@gmail.com\nben.play@gmail.com\n', pp.csv.trim().split('\n').join(', '));
  const mk = await admin('play-mark-added', { googleEmails: pp.csv.trim().split('\n') });
  step('play-mark-added (after adding them in Play Console)', mk.marked === 2, `${mk.marked} marked`);
  res = await runCycle({ cfg, post, mail: async (m) => inbox.push(m), log: () => {} });
  step('signer: tokens issued and posted', res.issued === 2 && res.posted === 2, JSON.stringify(res));
  const invite = inbox.find(m => m.kind === 'invite' && m.to === 'asha@example.com');
  step('invitation: Play link and the three install steps; no checksum, no Drive, no token', invite && invite.text.includes(releases.android.playTestUrl) && invite.text.includes('INSTALL IN THREE STEPS') && !invite.text.includes(releases.mac.builds.arm64.sha256) && !/drive\.google/.test(invite.text) && !invite.text.includes('SIDEKICK-TRIAL-1.'));
  const { renderEmail } = await import('../server/email-html.mjs');
  const inviteHtml = renderEmail(invite).html;
  step('invitation (HTML): a Download for Mac button, three numbered steps, under 60 KB', /bgcolor="#C6FF33"[^>]*>\s*<a href="[^"]+\/download\/mac"[^>]*>Download for Mac</.test(inviteHtml) && (inviteHtml.match(/data-sk="step"/g) || []).length >= 3 && Buffer.byteLength(inviteHtml) < 61440);
  const tokenMail = inbox.find(m => m.kind === 'token' && m.to === 'asha@example.com');
  const tok = tokenMail.text.match(/SIDEKICK-TRIAL-1\.\S+/)[0];
  step('token email carries a token that verifies (throwaway key)', crypto.verify(null, Buffer.from(tok.split('.')[1]), publicKey, Buffer.from(tok.split('.')[2], 'base64url')));
  step('waitlist email sent, no token for the waitlisted person', inbox.some(m => m.kind === 'waitlist' && m.to === 'cleo@example.com') && !inbox.some(m => m.kind === 'token' && m.to === 'cleo@example.com'));

  step('token email: the token on its own line, no link', tokenMail.text.split('\n').includes(tok) && !/https?:/.test(tokenMail.text));
  r = await call('GET', '/download/mac');
  step('invitation: the Mac download is /download/mac (302), no access link', invite.text.includes(O + '/download/mac') && !invite.text.includes('/api/access') && r.status === 302, r.headers.get('location') || '');
  // An access link from an older email (the recovery page) still opens a session.
  const at = crypto.randomBytes(32).toString('base64url');
  await repo.createLink({ hash: crypto.createHash('sha256').update(at).digest('hex'), purpose: 'access', refId: (await repo.getSignupByEmail('asha@example.com')).id, expiresAt: clock.now() + 3600000, maxUses: 10 }, clock.now());
  r = await call('POST', '/api/access', { json: { t: at, captchaToken: CAP }, ip: '203.0.113.50' });
  const s = cookie(r);
  r = await call('GET', '/api/session', { cookie: s });
  step('access link → session (stage token_sent)', (await r.json()).session.stage === 'token_sent');
  r = await call('GET', '/api/download/mac/arm64', { cookie: s });
  const loc = r.headers.get('location');
  step('download: 302 to a signed link', r.status === 302 && storage.check(loc), new URL(loc).host + new URL(loc).pathname);
  clock.advance(601000);
  step('…which expires after 10 minutes', !storage.check(loc));
  step('download: nothing about the person is logged (launch log Part 14)', repo.debugCount('downloads') === 0);
  r = await call('GET', '/api/download/mac/x64', { cookie: s });
  step('no Intel build anywhere', r.status === 404);

  // Updates: Asha asked for them; she confirms by email, then one announcement and its one-use unsubscribe link.
  // (Sent emails are erased from the outbox, so the link comes from Asha's inbox.)
  const ut = (inbox.filter(m => m.to === 'asha@example.com').map(m => m.text).join('\n').match(/for=updates#t=([A-Za-z0-9_-]{43})/) || [])[1];
  await call('POST', '/api/confirm-email', { json: { t: ut, captchaToken: CAP }, ip: '203.0.113.51' });
  const dry = await admin('announce', { subject: 'Sidekick 2.0.2', body: 'A new build.', dryRun: true });
  step('announce --dry-run: counts only, opt-in and confirmed', dry.recipients === 1 && dry.queued === 0);
  await admin('announce', { subject: 'Sidekick 2.0.2', body: 'A new build.' });
  res = await runCycle({ cfg, post, mail: async (m) => inbox.push(m), log: () => {} });
  const upd = inbox.find(m => m.kind === 'announce');
  const unsub = upd && upd.text.match(/unsubscribe#t=([A-Za-z0-9_-]{43})/)[1];
  r = await call('POST', '/api/unsubscribe', { json: { t: unsub }, ip: '203.0.113.52' });
  const r2 = await call('POST', '/api/unsubscribe', { json: { t: unsub }, ip: '203.0.113.52' });
  step('unsubscribe link: works once, then 410', upd && upd.to === 'asha@example.com' && r.status === 200 && r2.status === 410 && (await admin('announce', { subject: 'x', body: 'y', dryRun: true })).recipients === 0);
  await admin('settings', { betaCap: 3 });
  const pr = await admin('promote');
  step('cap raised → waitlisted person promoted', pr.promoted === 1 && (await repo.getSignupByEmail('cleo@example.com')).state === 'approved');
  // The one-click flow: the signer fills the pool (same issuer, throwaway key, label "Sidekick beta"); a sign-up is in at once.
  const pcfg = { ...cfg, issuer: path.join(ROOT, 'test/fixtures/fake-issuer-trial.mjs'), poolLow: 3, poolMax: 5 };
  const pool = await runPool({ cfg: pcfg, post, log: () => {} });
  step('signer: pool filled below the low-water mark', pool.minted === 5 && pool.ready === 5, JSON.stringify(pool));
  await admin('settings', { betaCap: 10 });
  r = await call('POST', '/api/get-sidekick', { json: { name: 'Dev Mac', email: 'dev@example.com', privacyAccepted: true, captchaToken: CAP }, ip: '203.0.113.60' });
  const inst = await r.json();
  step('instant sign-up: "You\'re in" with a token, no confirmation email', inst.stage === 'in' && /^SIDEKICK-TRIAL-1\./.test(inst.token) && !repo.debugOutbox().some(m => m.toEmail === 'dev@example.com'), `stage ${inst.stage}, download ${inst.download && inst.download.url}`);
  const [, pl, sg] = (inst.token || '..').split('.');
  step('…its token verifies with the throwaway public key', !!pl && crypto.verify(null, Buffer.from('SIDEKICK-TRIAL-1.' + pl), publicKey, Buffer.from(sg, 'base64url')));
  r = await call('POST', '/api/get-sidekick', { json: { name: 'Not Dev', email: 'dev@example.com', privacyAccepted: true, captchaToken: CAP }, ip: '203.0.113.61' });
  const again = await r.text();
  step('repeat sign-up: "already", the token never shown again, a copy emailed', JSON.parse(again).stage === 'already' && !again.includes('SIDEKICK-TRIAL') && repo.debugOutbox().some(m => m.toEmail === 'dev@example.com' && m.kind === 'copy'));
  const st = await admin('stats');
  step('admin stats over HMAC', st.status === 200, `approved ${st.signups.approved}, delivered ${st.signups.delivered}, downloads ${st.downloads}`);
  const del = await admin('delete', { email: 'ben@example.com' });
  step('delete-my-data removes the person', del.deleted === 1 && !(await repo.getSignupByEmail('ben@example.com')));
  const leaks = logs.filter(l => /@example\.com|@gmail\.com|SIDEKICK-TRIAL|198\.51\.100|203\.0\.113/.test(l));
  step('no email, token or IP in any log line', leaks.length === 0, `${logs.length} log lines checked`);
} catch (e) {
  step('demo ran to the end', false, e.message);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const w = Math.max(...rows.map(r => r[1].length));
console.log('\nSidekick beta pipeline — fake adapters\n');
for (const [s, n, note] of rows) console.log(`${s}  ${n.padEnd(w)}  ${note}`);
const failed = rows.filter(r => r[0] === 'FAIL').length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
