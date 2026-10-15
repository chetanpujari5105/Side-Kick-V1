// Creates or updates the database tables. Idempotent: safe to run twice.
//   DATABASE_URL='postgres://…' node scripts/migrate.mjs
// The connection string is read from the environment only and never printed.
import fs from 'node:fs';
import { PgRepo, neonDb } from '../server/repo-pg.mjs';

if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL in the environment first (see docs/OWNER-SETUP.md).'); process.exit(2); }
const schema = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
const repo = new PgRepo(await neonDb(process.env.DATABASE_URL));
await repo.migrate(schema);
const rows = await repo.q('select max(version) as v from schema_migrations', []);
console.log(`Database ready: schema version ${rows[0].v}.`);
