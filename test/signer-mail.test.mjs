// The signer's sender (launch log Part 11): Gmail SMTP with the app password when its file is there and the login
// works; otherwise Mail.app plain text as before, with one log line — never losing or duplicating an email.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setup, ORIGIN } from './helpers.mjs';
import { runCycle, makeMailer, loadSignerConfig, senderStatus, formatStatus, sendTest, OWNER_ADDRESSES } from '../tools/signer/signer.mjs';
import { buildMime, sendSmtp } from '../tools/signer/smtp.mjs';
import { DUMMY_TOKEN } from '../server/email-html.mjs';
import { makeClient } from '../tools/lib/client.mjs';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-mail-test-')); dirs.push(d); return d; };
const PW = 'abcdefghijklmnop'; // a stand-in, not a real app password
const pwFile = (mode = 0o600, value = PW) => { const f = path.join(tmp(), 'gmail-app-password'); fs.writeFileSync(f, value, { mode }); fs.chmodSync(f, mode); return f; };
const MSG = { id: '11111111-1111-4111-8111-111111111111', kind: 'copy', to: 'a@example.com', subject: "You're in, Chetan: your Sidekick beta", text: "You're in, Chetan.\n\nHere it is.\n\nDownload for Mac:\nhttps://sidekickapp.in/download/mac\n\n— Sidekick\n\nYou got this email because this address was entered on the Sidekick website." };

// A scripted SMTP server on localhost (plain TCP; the client's TLS socket is swapped for net in these tests).
function fakeSmtp({ auth = true, dropAfterDot = false } = {}) {
  const got = [];
  const server = net.createServer((s) => {
    let buf = '', inData = false, data = '';
    s.write('220 fake ESMTP\r\n');
    s.on('data', (d) => {
      buf += d;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          data = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          if (dropAfterDot) { s.destroy(); return; }
          got.push({ data }); s.write('250 2.0.0 OK queued\r\n'); continue;
        }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        got.push({ cmd: line });
        if (/^EHLO/.test(line)) s.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH PLAIN/.test(line)) s.write(auth ? '235 2.7.0 Accepted\r\n' : '535 5.7.8 Username and Password not accepted\r\n');
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) s.write('250 OK\r\n');
        else if (line === 'DATA') { inData = true; s.write('354 Go ahead\r\n'); }
        else if (line === 'QUIT') { s.end('221 bye\r\n'); }
        else s.write('500 what\r\n');
      }
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ got, port: server.address().port, close: () => server.close() })));
}
const plainConnect = (port) => () => net.connect(port, '127.0.0.1');

test('MIME: multipart/alternative with plain text and HTML, From/Reply-To Sidekick, a Message-ID from the outbox id', () => {
  const raw = buildMime({ from: 'chetanpujari.sitit@gmail.com', to: 'a@example.com', subject: "You're in, Élodie: your Sidekick beta", text: 'héllo\nworld', html: '<p>héllo</p>', messageId: '<outbox-1@sidekickapp.in>', date: new Date('2026-10-19T10:00:00Z') });
  const [head, ...rest] = raw.split('\r\n\r\n');
  assert.match(head, /^From: Sidekick <chetanpujari\.sitit@gmail\.com>\r\n/m);
  assert.match(head, /\r\nReply-To: Sidekick <chetanpujari\.sitit@gmail\.com>\r\n/);
  assert.match(head, /\r\nTo: a@example\.com\r\n/);
  assert.match(head, /\r\nMessage-ID: <outbox-1@sidekickapp\.in>\r\n/);
  assert.match(head, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  const subj = head.match(/Subject: ((?:.|\r\n )+)/)[1].split('\r\n ').map(w => Buffer.from(w.match(/=\?UTF-8\?B\?(.*)\?=/)[1], 'base64').toString('utf8')).join('');
  assert.equal(subj, "You're in, Élodie: your Sidekick beta");
  assert.match(head, /Content-Type: multipart\/alternative; boundary="([^"]+)"/);
  const body = rest.join('\r\n\r\n');
  const parts = [...body.matchAll(/Content-Type: (text\/(?:plain|html)); charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)];
  assert.deepEqual(parts.map(p => p[1]), ['text/plain', 'text/html'], 'plain text first, HTML last (preferred)');
  assert.equal(Buffer.from(parts[0][2].replace(/\r\n/g, ''), 'base64').toString('utf8'), 'héllo\r\nworld');
  assert.equal(Buffer.from(parts[1][2].replace(/\r\n/g, ''), 'base64').toString('utf8'), '<p>héllo</p>');
  for (const l of raw.split('\r\n')) assert.ok(l.length <= 998);
  assert.throws(() => buildMime({ from: 'chetanpujari.sitit@gmail.com', to: 'a@example.com\r\nBcc: x@y.z', subject: 's', text: 't', html: 'h', messageId: '<m@x>' }), /header/);
  assert.throws(() => buildMime({ from: 'chetanpujari.sitit@gmail.com', to: 'a@example.com', subject: 's\nBcc: x@y.z', text: 't', html: 'h', messageId: '<m@x>' }), /header/);
});

