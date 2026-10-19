// The privacy text's engineering facts (launch log Part 14): what the code records and what Support › Privacy says
// about it agree. Each test pins one row of the legal review pack's CLAIMS-VS-CODE.md (W4, W6, W9, W19, W28) or the
// signer's private files on the owner's Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup, ORIGIN } from './helpers.mjs';
import { stripRegions } from '../scripts/site-modes.mjs';
import { emails } from '../server/emails.mjs';
import { sha256hex, randomToken } from '../server/crypto.mjs';
import { tightenModes, privateFiles, privateUmask } from '../tools/signer/signer.mjs';
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const automated = (f) => stripRegions(read(f), 'automated');
const BOT = 'XXXX.DUMMY.TOKEN.XXXX';

test('W9: the session download route records nothing about the person; /download/mac keeps its per-day counter', async () => {
  const h = setup();
  await h.signup();
  const { cookie } = await h.confirm();
  const r = await h.call('GET', '/api/download/mac/arm64', { cookie });
  assert.equal(r.status, 302, 'the route still answers');
  assert.equal(h.repo.debugCount('downloads'), 0, 'no per-person download row');
  assert.equal((await h.call('GET', '/download/mac')).status, 302);
  assert.deepEqual((await h.repo.downloadCounts()).map(c => c.count), [1], 'the anonymous per-day count stays');
});

test('W19: "Notify me when this ships" is closed: nothing stored, nothing emailed, old confirm links do nothing', async () => {
  const h = setup();
  const r = await h.call('POST', '/api/roadmap-notify', { json: { email: 'n@example.com', featureId: roadmap.ids[0], captchaToken: BOT }, headers: { origin: ORIGIN } });
  assert.equal(r.status, 410);
  assert.equal((await r.json()).error, 'NOTIFY_UNAVAILABLE');
  assert.equal(h.repo.debugCount('notify'), 0);
  assert.equal(h.repo.debugCount('outbox'), 0);
  // A request made before the change: its confirm link no longer confirms (and deletes nothing).
  const { row } = await h.repo.addNotify({ email: 'old@example.com', featureId: roadmap.ids[0] }, h.clock.now());
  const t = randomToken(32);
  await h.repo.createLink({ hash: sha256hex(t), purpose: 'roadmap_confirm', refId: row.id, expiresAt: h.clock.now() + 3600000, maxUses: 1 }, h.clock.now());
  const c = await h.call('POST', '/api/confirm-email', { json: { t, captchaToken: BOT }, headers: { origin: ORIGIN } });
  assert.equal(c.status, 410);
  assert.equal(h.repo.debugCount('notify'), 1, 'the old request is kept (no user data deleted)');
  assert.equal((await h.repo.stats()).notify, 0, 'and stays unconfirmed');
  assert.equal(emails.notify, undefined, 'no notify email template');
  assert.ok(!read('server/pages.mjs').includes('when this roadmap item ships'), 'no notify confirm page');
});

test('W19: the automated roadmap pages promise no email when an item ships', () => {
  const track = automated('RoadmapTrack.dc.html');
  assert.ok(!track.includes('Notify me when this ships') && !track.includes('We\'ll send one email when this ships'));
  const page = automated('Roadmap.dc.html');
  const old = page.indexOf('we\\\'ll send one message when it ships'), fix = page.indexOf(", intro: 'Open any item to read what it\\'s for.'\n");
  assert.ok(old > 0 && fix > old, 'a later intro key overrides the old automated intro');
});

test('W4, W6, W19: Support › Privacy (automated) states the facts of the code', () => {
  const s = automated('Support.dc.html');
  assert.ok(s.includes('and our server passes Cloudflare your IP address when it verifies the check'), 'W4: IP sent with siteverify (server/adapters.mjs)');
  for (const fact of ['the status of your sign-up', 'when your sign-up was made and last changed', 'whether your token came on the page or by email',
    'when our Mac picked up your sign-up to make a token', 'your Mac\\\'s chip', 'when you agreed to this policy', 'whether you asked for updates, and when you confirmed that by email',
    'one-way code made from it, and one made from the email address you entered'])
    assert.ok(s.includes(fact), `W6: the stored list names ${fact}`);
  assert.ok(!s.includes('If you ask to hear when a roadmap item ships'), 'W19: no roadmap email promise');
  assert.ok(s.includes('We count uses of the download link per day, with nothing about who used it'), 'W9: the counter sentence stays');
  assert.ok(s.includes('DRAFT —'), 'the DRAFT banner stays');
});

test('W28: admin delete returns the Google account so the owner can take it off the Play test list', async () => {
  const h = setup();
  await h.signup();
  const d = await (await h.admin('/api/admin/delete', { email: 'alex@example.com' })).json();
  assert.deepEqual([d.deleted, d.googleEmail], [1, 'alex.rivera@gmail.com']);
  const again = await (await h.admin('/api/admin/delete', { email: 'alex@example.com' })).json();
  assert.equal(again.googleEmail, null);
  assert.ok(!h.logs.some(l => l.includes('alex.rivera@')), 'the Google account is never logged');
  const cli = read('tools/admin/admin.mjs');
  assert.match(cli, /r\.googleEmail[\s\S]{0,200}Play Console/, 'the CLI tells the owner to remove it in Play Console');
});

test('signer: private files on the owner\'s Mac go back to mode 600; new files get umask 077', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-modes-'));
  try {
    const keyDir = path.join(dir, 'key'); fs.mkdirSync(keyDir);
    const ledger = path.join(keyDir, 'issued-tokens.tsv'), log = path.join(dir, 'signer.log'), other = path.join(dir, 'other.txt');
    for (const f of [ledger, log, other]) { fs.writeFileSync(f, 'x\n'); fs.chmodSync(f, 0o644); }
    fs.symlinkSync(other, path.join(dir, 'link'));
    const files = privateFiles({ keyFile: path.join(keyDir, 'private.pem') }, log);
    assert.deepEqual(files, [ledger, log]);
    assert.deepEqual(tightenModes([...files, path.join(dir, 'missing'), path.join(dir, 'link')]), [ledger, log], 'missing files and symlinks are skipped');
    for (const f of [ledger, log]) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.equal(fs.statSync(other).mode & 0o777, 0o644, 'a symlink target is never touched');
    assert.deepEqual(tightenModes(files), [], 'already private: nothing to do');
    const prev = process.umask(0o022);
    privateUmask();
    assert.equal(process.umask(prev), 0o077);
    // The real entry point does it on every run, even one that stops at its configuration check.
    for (const f of [ledger, log]) fs.chmodSync(f, 0o644);
    const r = spawnSync(process.execPath, [new URL('../tools/signer/signer.mjs', import.meta.url).pathname], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, SK_KEY_FILE: path.join(keyDir, 'private.pem'), SK_LOG_FILE: log, SK_SIGNER_SECRET: 'x'.repeat(40), SK_ISSUER: path.join(dir, 'none.mjs') }
    });
    assert.equal(r.status, 2, 'stops: not configured');
    for (const f of [ledger, log]) assert.equal(fs.statSync(f).mode & 0o777, 0o600, `${path.basename(f)} is private after a run`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
