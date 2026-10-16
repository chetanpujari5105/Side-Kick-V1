// Sidekick token signer — runs on the OWNER'S MAC only (never deployed: /tools is in .vercelignore).
//
// One cycle: ask the site which approved people need a token → run the Mac app's own issuer for each →
// post back only the finished token → send queued emails from the owner's own mailbox (Mail.app) → report.
// The private key is read by the issuer, never by this script, and never leaves the Mac.
//
//   node tools/signer/signer.mjs --once          one cycle (what launchd runs every 5 minutes)
//   node tools/signer/signer.mjs --check         check the configuration and stop
//   node tools/signer/signer.mjs --status        last successful run, failed runs in a row, queued counts, launchd job
//                                                (reads the log below and asks the site for counts; prints no secret)
//
// Network errors are retried once per request after 2 s (each request times out after 20 s). A failed run logs the
// cause code, the host and the time taken; the 6th failed run in a row adds one ATTENTION line to the log.
//
// Configuration (environment; secrets may instead live in the login Keychain):
//   SK_API_BASE         https://<project>.vercel.app
//   SK_SIGNER_SECRET    or Keychain item service "sidekick-signer-hmac" — same value as ADMIN_AUTH_SIGNER_SECRET on Vercel
//   SK_ISSUER           the app's issuer (default ~/Desktop/ConnectSuite/scripts/issue-trial-token.mjs)
//   SK_KEY_SOURCE       file (default) | keychain
//   SK_KEY_FILE         default ~/.sidekick-trial-key/private.pem      (file mode)
//   SK_KEY_SERVICE      default sidekick-trial-key                     (keychain mode: the PEM stored as the item's password)
//   SK_TOKENS_DIR       default ~/.sidekick-trial-key/tokens  — a copy of each token, named <signupId>.sidekick-token
//   SK_TOKEN_DAYS       default 45
//   SK_MAILER           mailapp (default) | eml (write .eml files to SK_EML_DIR for sending by hand) | none
//   SK_MAIL_FROM        optional sender address for Mail.app (must be one of the owner's Mail accounts)
//   SK_MAIL_PER_HOUR    default 30 — emails sent per rolling hour, all kinds; transactional ones go first
//   SK_MAIL_PER_DAY     default 400 — per rolling 24 hours, under Gmail's documented consumer limit (docs/OWNER-SETUP.md)
//   SK_STATE_DIR        default ~/Library/Application Support/sidekick-signer — sent-times.json (send times only, mode 600)
//   SK_LOG_FILE         default ~/Library/Logs/sidekick-signer.log — the launchd job's log, read by --status and failed runs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeClient, secretFrom, keychainSecret } from '../lib/client.mjs';
import { isTokenShaped, normaliseEmail } from '../../server/validate.mjs';

const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function loadSignerConfig(env = process.env) {
  return {
    base: env.SK_API_BASE,
    secret: env.SK_SIGNER_SECRET || null,
    issuer: env.SK_ISSUER || path.join(HOME, 'Desktop/ConnectSuite/scripts/issue-trial-token.mjs'),
    keySource: env.SK_KEY_SOURCE || 'file',
    keyFile: env.SK_KEY_FILE || path.join(HOME, '.sidekick-trial-key/private.pem'),
    keyService: env.SK_KEY_SERVICE || 'sidekick-trial-key',
    tokensDir: env.SK_TOKENS_DIR || path.join(HOME, '.sidekick-trial-key/tokens'),
    days: Number(env.SK_TOKEN_DAYS) > 0 ? String(Number(env.SK_TOKEN_DAYS)) : '45',
    mailer: env.SK_MAILER || 'mailapp',
    emlDir: env.SK_EML_DIR || path.join(HOME, 'Sidekick-outbox'),
    mailFrom: env.SK_MAIL_FROM || null,
    perHour: Number.isInteger(Number(env.SK_MAIL_PER_HOUR)) && Number(env.SK_MAIL_PER_HOUR) >= 0 && env.SK_MAIL_PER_HOUR !== undefined && env.SK_MAIL_PER_HOUR !== '' ? Number(env.SK_MAIL_PER_HOUR) : 30,
    perDay: Number.isInteger(Number(env.SK_MAIL_PER_DAY)) && Number(env.SK_MAIL_PER_DAY) >= 0 && env.SK_MAIL_PER_DAY !== undefined && env.SK_MAIL_PER_DAY !== '' ? Number(env.SK_MAIL_PER_DAY) : 400,
    // null: the budget is kept for this cycle only (tests, the demo). main() fills in the real folder.
    stateDir: env.SK_STATE_DIR || null
  };
}