test('SMTP client: EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT; the password only in the AUTH line', async () => {
  const srv = await fakeSmtp();
  try {
    await sendSmtp({ user: 'chetanpujari.sitit@gmail.com', password: PW, to: 'a@example.com', raw: 'Subject: x\r\n\r\n.leading dot\r\nbody' }, { connect: plainConnect(srv.port) });
    const cmds = srv.got.filter(g => g.cmd).map(g => g.cmd.split(' ').slice(0, 2).join(' '));
    assert.deepEqual(cmds, ['EHLO ' + srv.got[0].cmd.split(' ')[1], 'AUTH PLAIN', 'MAIL FROM:<chetanpujari.sitit@gmail.com>', 'RCPT TO:<a@example.com>', 'DATA', 'QUIT']);
    assert.equal(Buffer.from(srv.got[1].cmd.split(' ')[2], 'base64').toString(), `\0chetanpujari.sitit@gmail.com\0${PW}`);
    assert.equal(srv.got.find(g => g.data).data, 'Subject: x\r\n\r\n..leading dot\r\nbody', 'dot-stuffed');
  } finally { srv.close(); }
});

test('SMTP client: a refused login fails before anything is sent (safe to fall back); a drop after the final dot is "committed"', async () => {
  const bad = await fakeSmtp({ auth: false });
  try {
    await assert.rejects(sendSmtp({ user: 'u@gmail.com', password: PW, to: 'a@example.com', raw: 'x' }, { connect: plainConnect(bad.port) }), (e) => e.code === 'EAUTH' && e.stage === 'auth' && e.committed === false && !e.message.includes(PW));
    assert.ok(!bad.got.some(g => g.data), 'no message data');
  } finally { bad.close(); }
  const drop = await fakeSmtp({ dropAfterDot: true });
  try { await assert.rejects(sendSmtp({ user: 'u@gmail.com', password: PW, to: 'a@example.com', raw: 'x' }, { connect: plainConnect(drop.port) }), (e) => e.committed === true); }
  finally { drop.close(); }
  await assert.rejects(sendSmtp({ user: 'u@gmail.com', password: PW, to: 'a@example.com', raw: 'x' }, { connect: () => net.connect(1, '127.0.0.1') }), (e) => e.stage === 'connect' && e.committed === false);
});

const cfgWith = (o = {}) => ({ ...loadSignerConfig({}), ...o });
const appMail = () => { const calls = []; return { calls, exec: (cmd, args, opts, cb) => { calls.push(args.slice(1)); cb(null); } }; };

