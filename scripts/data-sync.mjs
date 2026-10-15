// Keeps the generated copies of shared data in step with their sources:
//   data/releases.json   → data/releases.js        (window.SK_RELEASES for the pages)
//   data/roadmap-data.js → server/roadmap-ids.json (feature ids the API accepts for Notify me)
//   node scripts/data-sync.mjs                    rewrite the copies
//   node scripts/data-sync.mjs --check            exit 1 if a copy is stale or releases.json is invalid
//   node scripts/data-sync.mjs --from-dmg <path>  put the staged DMG's real size and SHA-256 into releases.json
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { releaseProblems } from '../server/releases.mjs';

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

const releases = JSON.parse(fs.readFileSync(P('data/releases.json'), 'utf8'));
const problems = releaseProblems(releases);
if (problems.length) { console.error('data/releases.json is invalid: ' + problems.join('; ')); process.exit(1); }
const { _comment, ...pub } = releases;
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
