// TEST ONLY. Stands in for ConnectSuite's scripts/issue-trial-token.mjs with the same flags
// (--key --label --days --out). It signs with whatever key it is given — the tests give it a throwaway
// Ed25519 key generated in memory. The payload layout here is the test's own, not the app's.
import crypto from 'node:crypto';
import fs from 'node:fs';
const a = process.argv.slice(2), arg = (n) => a[a.indexOf(n) + 1];
const pem = fs.readFileSync(arg('--key'), 'utf8');
const key = crypto.createPrivateKey(pem);
const start = new Date(); start.setUTCHours(0, 0, 0, 0);
const payload = Buffer.from(JSON.stringify({ v: 1, id: crypto.randomBytes(6).toString('hex'), label: arg('--label'), start: start.toISOString(), end: new Date(start.getTime() + Number(arg('--days')) * 864e5).toISOString() })).toString('base64url');
const sig = crypto.sign(null, Buffer.from(payload), key).toString('base64url');
fs.writeFileSync(arg('--out'), `SIDEKICK-TRIAL-1.${payload}.${sig}\n`, { flag: 'wx' });
console.log('issued', arg('--label'));
