// The whole beta pipeline on fake adapters, in one process, with a pass/fail table:
//   npm run demo
// signup → bot check → stored → confirm email → approval rule (cap, waitlist) → signer signs with a THROWAWAY
// Ed25519 key through the issuer interface → token email → access link → session → download 302 → logged.
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
import { runCycle, loadSignerConfig } from '../tools/signer/signer.mjs';
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
const person = (name, email) => ({ name, email, macChip: 'apple', phoneModel: 'Pixel 8', privacyAccepted: true, marketingOptIn: false, captchaToken: CAP });

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
  const res = await runCycle({ cfg, post, mail: async (m) => inbox.push(m), log: () => {} });
  step('signer: tokens issued and posted', res.issued === 2 && res.posted === 2, JSON.stringify(res));
  const tokenMail = inbox.find(m => m.kind === 'token' && m.to === 'asha@example.com');
  const tok = tokenMail.text.match(/SIDEKICK-TRIAL-1\.\S+/)[0];
  step('token email carries a token that verifies (throwaway key)', crypto.verify(null, Buffer.from(tok.split('.')[1]), publicKey, Buffer.from(tok.split('.')[2], 'base64url')));
  step('waitlist email sent, no token for the waitlisted person', inbox.some(m => m.kind === 'waitlist' && m.to === 'cleo@example.com') && !inbox.some(m => m.kind === 'token' && m.to === 'cleo@example.com'));

  const at = tokenMail.text.match(/access#t=([A-Za-z0-9_-]+)/)[1];
  r = await call('POST', '/api/access', { json: { t: at, captchaToken: CAP }, ip: '203.0.113.50' });
  const s = cookie(r);
  r = await call('GET', '/api/session', { cookie: s });
  step('access link → session (stage token_sent)', (await r.json()).session.stage === 'token_sent');
  r = await call('GET', '/api/download/mac/arm64', { cookie: s });
  const loc = r.headers.get('location');
  step('download: 302 to a signed link', r.status === 302 && storage.check(loc), new URL(loc).host + new URL(loc).pathname);
  clock.advance(601000);
  step('…which expires after 10 minutes', !storage.check(loc));
  step('download logged {signupId, platform, arch, ts}', repo.debugAll('downloads').length === 1 && repo.debugAll('downloads')[0].arch === 'arm64');
  r = await call('GET', '/api/download/mac/x64', { cookie: s });
  step('no Intel build anywhere', r.status === 404);

  const admin = makeClient({ base: O, keyId: 'admin', secret: env.ADMIN_AUTH_SECRET, fetch: (u, o) => app.fetch(new Request(u, o)), now: () => clock.now() });
  await admin('settings', { betaCap: 3 });
  const pr = await admin('promote');
  step('cap raised → waitlisted person promoted', pr.promoted === 1 && (await repo.getSignupByEmail('cleo@example.com')).state === 'approved');
  const st = await admin('stats');
  step('admin stats over HMAC', st.status === 200, `approved ${st.signups.approved}, delivered ${st.signups.delivered}, downloads ${st.downloads}`);
  const del = await admin('delete', { email: 'ben@example.com' });
  step('delete-my-data removes the person', del.deleted === 1 && !(await repo.getSignupByEmail('ben@example.com')));
  const leaks = logs.filter(l => /@example\.com|SIDEKICK-TRIAL|198\.51\.100|203\.0\.113/.test(l));
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
