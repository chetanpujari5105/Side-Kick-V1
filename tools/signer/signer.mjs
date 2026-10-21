// Sidekick token signer — runs on the OWNER'S MAC only (never deployed: /tools is in .vercelignore).
//
// One cycle: ask the site which approved people need a token → run the Mac app's own issuer for each →
// post back only the finished token → send queued emails from the owner's own mailbox → report. Emails go out as
// branded HTML + plain text through Gmail SMTP when the app password file is there (launch log Part 11), otherwise as
// plain text through Mail.app, exactly as before.
// Then the token pool (launch log Part 7): discard pool tokens too old to give 35 days, and when fewer than the
// low-water mark are ready, mint up to the max with the same issuer (label "Sidekick beta") and upload only the
// token strings. With SK_ANDROID_ACCESS=google-group it also adds waiting Google accounts to the Google Group.
// The private key is read by the issuer, never by this script, and never leaves the Mac.
//
//   node tools/signer/signer.mjs --once          one cycle (what launchd runs every 5 minutes)
//   node tools/signer/signer.mjs --check         check the configuration and stop
//   node tools/signer/signer.mjs --status        last successful run, failed runs in a row, queued counts, launchd job,
//                                                the active sender (reads the log, asks the site for counts, tries the
//                                                Gmail login; prints no secret)
//   node tools/signer/signer.mjs --check-mail    which sender the next run will use: smtp or mail-app (logs in, sends nothing)
//   node tools/signer/signer.mjs --check-mail --send-test
//                                                also send a preview of every email (dummy token SIDEKICK-TRIAL-1.PREVIEW-ONLY)
//                                                to the owner's two addresses only, through SMTP only
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
//   SK_MAILER           mailapp (default: Gmail SMTP when the app password file is there, else Mail.app) | eml (write .eml
//                       files to SK_EML_DIR for sending by hand) | none
//   SK_SMTP             on (default) | off — off sends with Mail.app even when the app password file is there
//   SK_SMTP_PASSWORD_FILE  default ~/Documents/Sidekick-private/secrets/gmail-app-password — the Gmail app password of
//                       chetanpujari.sitit@gmail.com (16 characters, mode 600), read at send time, never logged. Missing,
//                       unreadable, the wrong length or a refused login: Mail.app plain text, with one log line per run.
//   SK_MAIL_FROM        optional sender address for Mail.app (must be one of the owner's Mail accounts)
//   SK_MAIL_PER_HOUR    default 30 — emails sent per rolling hour, all kinds; transactional ones go first
//   SK_MAIL_PER_DAY     default 400 — per rolling 24 hours, under Gmail's documented consumer limit (docs/OWNER-SETUP.md)
//   SK_STATE_DIR        default ~/Library/Application Support/sidekick-signer — sent-times.json (send times only, mode 600)
//   SK_LOG_FILE         default ~/Library/Logs/sidekick-signer.log — the launchd job's log, read by --status and failed runs
//   SK_POOL             on (default) | off — keep the token pool for instant sign-ups filled
//   SK_POOL_LOW         default 40 — mint only when fewer pool tokens than this are ready (also the ATTENTION level)
//   SK_POOL_MAX         default 100 — mint up to this many ready tokens
//   SK_ANDROID_ACCESS   manual-batch (default: the owner pastes play-batch into Play Console) | google-group (see
//                       tools/signer/android-group.mjs and docs/ANDROID-GROUP-SETUP.md; NOT tested against real Google)
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeClient, secretFrom, keychainSecret } from '../lib/client.mjs';
import { isTokenShaped, normaliseEmail } from '../../server/validate.mjs';
import { POOL_LABEL, POOL_ADD_MAX } from '../../server/pool.mjs';
import { CONTACT } from '../../server/emails.mjs';
import { renderEmail, DUMMY_TOKEN, SITE } from '../../server/email-html.mjs';
import { loadGroupConfig, runAndroidGroup } from './android-group.mjs';
import { buildMime, sendSmtp, verifySmtp } from './smtp.mjs';
import { previewSamples } from './previews.mjs';

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
    smtp: env.SK_SMTP !== 'off',
    // null: no SMTP (tests, the demo). main() fills in the real file.
    smtpPasswordFile: env.SK_SMTP_PASSWORD_FILE || null,
    perHour: Number.isInteger(Number(env.SK_MAIL_PER_HOUR)) && Number(env.SK_MAIL_PER_HOUR) >= 0 && env.SK_MAIL_PER_HOUR !== undefined && env.SK_MAIL_PER_HOUR !== '' ? Number(env.SK_MAIL_PER_HOUR) : 30,
    perDay: Number.isInteger(Number(env.SK_MAIL_PER_DAY)) && Number(env.SK_MAIL_PER_DAY) >= 0 && env.SK_MAIL_PER_DAY !== undefined && env.SK_MAIL_PER_DAY !== '' ? Number(env.SK_MAIL_PER_DAY) : 400,
    // null: the budget is kept for this cycle only (tests, the demo). main() fills in the real folder.
    stateDir: env.SK_STATE_DIR || null,
    pool: env.SK_POOL !== 'off',
    poolLow: /^\d{1,4}$/.test(env.SK_POOL_LOW || '') ? Number(env.SK_POOL_LOW) : 40,
    poolMax: /^\d{1,4}$/.test(env.SK_POOL_MAX || '') ? Number(env.SK_POOL_MAX) : 100,
    poolLabel: POOL_LABEL
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

