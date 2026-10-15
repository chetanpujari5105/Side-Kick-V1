// Step 1 of docs/OWNER-SETUP.md, before any account exists: prove that a token made by THIS pipeline opens the
// real Mac app.
//   node scripts/token-proof.mjs [--label "Token proof"]
// It runs the API in memory on fake adapters (no network, no database, no email), makes one approved sign-up,
// and runs ONE signer cycle the way launchd will: the app's own issuer, your key (file mode, or
// SK_KEY_SOURCE=keychain), the same --label/--days/--out arguments, the same tokens folder. Then it tells you
// which .sidekick-token file to open in the Mac app (Open token file…). The token itself is not printed.
// Like any issue, the issuer adds one line to its own issued-tokens list. Same SK_* variables as the signer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { FakeBotCheck, FakeStorage, systemClock } from '../server/fakes.mjs';
import { loadConfig } from '../server/config.mjs';
import { createLogger } from '../server/log.mjs';
import { isTokenShaped } from '../server/validate.mjs';
import { runCycle, loadSignerConfig } from '../tools/signer/signer.mjs';
import { makeClient, keychainSecret } from '../tools/lib/client.mjs';
import releases from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const i = process.argv.indexOf('--label');
const label = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 'Token proof';
const O = 'http://localhost:8799';
const rnd = () => crypto.randomBytes(32).toString('hex');
const env = { APP_ORIGIN: O, SESSION_SECRET: rnd(), ADMIN_AUTH_SECRET: rnd(), ADMIN_AUTH_SIGNER_SECRET: rnd(), CRON_SECRET: rnd() };
const repo = new MemoryRepo();
const app = createApp({ config: loadConfig(env), repo, botCheck: new FakeBotCheck(), storage: new FakeStorage(systemClock, 600), mailer: null,
  clock: systemClock, log: createLogger(() => {}), releases, roadmapIds: roadmap.ids });

const cfg = loadSignerConfig();
const problems = [];
if (!fs.existsSync(cfg.issuer)) problems.push(`issuer not found at ${cfg.issuer} (set SK_ISSUER)`);
let pem = null;
if (cfg.keySource === 'keychain') { pem = keychainSecret(cfg.keyService); if (!pem || !pem.includes('PRIVATE KEY')) problems.push(`no PEM in Keychain item "${cfg.keyService}"`); }
else if (!fs.existsSync(cfg.keyFile)) problems.push(`key file not found at ${cfg.keyFile} (set SK_KEY_FILE)`);
if (problems.length) { console.error('Not ready:\n- ' + problems.join('\n- ')); process.exit(2); }

const now = Date.now();
const { signup } = await repo.upsertSignup({ email: 'token-proof@example.invalid', emailNorm: 'token-proof@example.invalid', name: label, macChip: 'apple', phoneModel: 'n/a', googleEmail: 'token-proof@example.invalid', marketingOptIn: false }, now);
await repo.confirmSignup(signup.id, now, 25);
await repo.markPlayAdded(['token-proof@example.invalid'], now); // PLAY_GATE is on by default: the owner's play-mark-added step
const post = makeClient({ base: O, keyId: 'signer', secret: env.ADMIN_AUTH_SIGNER_SECRET, fetch: (u, o) => app.fetch(new Request(u, o)) });
const res = await runCycle({ cfg, post, pem, mail: null, log: (m) => console.error(m) }); // no email: the token stays in the outbox, unsent
const file = path.join(cfg.tokensDir, `${signup.id}.sidekick-token`);
const stored = await repo.getSignup(signup.id);
const ok = res.issued === 1 && res.posted === 1 && fs.existsSync(file) && isTokenShaped(fs.readFileSync(file, 'utf8').trim()) && stored.state === 'issued';
console.log(`Signer cycle: ${JSON.stringify(res)} (issuer ${cfg.issuer}, key from ${cfg.keySource === 'keychain' ? 'Keychain' : cfg.keyFile})`);
if (!ok) { console.error('FAILED: no valid token came back through the pipeline.'); process.exit(1); }
console.log(`\nOK. The pipeline produced a token labelled "${label}":\n  ${file}\n`);
console.log('Now, in the Mac app: on the token screen choose "Open token file…" and pick that file');
console.log('(or Settings › About if the app already has a token). The app must accept it and show the end date.');
console.log('If it does, carry on with step 2 of docs/OWNER-SETUP.md. If not, stop: do not create any account yet.');
