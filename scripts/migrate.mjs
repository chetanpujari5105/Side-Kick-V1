// Creates or updates the database tables: schema version 1, then version 2. Idempotent: safe to run twice.
//   DATABASE_URL='postgres://…' node scripts/migrate.mjs
//   node scripts/migrate.mjs --url-file <file>     (the connection string read from a mode-600 file)
// The connection string is read from the environment or that file only, and never printed.
import fs from 'node:fs';
import { PgRepo, neonDb } from '../server/repo-pg.mjs';

const i = process.argv.indexOf('--url-file');
let url = process.env.DATABASE_URL;
if (i > 0) {
  const file = process.argv[i + 1];
  const mode = fs.statSync(file).mode & 0o777;
  if (mode & 0o077) { console.error(`${file} must be readable by you only (chmod 600); it is ${mode.toString(8)}.`); process.exit(2); }
  url = fs.readFileSync(file, 'utf8').trim();
}
if (!url) { console.error('Set DATABASE_URL in the environment or pass --url-file (see docs/OWNER-SETUP.md).'); process.exit(2); }
const repo = new PgRepo(await neonDb(url));
for (const f of ['schema.sql', 'schema-v2.sql']) await repo.migrate(fs.readFileSync(new URL('../server/' + f, import.meta.url), 'utf8'));
const rows = await repo.q('select max(version) as v from schema_migrations', []);
console.log(`Database ready: schema version ${rows[0].v}.`);