// Mail.app: one plain-text email through send-mail.applescript, values as argv only.
function mailApp(cfg, exec) {
  const script = path.join(HERE, 'send-mail.applescript');
  return ({ to, subject, text }) => new Promise((resolve, reject) => {
    const args = [script, to, subject, text].concat(cfg.mailFrom ? [cfg.mailFrom] : []);
    exec('/usr/bin/osascript', args, { timeout: 60000 }, (e) => e ? reject(new Error('Mail.app send failed')) : resolve());
  });
}

// The Gmail app password, read when needed: { password } or { reason } (the reason never holds the password).
export function readAppPassword(file) {
  let st;
  try { st = fs.statSync(file); } catch { return { reason: `no Gmail app password at ${file}` }; }
  if (!st.isFile()) return { reason: `${file} is not a file` };
  if (st.mode & 0o077) return { reason: `the Gmail app password file must be mode 600 (chmod 600 ${file})` };
  let v;
  try { v = fs.readFileSync(file, 'utf8').replace(/[\s]/g, ''); } catch { return { reason: `the Gmail app password file could not be read` }; }
  if (!/^[A-Za-z0-9]{16}$/.test(v)) return { reason: 'the Gmail app password file does not hold 16 letters' };
  return { password: v };
}

// The owner's own addresses: the only recipients of `--send-test`, and the only ones the preview token may reach.
export const OWNER_ADDRESSES = ['cpujari12@gmail.com', 'chetanpujari92@gmail.com'];
const iso = () => new Date().toISOString();
// The site the emails link to (logo, footer) and the Message-ID domain: the address this signer talks to, so they follow
// the site through a change of address (launch log Part 19). Not https (tests, local runs): the default address.
const siteOf = (cfg) => /^https:\/\/[A-Za-z0-9.-]+$/.test(cfg.base || '') ? cfg.base : SITE;
const smtpMessage = (m, id, site) => {
  const { html, text } = renderEmail(m, { site });
  return buildMime({ from: CONTACT, to: m.to, subject: m.subject, text, html, messageId: `<${id}@${new URL(site).hostname}>` });
};

