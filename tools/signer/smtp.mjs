// A small SMTP client for the signer (launch log Part 11, decision P11-D2: vendored instead of a dependency, so the
// launchd job needs no npm install). Gmail over implicit TLS on port 465, AUTH PLAIN with the app password, one
// message per connection. Nothing here logs: errors carry a code, the stage they happened at, and `committed` — true
// once the end of the message was sent, when the server may already have accepted it (never re-send it another way).
import tls from 'node:tls';
import os from 'node:os';
import crypto from 'node:crypto';

export const SMTP_HOST = 'smtp.gmail.com';
export const SMTP_PORT = 465;
const TIMEOUT_MS = 20000;

const ascii = /^[\x20-\x7e]*$/;
const noBreak = (v, what) => { if (/[\r\n]/.test(String(v))) throw new Error(`refused: line break in the ${what} header`); return String(v); };
// RFC 2047 encoded words of at most 45 UTF-8 bytes each (never splitting a character), folded onto new lines.
function encodeHeader(v) {
  if (ascii.test(v) && v.length <= 900) return v;
  const words = []; let cur = '';
  for (const ch of v) { if (Buffer.byteLength(cur + ch) > 45) { words.push(cur); cur = ''; } cur += ch; }
  if (cur) words.push(cur);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}
const b64 = (s) => Buffer.from(String(s).replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');

// The message: multipart/alternative, plain text first and HTML last (the part clients prefer), both base64.
export function buildMime({ from, to, subject, text, html, messageId, date = new Date() }) {
  const boundary = 'sk-' + crypto.randomBytes(12).toString('hex');
  const head = [
    `From: Sidekick <${noBreak(from, 'From')}>`,
    `Reply-To: Sidekick <${noBreak(from, 'Reply-To')}>`,
    `To: ${noBreak(to, 'To')}`,
    `Subject: ${encodeHeader(noBreak(subject, 'Subject'))}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${noBreak(messageId, 'Message-ID')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', b64(body)].join('\r\n');
  return [head.join('\r\n'), '', part('text/plain', text), part('text/html', html), `--${boundary}--`, ''].join('\r\n');
}

const fail = (stage, code, message, committed = false) => Object.assign(new Error(`SMTP ${stage}: ${message}`), { code, stage, committed });

// Sends one message. `connect` is injectable for tests (they use a plain local socket).
export function sendSmtp({ user, password, to, raw, host = SMTP_HOST, port = SMTP_PORT }, { connect } = {}) {
  return new Promise((resolve, reject) => {
    let stage = 'connect', connected = false, committed = false, accepted = false, buf = '', waiting = null, done = false;
    const sock = connect ? connect() : tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2' });
    sock.once(connect ? 'connect' : 'secureConnect', () => { connected = true; });
    // Once the server answered 250 to the end of the message it is sent: a later problem (QUIT) is not a failure.
    const finish = (e) => { if (done) return; done = true; sock.destroy(); e && !accepted ? reject(e) : resolve(); };
    const at = () => connected ? stage : 'connect';
    sock.setTimeout(TIMEOUT_MS, () => finish(fail(at(), 'ETIMEDOUT', 'timed out', committed)));
    sock.on('error', (e) => finish(fail(at(), e.code || 'ESOCKET', e.code || 'socket error', committed)));
    sock.on('close', () => finish(fail(at(), 'ECONNRESET', 'connection closed', committed)));
    // One reply (multi-line replies end with "NNN " on the last line).
    const drain = () => {
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (!m || !waiting) return;
      const code = Number(m[1]), text = buf.trim().split('\r\n').pop(); buf = '';
      const w = waiting; waiting = null; w(code, text);
    };
    sock.on('data', (d) => { buf += d.toString('utf8'); drain(); });
    const reply = () => new Promise(r => { waiting = (code, text) => r({ code, text }); drain(); });
    const step = async (name, line, ok, errCode = 'EPROTOCOL') => {
      stage = name;
      if (line !== null) sock.write(line + '\r\n');
      const r = await reply();
      // Never echo the AUTH line or anything the server said about it back into a log.
      if (!ok.includes(r.code)) throw fail(name, name === 'auth' ? 'EAUTH' : errCode, name === 'auth' ? `login refused (${r.code})` : `${r.code} ${r.text.slice(4, 80)}`, committed);
      return r;
    };
    (async () => {
      await step('greeting', null, [220]);
      await step('ehlo', `EHLO ${os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost'}`, [250]);
      await step('auth', `AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString('base64')}`, [235]);
      await step('mail', `MAIL FROM:<${noBreak(user, 'MAIL FROM')}>`, [250], 'EENVELOPE');
      await step('rcpt', `RCPT TO:<${noBreak(to, 'RCPT TO')}>`, [250, 251], 'EENVELOPE');
      await step('data', 'DATA', [354]);
      stage = 'body';
      const body = raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      sock.write(body.endsWith('\r\n') ? body : body + '\r\n');
      committed = true; // from here the server may have the message
      await step('end', '.', [250]);
      accepted = true;
      await step('quit', 'QUIT', [221]).catch(() => {});
      finish();
    })().catch(finish);
  });
}

// Connect and log in only (signer --check-mail): nothing is sent.
export function verifySmtp({ user, password, host = SMTP_HOST, port = SMTP_PORT }, { connect } = {}) {
  return new Promise((resolve, reject) => {
    let buf = '', stage = 'connect', done = false;
    const sock = connect ? connect() : tls.connect({ host, port, servername: host, minVersion: 'TLSv1.2' });
    const finish = (e) => { if (done) return; done = true; sock.destroy(); e ? reject(e) : resolve(); };
    sock.setTimeout(TIMEOUT_MS, () => finish(fail(stage, 'ETIMEDOUT', 'timed out')));
    sock.on('error', (e) => finish(fail(stage, e.code || 'ESOCKET', e.code || 'socket error')));
    sock.on('close', () => finish(fail(stage, 'ECONNRESET', 'connection closed')));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/); if (!m) return;
      const code = Number(m[1]); buf = '';
      if (stage === 'connect') { if (code !== 220) return finish(fail('greeting', 'EPROTOCOL', String(code))); stage = 'ehlo'; sock.write(`EHLO ${os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost'}\r\n`); }
      else if (stage === 'ehlo') { if (code !== 250) return finish(fail('ehlo', 'EPROTOCOL', String(code))); stage = 'auth'; sock.write(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString('base64')}\r\n`); }
      else if (stage === 'auth') { if (code !== 235) return finish(fail('auth', 'EAUTH', `login refused (${code})`)); stage = 'quit'; sock.write('QUIT\r\n'); done = true; sock.end(); resolve(); }
    });
  });
}
