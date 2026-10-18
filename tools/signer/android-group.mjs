// ANDROID_ACCESS=google-group, the signer's half — DISABLED by default and NOT tested against real Google (only
// against a local mock in test/pool-signer.test.mjs). See docs/ANDROID-GROUP-SETUP.md before turning it on.
//
// On the owner's Mac only: asks the site which instant sign-ups have a Google account waiting, adds each one to a
// Google Group through the Cloud Identity Groups API, and only after Google accepts it (or says it is already a
// member) tells the site, which then queues that person's Android invitation email. The group is the tester source
// of a CLOSED testing track in Play Console. The credentials (a service account key file) never leave this Mac.
//
//   SK_ANDROID_ACCESS=google-group     turns it on (anything else: off)
//   SK_GOOGLE_GROUP                    the group's email address, e.g. sidekick-beta@your-domain.example
//   SK_GOOGLE_CREDENTIALS_FILE         the service account's JSON key file (mode 600)
//   SK_GOOGLE_API_BASE                 default https://cloudidentity.googleapis.com (tests point it at a local mock)
//   SK_GOOGLE_TOKEN_URL                default https://oauth2.googleapis.com/token
// API shapes from developers.google.com/identity/protocols/oauth2/service-account and
// cloud.google.com/identity/docs/reference/rest/v1/groups.memberships (read 2026-10-18; unverified against a live call).
import crypto from 'node:crypto';
import fs from 'node:fs';

const SCOPE = 'https://www.googleapis.com/auth/cloud-identity.groups';

export function loadGroupConfig(env = process.env) {
  const enabled = env.SK_ANDROID_ACCESS === 'google-group';
  const problems = [];
  if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SK_GOOGLE_GROUP || '')) problems.push('SK_GOOGLE_GROUP');
  if (enabled && !env.SK_GOOGLE_CREDENTIALS_FILE) problems.push('SK_GOOGLE_CREDENTIALS_FILE');
  return {
    enabled, problems,
    group: env.SK_GOOGLE_GROUP || null,
    credentialsFile: env.SK_GOOGLE_CREDENTIALS_FILE || null,
    apiBase: (env.SK_GOOGLE_API_BASE || 'https://cloudidentity.googleapis.com').replace(/\/$/, ''),
    tokenUrl: env.SK_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
  };
}

function readCredentials(file) {
  if (fs.statSync(file).mode & 0o077) throw new Error('SK_GOOGLE_CREDENTIALS_FILE must be readable by you only (chmod 600)');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!c.client_email || !c.private_key) throw new Error('the credentials file has no client_email/private_key (a service account JSON key is expected)');
  return c;
}

// OAuth 2.0 for a service account: a JWT signed with its key (RS256), exchanged for a one-hour access token.
async function accessToken({ creds, tokenUrl, fetch: f, now }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: creds.client_email, scope: SCOPE, aud: tokenUrl, iat, exp: iat + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), creds.private_key).toString('base64url');
  const r = await f(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }).toString() });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j.access_token) throw new Error(`Google token exchange: HTTP ${r.status}${j.error ? ' ' + String(j.error).slice(0, 40) : ''}`);
  return j.access_token;
}

const status = (j) => (j && j.error && (j.error.status || j.error)) ? String(j.error.status || j.error).replace(/[^A-Z_a-z]/g, '').slice(0, 40) : '';

export async function runAndroidGroup({ cfg, post, fetch: f = fetch, now = () => Date.now(), log = console.log }) {
  const out = { pending: 0, added: 0, failed: 0 };
  const p = await post('android-pending');
  if (p.status !== 200) throw new Error(`android-pending: HTTP ${p.status}`);
  out.pending = p.pending.length;
  if (!out.pending) return out;
  const creds = readCredentials(cfg.credentialsFile);
  const token = await accessToken({ creds, tokenUrl: cfg.tokenUrl, fetch: f, now });
  const auth = { authorization: `Bearer ${token}` };
  const lr = await f(`${cfg.apiBase}/v1/groups:lookup?${new URLSearchParams({ 'groupKey.id': cfg.group })}`, { headers: auth });
  const lj = await lr.json().catch(() => ({}));
  if (lr.status !== 200 || !/^groups\/[A-Za-z0-9_-]+$/.test(lj.name || '')) throw new Error(`group lookup: HTTP ${lr.status} ${status(lj)}`.trim());
  for (const { signupId, googleEmail } of p.pending) {
    const r = await f(`${cfg.apiBase}/v1/${lj.name}/memberships`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ preferredMemberKey: { id: googleEmail }, roles: [{ name: 'MEMBER' }] }) });
    const j = await r.json().catch(() => ({}));
    // 409 ALREADY_EXISTS: already a member, which is what we wanted.
    if (r.status === 200 || r.status === 409) {
      const m = await post('android-added', { signupId });
      if (m.status === 200) out.added++; else { out.failed++; log(`android-added ${signupId}: HTTP ${m.status}`); }
    } else { out.failed++; log(`group add for ${signupId}: HTTP ${r.status} ${status(j)}`.trim()); }
  }
  return out;
}