// The mailer of one run. mailapp (the default) uses Gmail SMTP when the app password file is there, and falls back to
// Mail.app plain text — with one log line — when the file is missing or unusable, or when SMTP fails before the message
// was handed over (connection, TLS, login, envelope). A failure after that ("committed") is reported as a failed send
// and retried by the server on a later run, never re-sent through Mail.app: Gmail may already have it, and the stable
// Message-ID (from the outbox id) lets Gmail recognise a repeat.
export function makeMailer(cfg, { exec = execFile, smtp = sendSmtp, log = console.log } = {}) {
  if (cfg.mailer === 'none') return null;
  if (cfg.mailer === 'eml') {
    return async ({ id, to, subject, text }) => {
      fs.mkdirSync(cfg.emlDir, { recursive: true, mode: 0o700 });
      const eml = [`To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text.replace(/\r?\n/g, '\r\n')].join('\r\n');
      fs.writeFileSync(path.join(cfg.emlDir, `${id}.eml`), eml, { mode: 0o600, flag: 'wx' });
    };
  }
  const app = mailApp(cfg, exec);
  let sender = cfg.smtp && cfg.smtpPasswordFile ? null : 'mail-app', password = null;
  return async (m) => {
    if (String(m.text).includes(DUMMY_TOKEN) || String(m.subject).includes(DUMMY_TOKEN)) throw new Error('refused: the preview token is never sent in a real email');
    if (sender === null) {
      const pw = readAppPassword(cfg.smtpPasswordFile);
      if (pw.password) { sender = 'smtp'; password = pw.password; }
      else { sender = 'mail-app'; log(`${iso()} signer mail: ${pw.reason}; sending with Mail.app (plain text) this run`); }
    }
    if (sender === 'mail-app') return app(m);
    try { await smtp({ user: CONTACT, password, to: m.to, raw: smtpMessage(m, `outbox-${m.id}`, siteOf(cfg)) }); }
    catch (e) {
      if (e.committed) throw new Error(`SMTP send not confirmed (${e.code || 'error'}); left for the next run`);
      sender = 'mail-app'; password = null;
      log(`${iso()} signer mail: SMTP failed (${e.code || 'error'} at ${e.stage || '?'}); sending with Mail.app (plain text) for the rest of this run`);
      return app(m);
    }
  };
}

// Which sender the next run uses (signer --check-mail, --status): logs in to Gmail, sends nothing.
export async function senderStatus(cfg, { verify = verifySmtp } = {}) {
  if (cfg.mailer !== 'mailapp') return { sender: cfg.mailer, reason: `SK_MAILER=${cfg.mailer}` };
  if (!cfg.smtp) return { sender: 'mail-app', reason: 'SK_SMTP=off' };
  if (!cfg.smtpPasswordFile) return { sender: 'mail-app', reason: 'no Gmail app password file configured' };
  const pw = readAppPassword(cfg.smtpPasswordFile);
  if (!pw.password) return { sender: 'mail-app', reason: pw.reason };
  try { await verify({ user: CONTACT, password: pw.password }); }
  catch (e) { return { sender: 'mail-app', reason: `Gmail SMTP login failed (${e.code || 'error'} at ${e.stage || '?'})` }; }
  return { sender: 'smtp', reason: `Gmail SMTP as ${CONTACT}, login ok` };
}

// signer --send-test: one preview of every email, dummy token only, to the owner's own addresses only, SMTP only.
export async function sendTest({ cfg, smtp = sendSmtp, to = OWNER_ADDRESSES, log = console.log, now = () => Date.now() }) {
  if (!to.length || to.some(a => !OWNER_ADDRESSES.includes(a))) throw new Error('send-test sends only to the owner\'s addresses');
  const pw = cfg.smtpPasswordFile ? readAppPassword(cfg.smtpPasswordFile) : { reason: 'no Gmail app password file configured' };
  if (!pw.password) throw new Error(`send-test needs the SMTP sender: ${pw.reason}`);
  const samples = previewSamples({ site: siteOf(cfg) });
  for (const [, m] of samples) for (const t of m.text.match(/SIDEKICK-TRIAL-1\.[A-Za-z0-9._-]+/g) || []) if (t !== DUMMY_TOKEN) throw new Error('send-test refused: a sample holds a real-looking token');
  const times = readTimes(cfg, now());
  if (mailBudget(cfg, times, now()) < samples.length * to.length) throw new Error(`send-test needs ${samples.length * to.length} emails of the sending budget; not enough left this hour/day`);
  let sent = 0;
  for (const [kind, m] of samples) for (const addr of to) {
    const raw = smtpMessage({ ...m, to: addr, subject: `[Preview] ${m.subject}` }, `preview-${kind}-${crypto.randomBytes(8).toString('hex')}`, siteOf(cfg));
    await smtp({ user: CONTACT, password: pw.password, to: addr, raw });
    times.push(now()); writeTimes(cfg, times); sent++;
  }
  log(`${iso()} signer send-test: ${sent} preview emails sent to the owner's ${to.length} addresses`);
  return { sent };
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

// The token pool. Order: discard stale ones (the server decides: older than 10 days or under 35 days left), upload
// any tokens a failed run left on disk, then — only below the low-water mark — mint up to the max and upload them.
// Minted tokens wait in <tokensDir>/pool (mode 600) only until the upload succeeds; then they are deleted. No token
// value is ever logged. Returns counts only.
const UPLOAD_CHUNK = Math.min(25, POOL_ADD_MAX);
export async function runPool({ cfg, post, issue = (o) => runIssuer(cfg, o), pem = null, log = console.log }) {
  const out = { discarded: 0, minted: 0, uploaded: 0, ready: 0, failed: 0 };
  const dir = path.join(cfg.tokensDir, 'pool');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pr = await post('pool-prune');
  if (pr.status !== 200) throw new Error(`pool-prune: HTTP ${pr.status}`);
  out.discarded = pr.discarded;
  const upload = async () => {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sidekick-token')).sort();
    for (let i = 0; i < files.length; i += UPLOAD_CHUNK) {
      const chunk = files.slice(i, i + UPLOAD_CHUNK).map(f => [f, readTokenFile(path.join(dir, f))]);
      for (const [f, t] of chunk) if (!t) { fs.rmSync(path.join(dir, f), { force: true }); out.failed++; log(`pool: ${f} held no token; removed`); }
      const good = chunk.filter(([, t]) => t);
      if (!good.length) continue;
      const r = await post('pool-add', { tokens: good.map(([, t]) => t) });
      if (r.status !== 200) { out.failed += good.length; log(`pool-add: HTTP ${r.status}; ${good.length} token(s) kept for the next run`); continue; }
      for (const [f] of good) fs.rmSync(path.join(dir, f), { force: true });
      out.uploaded += good.length;
    }
  };
  await upload();
  if (out.failed) { out.ready = (await post('pool-status')).ready ?? 0; return out; }
  const st = await post('pool-status');
  if (st.status !== 200) throw new Error(`pool-status: HTTP ${st.status}`);
  if (st.ready < cfg.poolLow) {
    const need = Math.max(0, cfg.poolMax - st.ready);
    for (let i = 0; i < need; i++) {
      const file = path.join(dir, `pool-${Date.now()}-${String(i).padStart(3, '0')}-${Math.random().toString(36).slice(2, 8)}.sidekick-token`);
      try {
        await issue({ label: cfg.poolLabel, outFile: file, pem });
        if (!readTokenFile(file)) throw new Error('the issuer wrote no token');
        fs.chmodSync(file, 0o600);
        out.minted++;
      } catch (e) { out.failed++; fs.rmSync(file, { force: true }); log(`pool mint: ${e.message}`); break; }
    }
    await upload();
  }
  const after = await post('pool-status');
  out.ready = after.status === 200 ? after.ready : st.ready + out.uploaded;
  return out;
}

// The log lines of a pool run: one summary, plus ATTENTION while fewer than the low-water mark are ready.
export function poolLines(r, { poolLow, iso }) {
  const lines = [`${iso} signer pool: ${JSON.stringify(r)}`];
  if (r.ready < poolLow) lines.push(`${iso} ATTENTION: token pool below the low-water mark (${r.ready} ready, low-water ${poolLow}). Instant sign-ups fall back to the email flow when it is empty.`);
  return lines;
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
export function formatStatus({ now, host, log, launchd, queue, poolLow = 40, sender = null }) {
  const ago = (iso) => `${Math.max(0, Math.round((now - Date.parse(iso)) / 60000))} min ago`;
  return [
    `Sidekick signer status at ${new Date(now).toISOString()}`,
    launchd.loaded ? `launchd job com.sidekick.signer: loaded (runs ${launchd.runs ?? '?'}, last exit code ${launchd.lastExit ?? '?'})` : 'launchd job com.sidekick.signer: NOT loaded',
    log.lastRun ? `last run: ${log.lastRun} (${log.lastRunOk ? 'ok' : 'failed'})` : 'last run: none in the log',
    log.lastOk ? `last successful run: ${log.lastOk} (${ago(log.lastOk)})` : 'last successful run: never',
    `consecutive failed runs: ${log.consecutiveFailed}${log.consecutiveFailed >= ATTENTION_AT ? ' — ATTENTION: check that this Mac is awake and online' : ''}`,
    queue.ok ? `queue on ${host}: ${plural(queue.outboxQueued, 'email', 'emails')} waiting to send, ${plural(queue.awaitingToken, 'token', 'tokens')} to issue, ${queue.awaitingPlayList} waiting for the Play list`
      : `queue on ${host}: unavailable (${queue.code || 'error'})`
  ].concat(queue.ok && Number.isInteger(queue.poolReady) ? [
    `token pool on ${host}: ${queue.poolReady} ready (low-water ${poolLow})${queue.poolReady < poolLow ? ' — ATTENTION: below the low-water mark' : ''}`
  ] : queue.ok ? [`token pool on ${host}: unavailable (not migrated yet?)`] : []).concat(queue.ok && Number.isInteger(queue.androidPending) ? [
    `Android: ${plural(queue.androidPending, 'Google account', 'Google accounts')} waiting to be added to the Play test list (admin play-batch)`
  ] : []).concat(sender ? [`sender: ${sender.sender} (${sender.reason})`] : []);
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
        queue = r.status === 200 ? { ok: true, outboxQueued: r.outboxQueued, awaitingToken: r.awaitingToken, awaitingPlayList: r.awaitingPlayList, poolReady: r.poolReady, androidPending: r.androidPending } : { ok: false, code: `HTTP ${r.status}` };
      }
    } catch (e) { queue = { ok: false, code: e.code || 'error' }; }
  }
  console.log(formatStatus({ now: Date.now(), host, log: parseSignerLog(readLog()), launchd: launchdStatus(), queue, poolLow: cfg.poolLow, sender: await senderStatus(cfg) }).join('\n'));
}

// Files on the owner's Mac that hold testers' names or run details (launch log Part 14): the app issuer's ledger, which
// it appends beside the key (that issuer lives in the app's repo), and the launchd job's log. Each run puts them back
// to mode 600, and everything this process or the issuer creates starts private (umask 077).
export const privateFiles = (cfg, logPath = logFile()) => [path.join(path.dirname(cfg.keyFile), 'issued-tokens.tsv'), logPath];
export const privateUmask = () => process.umask(0o077);
// Returns the files it changed. Missing files and symlinks are left alone (never chmod through a link).
export function tightenModes(files) {
  const changed = [];
  for (const f of files) {
    try {
      const st = fs.lstatSync(f);
      if (st.isFile() && (st.mode & 0o077)) { fs.chmodSync(f, 0o600); changed.push(f); }
    } catch { /* not there yet */ }
  }
  return changed;
}

const STARTED = Date.now();
async function main() {
  privateUmask();
  const cfg = loadSignerConfig();
  tightenModes(privateFiles(cfg));
  cfg.stateDir = cfg.stateDir || path.join(HOME, 'Library/Application Support/sidekick-signer');
  cfg.smtpPasswordFile = cfg.smtpPasswordFile || path.join(HOME, 'Documents/Sidekick-private/secrets/gmail-app-password');
  if (process.argv.includes('--check-mail')) {
    const st = await senderStatus(cfg);
    console.log(`sender: ${st.sender} (${st.reason})`);
    // Its own messages, never a "signer failed" run line (--status counts those).
    if (process.argv.includes('--send-test')) await sendTest({ cfg }).catch(e => { console.error(e.message); process.exit(1); });
    return;
  }
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
  tightenModes(privateFiles(cfg)); // the issuer may have just appended to its ledger
  console.log(`${new Date().toISOString()} signer: ${JSON.stringify(r)}`);
  // The pool and the Google Group come after the run line, and their failures never fail the run: invitations and
  // emails above are what people are waiting for.
  if (cfg.pool) {
    try { for (const line of poolLines(await runPool({ cfg, post, pem }), { poolLow: cfg.poolLow, iso: new Date().toISOString() })) console.log(line); }
    catch (e) { console.log(`${new Date().toISOString()} signer pool failed: ${e.message}`); }
  }
  const group = loadGroupConfig();
  if (group.enabled) {
    try {
      if (group.problems.length) throw new Error('not configured: ' + group.problems.join(', '));
      console.log(`${new Date().toISOString()} signer android-group: ${JSON.stringify(await runAndroidGroup({ cfg: group, post }))}`);
    } catch (e) { console.log(`${new Date().toISOString()} signer android-group failed: ${e.message}`); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => {
    const previousFailed = parseSignerLog(readLog()).consecutiveFailed;
    for (const line of failureLines(e, { previousFailed, runMs: Date.now() - STARTED, iso: new Date().toISOString() })) console.error(line);
    process.exit(1);
  });
}
