// Sidekick admin CLI (owner's Mac). Talks to /api/admin/* with HMAC; there is no admin web page.
//   node tools/admin/admin.mjs stats
//   node tools/admin/admin.mjs export [--out signups.csv]
//   node tools/admin/admin.mjs set-state <email|signupId> <pending_email|approved|waitlisted|denied>
//   node tools/admin/admin.mjs delete <email|signupId>            (delete-my-data: removes the person and everything linked)
//   node tools/admin/admin.mjs settings [--cap 25] [--allow a@x.com,@friends.org] [--deny b@y.com]
//   node tools/admin/admin.mjs promote | retention
// Needs SK_API_BASE and the admin secret (SK_ADMIN_SECRET or Keychain item "sidekick-admin-hmac").
import fs from 'node:fs';
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
  const { status, ok, ...data } = r;
  console.log(JSON.stringify(data, null, 2));
}