// Runs the app's issuer. In file mode the issuer reads the key file itself. In keychain mode the PEM is
// handed to the issuer on file descriptor 3 (`--key /dev/fd/3`) and never touches the disk.
export function runIssuer(cfg, { label, outFile, pem = null }) {
  return new Promise((resolve, reject) => {
    const keyArg = cfg.keySource === 'keychain' ? '/dev/fd/3' : cfg.keyFile;
    const args = [cfg.issuer, '--key', keyArg, '--label', label, '--days', cfg.days, '--out', outFile];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe', cfg.keySource === 'keychain' ? 'pipe' : 'ignore'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    if (cfg.keySource === 'keychain') { child.stdio[3].end(pem); }
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`issuer exited ${code}${err ? ': ' + err.split('\n')[0].slice(0, 120).replace(/SIDEKICK-TRIAL-1\S*/g, '[token]') : ''}`)));
  });
}

function readTokenFile(file) {
  if (!fs.existsSync(file)) return null;
  const t = fs.readFileSync(file, 'utf8').trim();
  return isTokenShaped(t) ? t : null;
}

export function makeMailer(cfg, { exec = execFile } = {}) {
  if (cfg.mailer === 'none') return null;
  if (cfg.mailer === 'eml') {
    return async ({ id, to, subject, text }) => {
      fs.mkdirSync(cfg.emlDir, { recursive: true, mode: 0o700 });
      const eml = [`To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text.replace(/\r?\n/g, '\r\n')].join('\r\n');
      fs.writeFileSync(path.join(cfg.emlDir, `${id}.eml`), eml, { mode: 0o600, flag: 'wx' });
    };
  }
  const script = path.join(HERE, 'send-mail.applescript');
  return ({ to, subject, text }) => new Promise((resolve, reject) => {
    const args = [script, to, subject, text].concat(cfg.mailFrom ? [cfg.mailFrom] : []);
    exec('/usr/bin/osascript', args, { timeout: 60000 }, (e) => e ? reject(new Error('Mail.app send failed')) : resolve());
  });
}

// The sending budget: the times of emails sent in the last 24 hours, nothing else (no address, no subject).
const DAY_MS = 86400000, HOUR_MS = 3600000;
function readTimes(cfg, now) {
  if (!cfg.stateDir) return [];
  try { const a = JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'sent-times.json'), 'utf8')); return Array.isArray(a) ? a.filter(t => Number.isFinite(t) && t > now - DAY_MS) : []; }
  catch { return []; }
}
function writeTimes(cfg, times) {
  if (!cfg.stateDir) return;
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  const f = path.join(cfg.stateDir, 'sent-times.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(times), { mode: 0o600 });
  fs.renameSync(tmp, f);
  fs.chmodSync(f, 0o600);
}
export function mailBudget(cfg, times, now) {
  const lastHour = times.filter(t => t > now - HOUR_MS).length;
  return Math.max(0, Math.min(cfg.perHour - lastHour, cfg.perDay - times.length));
}

// One cycle. `post` is a signed admin client; `issue` and `mail` are injectable for tests.
export async function runCycle({ cfg, post, issue = (o) => runIssuer(cfg, o), mail, pem = null, log = console.log, now = () => Date.now() }) {
  const out = { issued: 0, reused: 0, posted: 0, failed: 0, mailed: 0, mailFailed: 0, deferred: false };
  const pending = await post('pending');
  if (pending.status !== 200) throw new Error(`pending: HTTP ${pending.status}`);
  if (pending.pending.length) fs.mkdirSync(cfg.tokensDir, { recursive: true, mode: 0o700 });
  for (const p of pending.pending) {
    if (!UUID.test(p.signupId)) { out.failed++; continue; }
    const file = path.join(cfg.tokensDir, `${p.signupId}.sidekick-token`);
    try {
      let token = readTokenFile(file);
      if (token) out.reused++;
      else {
        await issue({ label: p.label, outFile: file, pem });
        token = readTokenFile(file);
        if (!token) throw new Error('the issuer wrote no token');
        fs.chmodSync(file, 0o600);
        out.issued++;
      }
      const r = await post('token', { signupId: p.signupId, token });
      if (r.status === 200 || r.status === 409) out.posted++;
      else { out.failed++; log(`token for ${p.signupId}: HTTP ${r.status}`); }
    } catch (e) { out.failed++; log(`token for ${p.signupId}: ${e.message}`); }
  }
  if (mail) {
    const times = readTimes(cfg, now());
    const budget = mailBudget(cfg, times, now());
    if (budget === 0) { out.deferred = true; return out; }
    // The server hands out transactional emails first, announcements after, and never more than we may send.
    const ob = await post('outbox', { max: Math.min(20, budget) });
    if (ob.status !== 200) throw new Error(`outbox: HTTP ${ob.status}`);
    for (const m of ob.messages) {
      if (!normaliseEmail(m.to) || /[\r\n]/.test(m.subject)) { await post('outbox-ack', { id: m.id, ok: false, errorCode: 'bad-address' }); out.mailFailed++; continue; }
      try {
        await mail(m);
        times.push(now()); writeTimes(cfg, times);
        await post('outbox-ack', { id: m.id, ok: true }); out.mailed++;
      }
      catch (e) { await post('outbox-ack', { id: m.id, ok: false, errorCode: 'send-failed' }); out.mailFailed++; log(`email ${m.id} (${m.kind}): ${e.message}`); }
    }
    out.deferred = mailBudget(cfg, times, now()) === 0;
  }
  return out;
}

// The signer's client: one retry on a network error (its actions are safe to repeat; see tools/lib/client.mjs).
export const signerClient = (cfg, deps = {}) => makeClient({ base: cfg.base, keyId: 'signer', secret: cfg.secret, retries: 1, retryDelayMs: 2000, ...deps });

// Reads the job's log: one "signer: {…}" line per good run, one "signer failed: …" line per failed run.
export function parseSignerLog(text) {
  const out = { lastOk: null, lastRun: null, lastRunOk: null, consecutiveFailed: 0, runs: 0 };
  for (const line of String(text || '').split('\n')) {
    const ok = line.match(/^(\S+) signer: \{/), bad = !ok && line.match(/^(\S+) signer failed:/);
    if (ok) { out.runs++; out.lastOk = out.lastRun = ok[1]; out.lastRunOk = true; out.consecutiveFailed = 0; }
    else if (bad) { out.runs++; out.lastRun = bad[1]; out.lastRunOk = false; out.consecutiveFailed++; }
  }
  return out;
}

const ATTENTION_AT = 6;
export function failureLines(e, { previousFailed, runMs, iso }) {
  const lines = [`${iso} signer failed: ${e.message} (run ${runMs} ms)`];
  if (previousFailed + 1 === ATTENTION_AT) lines.push(`${iso} ATTENTION: ${ATTENTION_AT} signer runs in a row have failed (last: ${e.code || 'error'}). Nothing can be sent until a run succeeds. Check that this Mac is awake and online; see docs/OWNER-SETUP.md (Signer status).`);
  return lines;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function formatStatus({ now, host, log, launchd, queue }) {
  const ago = (iso) => `${Math.max(0, Math.round((now - Date.parse(iso)) / 60000))} min ago`;
  return [
    `Sidekick signer status at ${new Date(now).toISOString()}`,
    launchd.loaded ? `launchd job com.sidekick.signer: loaded (runs ${launchd.runs ?? '?'}, last exit code ${launchd.lastExit ?? '?'})` : 'launchd job com.sidekick.signer: NOT loaded',
    log.lastRun ? `last run: ${log.lastRun} (${log.lastRunOk ? 'ok' : 'failed'})` : 'last run: none in the log',
    log.lastOk ? `last successful run: ${log.lastOk} (${ago(log.lastOk)})` : 'last successful run: never',
    `consecutive failed runs: ${log.consecutiveFailed}${log.consecutiveFailed >= ATTENTION_AT ? ' — ATTENTION: check that this Mac is awake and online' : ''}`,
    queue.ok ? `queue on ${host}: ${plural(queue.outboxQueued, 'email', 'emails')} waiting to send, ${plural(queue.awaitingToken, 'token', 'tokens')} to issue, ${queue.awaitingPlayList} waiting for the Play list`
      : `queue on ${host}: unavailable (${queue.code || 'error'})`
  ];
}

const LABEL = 'com.sidekick.signer';
function launchdStatus() {
  try {
    const t = execFileSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { loaded: true, runs: Number((t.match(/\n\s*runs = (\d+)/) || [])[1]) || 0, lastExit: (t.match(/\n\s*last exit code = ([^\n]+)/) || [])[1] || '?' };
  } catch { return { loaded: false }; }
}
const logFile = () => process.env.SK_LOG_FILE || path.join(HOME, 'Library/Logs/sidekick-signer.log');
const readLog = () => { try { return fs.readFileSync(logFile(), 'utf8'); } catch { return ''; } };

async function status(cfg) {
  let queue = { ok: false, code: 'NO_CONFIG' }, host = '(SK_API_BASE not set)';
  if (cfg.base) {
    try {
      host = new URL(cfg.base).host;
      if (!cfg.secret) queue = { ok: false, code: 'NO_SECRET' };
      else {
        const r = await signerClient(cfg)('queue');
        queue = r.status === 200 ? { ok: true, outboxQueued: r.outboxQueued, awaitingToken: r.awaitingToken, awaitingPlayList: r.awaitingPlayList } : { ok: false, code: `HTTP ${r.status}` };
      }
    } catch (e) { queue = { ok: false, code: e.code || 'error' }; }
  }
  console.log(formatStatus({ now: Date.now(), host, log: parseSignerLog(readLog()), launchd: launchdStatus(), queue }).join('\n'));
}

const STARTED = Date.now();
async function main() {
  const cfg = loadSignerConfig();
  cfg.stateDir = cfg.stateDir || path.join(HOME, 'Library/Application Support/sidekick-signer');
  cfg.secret = cfg.secret || secretFrom('SK_SIGNER_SECRET', 'sidekick-signer-hmac');
  if (process.argv.includes('--status')) return status(cfg);
  const problems = [];
  if (!cfg.base) problems.push('SK_API_BASE is not set');
  if (!cfg.secret) problems.push('no signer secret (SK_SIGNER_SECRET or Keychain item "sidekick-signer-hmac")');
  if (!fs.existsSync(cfg.issuer)) problems.push(`issuer not found at ${cfg.issuer}`);
  let pem = null;
  if (cfg.keySource === 'keychain') { pem = keychainSecret(cfg.keyService); if (!pem || !pem.includes('PRIVATE KEY')) problems.push(`no PEM in Keychain item "${cfg.keyService}"`); }
  else if (!fs.existsSync(cfg.keyFile)) problems.push(`key file not found at ${cfg.keyFile}`);
  if (problems.length) { console.error('Signer not ready:\n- ' + problems.join('\n- ')); process.exit(2); }
  if (process.argv.includes('--check')) { console.log('Signer configuration looks complete (nothing was sent).'); return; }
  const post = signerClient(cfg);
  const r = await runCycle({ cfg, post, mail: makeMailer(cfg), pem });
  console.log(`${new Date().toISOString()} signer: ${JSON.stringify(r)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => {
    const previousFailed = parseSignerLog(readLog()).consecutiveFailed;
    for (const line of failureLines(e, { previousFailed, runMs: Date.now() - STARTED, iso: new Date().toISOString() })) console.error(line);
    process.exit(1);
  });
}
