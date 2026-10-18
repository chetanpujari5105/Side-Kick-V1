// Keeps the generated copies of shared data in step with their sources:
//   data/releases.json   → data/releases.js        (window.SK_RELEASES for the pages)
//   data/roadmap-data.js → server/roadmap-ids.json (feature ids the API accepts for Notify me)
//   node scripts/data-sync.mjs                    rewrite the copies
//   node scripts/data-sync.mjs --check            exit 1 if a copy is stale or releases.json is invalid
//   node scripts/data-sync.mjs --from-dmg <path>  put the staged DMG's real size and SHA-256 into releases.json
//   node scripts/data-sync.mjs --verify-direct-url [url]
//        download the direct link (default: this repo's GitHub Release asset for the version and file) anonymously into
//        a scratch folder, check its size and SHA-256 against releases.json, delete the copy, and only then write
//        mac.directUrl. Nothing is written if anything differs. Never type the URL into releases.json by hand.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import os from 'node:os';
import { releaseProblems, publicReleases } from '../server/releases.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const P = (f) => path.join(ROOT, f);
const args = process.argv.slice(2);

const dmgAt = args.indexOf('--from-dmg');
if (dmgAt >= 0) {
  const file = args[dmgAt + 1];
  if (!file || !fs.existsSync(file)) { console.error('--from-dmg needs the path of the staged .dmg'); process.exit(2); }
  const r = JSON.parse(fs.readFileSync(P('data/releases.json'), 'utf8'));
  const b = r.mac.builds.arm64;
  if (path.basename(file) !== b.file && !args.includes('--force')) {
    console.error(`The file is called ${path.basename(file)} but releases.json expects ${b.file}. Rename it, or pass --force.`);
    process.exit(2);
  }
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 20); let n, total = 0;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) { hash.update(buf.subarray(0, n)); total += n; }
  fs.closeSync(fd);
  b.bytes = total; b.sha256 = hash.digest('hex');
  fs.writeFileSync(P('data/releases.json'), JSON.stringify(r, null, 2) + '\n');
  console.log(`releases.json: ${b.file} = ${total} bytes, sha256 ${b.sha256}`);
}

const verifyAt = args.indexOf('--verify-direct-url');
if (verifyAt >= 0) {
  const r = JSON.parse(fs.readFileSync(P('data/releases.json'), 'utf8'));
  const b = r.mac.builds.arm64;
  const arg = args[verifyAt + 1];
  const url = arg && !arg.startsWith('--') ? arg : `https://github.com/chetanpujari5105/Side-Kick-V1/releases/download/v${r.version}/${b.file}`;
  if (releaseProblems({ ...r, mac: { ...r.mac, directUrl: url } }).some(p => p.startsWith('mac.directUrl'))) { console.error(`Not a GitHub Release asset URL for ${b.file}: ${url}`); process.exit(2); }
  if (!b.bytes || !b.sha256) { console.error('releases.json has no bytes/sha256 to check against (run --from-dmg first).'); process.exit(2); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-verify-dmg-'));
  const file = path.join(dir, b.file);
  let total = 0, digest = '';
  try {
    // Anonymous: no cookie, no token, no auth header. Redirects (GitHub → its file host) are followed.
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'sidekick-data-sync' } });
    if (!res.ok || !res.body) { console.error(`HTTP ${res.status} for ${url}: nothing written.`); process.exit(1); }
    const hash = crypto.createHash('sha256'), out = fs.openSync(file, 'w', 0o600);
    for await (const chunk of res.body) { hash.update(chunk); fs.writeSync(out, chunk); total += chunk.length; }
    fs.closeSync(out);
    digest = hash.digest('hex');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`downloaded ${total} bytes, sha256 ${digest}; scratch copy deleted (${fs.existsSync(dir) ? 'NOT deleted' : 'gone'})`);
  if (total !== b.bytes || digest !== b.sha256) { console.error(`MISMATCH: releases.json says ${b.bytes} bytes, sha256 ${b.sha256}. mac.directUrl NOT written.`); process.exit(1); }
  r.mac.directUrl = url;
  fs.writeFileSync(P('data/releases.json'), JSON.stringify(r, null, 2) + '\n');
  console.log(`releases.json: mac.directUrl = ${url} (verified)`);
}

const releases = JSON.parse(fs.readFileSync(P('data/releases.json'), 'utf8'));
const problems = releaseProblems(releases);
if (problems.length) { console.error('data/releases.json is invalid: ' + problems.join('; ')); process.exit(1); }
const pub = publicReleases(releases); // no _comment, no mac.directUrl (server-only)
const releasesJs = `// GENERATED from data/releases.json by scripts/data-sync.mjs; do not edit by hand.\n// Release facts: 2.0.1, Apple silicon (arm64) only. Size and SHA-256 stay null until the staged DMG exists.\nwindow.SK_RELEASES = ${JSON.stringify(pub, null, 2)};\n`;

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(P('data/roadmap-data.js'), 'utf8'), sandbox);
const ids = sandbox.window.SK_ROADMAP.items.map(i => i.id);
if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) { console.error('roadmap ids must be short slugs'); process.exit(1); }
const idsJson = JSON.stringify({ _comment: 'GENERATED from data/roadmap-data.js by scripts/data-sync.mjs', ids }, null, 2) + '\n';

let stale = 0;
for (const [file, body] of [['data/releases.js', releasesJs], ['server/roadmap-ids.json', idsJson]]) {
  const cur = fs.existsSync(P(file)) ? fs.readFileSync(P(file), 'utf8') : null;
  if (cur === body) continue;
  stale++;
  if (args.includes('--check')) console.error(`${file} is out of date — run node scripts/data-sync.mjs`);
  else { fs.writeFileSync(P(file), body); console.log(`${file} written`); }
}
if (args.includes('--check') && stale) process.exit(1);
if (!stale) console.log('data copies up to date');
