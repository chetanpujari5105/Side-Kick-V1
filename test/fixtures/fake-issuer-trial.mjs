// TEST ONLY. Like fake-issuer.mjs, but with the payload layout of the Mac app's issuer ({v, id, label, notBefore,
// notAfter}, notBefore = the start of today in UTC), so the server can read the end date of a pool token. It signs
// with whatever key it is given — the tests give it a throwaway Ed25519 key generated in memory.
import crypto from 'node:crypto';
import fs from 'node:fs';
const a = process.argv.slice(2), arg = (n) => a[a.indexOf(n) + 1];
const key = crypto.createPrivateKey(fs.readFileSync(arg('--key'), 'utf8'));
const start = new Date(); start.setUTCHours(0, 0, 0, 0);
const payload = Buffer.from(JSON.stringify({ v: 1, id: crypto.randomBytes(12).toString('base64url'), label: arg('--label'), notBefore: start.toISOString(), notAfter: new Date(start.getTime() + Number(arg('--days')) * 864e5).toISOString() })).toString('base64url');
const sig = crypto.sign(null, Buffer.from('SIDEKICK-TRIAL-1.' + payload), key).toString('base64url');
fs.writeFileSync(arg('--out'), `SIDEKICK-TRIAL-1.${payload}.${sig}\n`, { flag: 'wx' });
