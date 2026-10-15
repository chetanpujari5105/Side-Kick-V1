// Sidekick token signer — runs on the OWNER'S MAC only (never deployed: /tools is in .vercelignore).
//
// One cycle: ask the site which approved people need a token → run the Mac app's own issuer for each →
// post back only the finished token → send queued emails from the owner's own mailbox (Mail.app) → report.
// The private key is read by the issuer, never by this script, and never leaves the Mac.
//
//   node tools/signer/signer.mjs --once          one cycle (what launchd runs every 5 minutes)
//   node tools/signer/signer.mjs --check         check the configuration and stop
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
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
    mailFrom: env.SK_MAIL_FROM || null
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

// One cycle. `post` is a signed admin client; `issue` and `mail` are injectable for tests.
export async function runCycle({ cfg, post, issue = (o) => runIssuer(cfg, o), mail, pem = null, log = console.log }) {
  const out = { issued: 0, reused: 0, posted: 0, failed: 0, mailed: 0, mailFailed: 0 };
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
    const ob = await post('outbox');
    if (ob.status !== 200) throw new Error(`outbox: HTTP ${ob.status}`);
    for (const m of ob.messages) {
      if (!normaliseEmail(m.to) || /[\r\n]/.test(m.subject)) { await post('outbox-ack', { id: m.id, ok: false, errorCode: 'bad-address' }); out.mailFailed++; continue; }
      try { await mail(m); await post('outbox-ack', { id: m.id, ok: true }); out.mailed++; }
      catch (e) { await post('outbox-ack', { id: m.id, ok: false, errorCode: 'send-failed' }); out.mailFailed++; log(`email ${m.id} (${m.kind}): ${e.message}`); }
    }
  }
  return out;
}

async function main() {
  const cfg = loadSignerConfig();
  cfg.secret = cfg.secret || secretFrom('SK_SIGNER_SECRET', 'sidekick-signer-hmac');
  const problems = [];
  if (!cfg.base) problems.push('SK_API_BASE is not set');
  if (!cfg.secret) problems.push('no signer secret (SK_SIGNER_SECRET or Keychain item "sidekick-signer-hmac")');
  if (!fs.existsSync(cfg.issuer)) problems.push(`issuer not found at ${cfg.issuer}`);
  let pem = null;
  if (cfg.keySource === 'keychain') { pem = keychainSecret(cfg.keyService); if (!pem || !pem.includes('PRIVATE KEY')) problems.push(`no PEM in Keychain item "${cfg.keyService}"`); }
  else if (!fs.existsSync(cfg.keyFile)) problems.push(`key file not found at ${cfg.keyFile}`);
  if (problems.length) { console.error('Signer not ready:\n- ' + problems.join('\n- ')); process.exit(2); }
  if (process.argv.includes('--check')) { console.log('Signer configuration looks complete (nothing was sent).'); return; }
  const post = makeClient({ base: cfg.base, keyId: 'signer', secret: cfg.secret });
  const r = await runCycle({ cfg, post, mail: makeMailer(cfg), pem });
  console.log(`${new Date().toISOString()} signer: ${JSON.stringify(r)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error(`${new Date().toISOString()} signer failed: ${e.message}`); process.exit(1); });
}