test('sender selection: no password file → Mail.app plain text, with ONE log line per run; nothing about the password', async () => {
  const a = appMail(), lines = [], smtpCalls = [];
  const m = makeMailer(cfgWith({ smtpPasswordFile: path.join(tmp(), 'missing') }), { exec: a.exec, smtp: async (o) => smtpCalls.push(o), log: l => lines.push(l) });
  await m(MSG); await m({ ...MSG, id: '22222222-2222-4222-8222-222222222222' });
  assert.equal(a.calls.length, 2); assert.equal(smtpCalls.length, 0);
  assert.equal(lines.length, 1); assert.match(lines[0], /signer mail: .*Mail\.app \(plain text\)/);
  const loose = makeMailer(cfgWith({ smtpPasswordFile: pwFile(0o644) }), { exec: a.exec, smtp: async (o) => smtpCalls.push(o), log: l => lines.push(l) });
  await loose(MSG);
  assert.equal(smtpCalls.length, 0, 'a password file readable by others is not used');
  assert.match(lines[1], /mode 600/);
  const short = makeMailer(cfgWith({ smtpPasswordFile: pwFile(0o600, 'tooshort') }), { exec: a.exec, smtp: async (o) => smtpCalls.push(o), log: l => lines.push(l) });
  await short(MSG);
  assert.equal(smtpCalls.length, 0);
  for (const l of lines) assert.ok(!l.includes(PW) && !l.includes('tooshort'));
  // SK_SMTP=off, and the tests' default config (no file configured), never try SMTP.
  const off = makeMailer(cfgWith({ smtpPasswordFile: pwFile(), smtp: false }), { exec: a.exec, smtp: async (o) => smtpCalls.push(o), log: l => lines.push(l) });
  await off(MSG);
  assert.equal(smtpCalls.length, 0);
  assert.equal(loadSignerConfig({}).smtpPasswordFile, null);
  assert.equal(loadSignerConfig({ SK_SMTP: 'off' }).smtp, false);
});

test('sender selection: with the password file, SMTP sends HTML + plain text from Sidekick; Mail.app is not used', async () => {
  const a = appMail(), sent = [];
  const m = makeMailer(cfgWith({ smtpPasswordFile: pwFile() }), { exec: a.exec, smtp: async (o) => sent.push(o), log: () => {} });
  await m(MSG);
  assert.equal(a.calls.length, 0); assert.equal(sent.length, 1);
  assert.equal(sent[0].user, 'chetanpujari.sitit@gmail.com'); assert.equal(sent[0].password, PW); assert.equal(sent[0].to, 'a@example.com');
  assert.match(sent[0].raw, /\r\nMessage-ID: <outbox-11111111-1111-4111-8111-111111111111@sidekickapp\.in>\r\n/);
  assert.match(sent[0].raw, /multipart\/alternative/);
  assert.match(sent[0].raw, /Content-Type: text\/html; charset=utf-8/);
});

test('fallback: a refused login sends that email with Mail.app once, then Mail.app for the rest of the run', async () => {
  const a = appMail(), lines = [];
  let tries = 0;
  const smtp = async () => { tries++; throw Object.assign(new Error('535 refused'), { code: 'EAUTH', stage: 'auth', committed: false }); };
  const m = makeMailer(cfgWith({ smtpPasswordFile: pwFile() }), { exec: a.exec, smtp, log: l => lines.push(l) });
  await m(MSG); await m({ ...MSG, id: '22222222-2222-4222-8222-222222222222' });
  assert.equal(tries, 1, 'SMTP tried once'); assert.equal(a.calls.length, 2, 'each email sent exactly once, by Mail.app');
  assert.equal(lines.length, 1); assert.match(lines[0], /EAUTH.*Mail\.app \(plain text\)/);
  assert.ok(!lines[0].includes(PW));
});

