// Sidekick admin CLI (owner's Mac). Talks to /api/admin/* with HMAC; there is no admin web page.
//   node tools/admin/admin.mjs stats
//   node tools/admin/admin.mjs export [--out signups.csv]
//   node tools/admin/admin.mjs set-state <email|signupId> <pending_email|approved|waitlisted|denied>
//   node tools/admin/admin.mjs delete <email|signupId>            (delete-my-data: the sign-up and everything linked, roadmap
//                                                                  requests and feedback from that address, and the signer's
//                                                                  local token copy in SK_TOKENS_DIR; see OWNER-SETUP §9)
//   node tools/admin/admin.mjs unsubscribe <email|signupId>       (stops updates and roadmap emails for that address)
//   node tools/admin/admin.mjs settings [--cap 25] [--allow a@x.com,@friends.org] [--deny b@y.com]
//   node tools/admin/admin.mjs promote | retention
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
  retention: () => post('retention')
};
if (!calls[cmd]) { console.error('Commands: ' + Object.keys(calls).join(', ')); process.exit(2); }
const r = await calls[cmd]();
if (r.status !== 200) { console.error(`HTTP ${r.status} ${r.error || ''}`); process.exit(1); }
if (cmd === 'export') {
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
