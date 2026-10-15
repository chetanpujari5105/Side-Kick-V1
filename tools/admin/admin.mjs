// Sidekick admin CLI (owner's Mac). Talks to /api/admin/* with HMAC; there is no admin web page.
//   node tools/admin/admin.mjs stats
//   node tools/admin/admin.mjs export [--out signups.csv]
//   node tools/admin/admin.mjs set-state <email|signupId> <pending_email|approved|waitlisted|denied>
//   node tools/admin/admin.mjs delete <email|signupId>            (delete-my-data: the sign-up and everything linked, roadmap
//                                                                  requests and feedback from that address, and the signer's
//                                                                  local token copy in SK_TOKENS_DIR; see OWNER-SETUP §10)
//   node tools/admin/admin.mjs unsubscribe <email|signupId>       (stops updates and roadmap emails for that address)
//   node tools/admin/admin.mjs settings [--cap 25] [--allow a@x.com,@friends.org] [--deny b@y.com]
//   node tools/admin/admin.mjs promote | retention | migrate      (migrate: schema v1 + v2, run inside Vercel)
//   node tools/admin/admin.mjs play-pending [--out play-testers.csv]
//        Google accounts to add to the Play internal test. Prints the NEW ones comma-separated, for Play Console's
//        "Add email addresses" box (adds to the list). --out writes the FULL list, one per line (mode 600), for
//        "Upload CSV file", which REPLACES the list (support.google.com/googleplay/android-developer/answer/9845334).
//   node tools/admin/admin.mjs play-mark-added <google-email>… | --file play-testers.csv
//        after adding them in Play Console: their token and invitation go out on the signer's next run.
//   node tools/admin/admin.mjs announce --subject "…" --body-file update.txt [--dry-run]
//        an update email to people who asked for updates and confirmed. --dry-run prints counts only.
// Needs SK_API_BASE and the admin secret (SK_ADMIN_SECRET or Keychain item "sidekick-admin-hmac").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeClient, secretFrom } from '../lib/client.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const who = (v) => /^[0-9a-f-]{36}$/.test(v || '') ? { signupId: v } : { email: v };
const list = (v) => v === undefined ? undefined : v.split(',').map(s => s.trim()).filter(Boolean);

const secret = secretFrom('SK_ADMIN_SECRET', 'sidekick-admin-hmac');
if (!process.env.SK_API_BASE || !secret) { console.error('Set SK_API_BASE and the admin secret (SK_ADMIN_SECRET or Keychain "sidekick-admin-hmac").'); process.exit(2); }
const post = makeClient({ base: process.env.SK_API_BASE, keyId: 'admin', secret });

const calls = {
  stats: () => post('stats'),
  export: () => post('export'),
  'set-state': () => post('set-state', { ...who(rest[0]), state: rest[1] }),
  delete: () => post('delete', who(rest[0])),
  unsubscribe: () => post('unsubscribe', who(rest[0])),
  settings: () => post('settings', { ...(flag('--cap') !== undefined ? { betaCap: Number(flag('--cap')) } : {}), allow: list(flag('--allow')), deny: list(flag('--deny')) }),
  promote: () => post('promote'),
  migrate: () => post('migrate'),
  'play-pending': () => post('play-pending'),
  'play-mark-added': () => {
    const f = flag('--file');
    const raw = f ? fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '') : rest.join(',');
    return post('play-mark-added', { googleEmails: raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean) });
  },
  announce: () => {
    const subject = flag('--subject'), file = flag('--body-file');
    if (!subject || !file) { console.error('announce needs --subject "…" and --body-file <file>'); process.exit(2); }
    return post('announce', { subject, body: fs.readFileSync(file, 'utf8'), dryRun: rest.includes('--dry-run') });
  },
  retention: () => post('retention')
};
if (!calls[cmd]) { console.error('Commands: ' + Object.keys(calls).join(', ')); process.exit(2); }
const r = await calls[cmd]();
if (r.status !== 200) { console.error(`HTTP ${r.status} ${r.error || ''}`); process.exit(1); }
if (cmd === 'play-pending') {
  const out = flag('--out');
  if (out) { fs.writeFileSync(out, r.fullCsv, { mode: 0o600 }); fs.chmodSync(out, 0o600); }
  console.log(`${r.count} Google account(s) to add; ${r.total} should be on the Play test list in all.`);
  if (r.count) console.log(`\nTo ADD them (keeps everyone already on the list), paste this into Play Console › Testing › Internal testing › Testers › your list › "Add email addresses":\n${r.csv.trim().split('\n').join(', ')}`);
  if (out) console.log(`\nWrote the full list (${r.total}) to ${out} (mode 600). "Upload CSV file" REPLACES the list: use it only if the list holds nobody else.`);
  console.log('\nThen: node tools/admin/admin.mjs play-mark-added <the same addresses>   (or --file <file>)');
} else if (cmd === 'announce') {
  console.log(r.queued ? `Queued ${r.queued} update email(s) for ${r.recipients} subscriber(s). The signer sends them within its hourly budget.` : `Dry run: ${r.recipients} subscriber(s) would get it. Nothing was queued.`);
} else if (cmd === 'export') {
  const out = flag('--out');
  if (out) { fs.writeFileSync(out, r.csv, { mode: 0o600 }); console.log(`Wrote ${r.csv.split('\n').length - 2} rows to ${out} (mode 600).`); }
  else process.stdout.write(r.csv);
} else {
  if (cmd === 'delete' && /^[0-9a-f-]{36}$/.test(r.signupId || '')) {
    // The signer keeps a copy of each token it issued, named by signupId. Remove it too.
    const f = path.join(process.env.SK_TOKENS_DIR || path.join(os.homedir(), '.sidekick-trial-key/tokens'), `${r.signupId}.sidekick-token`);
    try { fs.unlinkSync(f); r.localTokenCopy = 'removed'; } catch (e) { r.localTokenCopy = e.code === 'ENOENT' ? 'none' : 'NOT removed: ' + e.code; }
    r.reminder = 'Also remove this person\'s line from the issuer\'s list (~/.sidekick-trial-key/issued-tokens.tsv) by hand.';
  }
  const { status, ok, ...data } = r;
  console.log(JSON.stringify(data, null, 2));
}