test('no duplicates: an SMTP failure after the message was handed over is NOT re-sent with Mail.app', async () => {
  const a = appMail();
  const smtp = async () => { throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET', stage: 'body', committed: true }); };
  const m = makeMailer(cfgWith({ smtpPasswordFile: pwFile() }), { exec: a.exec, smtp, log: () => {} });
  await assert.rejects(m(MSG), /not confirmed/);
  assert.equal(a.calls.length, 0);
});

test('in a real cycle: login refused → every queued email still goes out exactly once (Mail.app) and is acked once', async () => {
  const h = setup();
  await h.signup(); await h.confirm(); // queues confirm (sent by confirm()) … plus more emails after approval
  await h.signup({ email: 'b@example.com', name: 'bea' });
  const post = makeClient({ base: ORIGIN, keyId: 'signer', secret: h.env.ADMIN_AUTH_SIGNER_SECRET, fetch: (u, o) => h.app.fetch(new Request(u, o)), now: () => h.clock.now() });
  const queued = h.repo.debugOutbox().filter(x => !x.sentAt).length;
  assert.ok(queued >= 2, `queued ${queued}`);
  const a = appMail(), lines = [];
  const mail = makeMailer(cfgWith({ smtpPasswordFile: pwFile(), tokensDir: path.join(tmp(), 't') }), { exec: a.exec, smtp: async () => { throw Object.assign(new Error('refused'), { code: 'EAUTH', stage: 'auth', committed: false }); }, log: l => lines.push(l) });
  const r = await runCycle({ cfg: cfgWith({ tokensDir: path.join(tmp(), 't'), pool: false }), post, issue: async () => { throw new Error('no issuer in this test'); }, mail, log: () => {} });
  assert.equal(r.mailed, queued); assert.equal(r.mailFailed, 0);
  assert.equal(a.calls.length, queued, 'one Mail.app send per email');
  assert.equal(new Set(a.calls.map(c => c[0] + c[1])).size, queued, 'no email sent twice');
  assert.equal(h.repo.debugOutbox().filter(x => !x.sentAt).length, 0, 'all acked');
  assert.equal(lines.filter(l => /signer mail:/.test(l)).length, 1);
});

test('dummy-token guard: a real send never carries the preview token; --send-test only the dummy, only to the owner', async () => {
  const a = appMail(), sent = [];
  const m = makeMailer(cfgWith({ smtpPasswordFile: pwFile() }), { exec: a.exec, smtp: async (o) => sent.push(o), log: () => {} });
  await assert.rejects(m({ ...MSG, text: MSG.text + '\n\n' + DUMMY_TOKEN }), /preview token/);
  assert.equal(sent.length + a.calls.length, 0);
  assert.deepEqual(OWNER_ADDRESSES, ['cpujari12@gmail.com', 'chetanpujari92@gmail.com']);
  const r = await sendTest({ cfg: cfgWith({ smtpPasswordFile: pwFile() }), smtp: async (o) => sent.push(o), log: () => {} });
  assert.ok(r.sent >= 10, `sent ${r.sent}`);
  assert.deepEqual([...new Set(sent.map(s => s.to))].sort(), [...OWNER_ADDRESSES].sort());
  for (const s of sent) {
    const decoded = [...s.raw.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map(x => Buffer.from(x[1].replace(/\r\n/g, ''), 'base64').toString('utf8')).join('\n').replace(/<wbr>/g, '');
    const toks = decoded.match(/SIDEKICK-TRIAL-1\.[A-Za-z0-9._-]+/g) || [];
    for (const t of toks) assert.equal(t, DUMMY_TOKEN, 'only the dummy token');
    assert.match(s.raw, /\r\nSubject: (=\?UTF-8\?B\?|\[Preview\])/);
  }
  await assert.rejects(sendTest({ cfg: cfgWith({ smtpPasswordFile: pwFile() }), smtp: async () => {}, to: ['someone@example.com'], log: () => {} }), /owner/);
  await assert.rejects(sendTest({ cfg: cfgWith({ smtpPasswordFile: path.join(tmp(), 'missing') }), smtp: async () => {}, log: () => {} }), /SMTP/);
});

test('--check-mail / --status: which sender will be used, never the password', async () => {
  const ok = await senderStatus(cfgWith({ smtpPasswordFile: pwFile() }), { verify: async () => {} });
  assert.deepEqual([ok.sender, /login ok/.test(ok.reason)], ['smtp', true]);
  const refused = await senderStatus(cfgWith({ smtpPasswordFile: pwFile() }), { verify: async () => { throw Object.assign(new Error('535'), { code: 'EAUTH', stage: 'auth' }); } });
  assert.equal(refused.sender, 'mail-app'); assert.match(refused.reason, /EAUTH/);
  const none = await senderStatus(cfgWith({ smtpPasswordFile: path.join(tmp(), 'missing') }), { verify: async () => { throw new Error('not called'); } });
  assert.equal(none.sender, 'mail-app'); assert.match(none.reason, /no Gmail app password/);
  for (const s of [ok, refused, none]) assert.ok(!JSON.stringify(s).includes(PW));
  const lines = formatStatus({ now: Date.now(), host: 'x', log: { consecutiveFailed: 0 }, launchd: { loaded: true }, queue: { ok: false }, sender: none });
  assert.ok(lines.some(l => /^sender: mail-app/.test(l)), lines.join('\n'));
});
