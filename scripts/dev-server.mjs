// Local preview of the REAL site and API on fake adapters — no accounts, no network, nothing stored on disk.
//   npm run dev                (builds dist/ with --local, serves http://localhost:8787)
// Emails go to an in-memory outbox; open http://localhost:8787/__dev/outbox to read them and click their links.
// The human check is a local stand-in; downloads redirect to a fake file host. Never deploy this file's setup.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/app.mjs';
import { MemoryRepo } from '../server/repo-memory.mjs';
import { FakeBotCheck, FakeStorage, systemClock } from '../server/fakes.mjs';
import { loadConfig } from '../server/config.mjs';
import { createLogger } from '../server/log.mjs';
import releases from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };

// mode 'automated' (default): the real API on fake adapters. mode 'manual': the SITE_MODE=manual build, and every
// /api/* request is a 404 that is also recorded in apiHits (a manual site must never make one).
export async function startDevServer({ port = 8787, build = true, quiet = false, env = {}, mode = 'automated', releases: rel = releases } = {}) {
  const manual = mode === 'manual';
  if (build) execFileSync(process.execPath, manual ? [path.join(ROOT, 'scripts/build-site.mjs')] : [path.join(ROOT, 'scripts/build-site.mjs'), '--local'], { stdio: quiet ? 'ignore' : 'inherit', env: manual ? { PATH: process.env.PATH, SITE_MODE: 'manual' } : process.env });
  const DIST = path.join(ROOT, 'dist');
  const origin = `http://localhost:${port}`;
  const secrets = { SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_AUTH_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_AUTH_SIGNER_SECRET: crypto.randomBytes(32).toString('hex'), CRON_SECRET: crypto.randomBytes(16).toString('hex') };
  const config = loadConfig({ APP_ORIGIN: origin, TURNSTILE_SITE_KEY: 'local-dev-fake', ...secrets, ...env });
  const repo = new MemoryRepo();
  const botCheck = new FakeBotCheck();
  const storage = new FakeStorage(systemClock, config.downloadTtl);
  const logs = [];
  const log = createLogger(l => { logs.push(l); if (!quiet) console.log(l); });
  const app = createApp({ config, repo, botCheck, storage, mailer: null, clock: systemClock, log, releases: rel, roadmapIds: roadmap.ids });
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  // The same headers Vercel sends: the catch-all page rule, plus any rule for one exact path (e.g. /Beta.dc.html).
  const rule = vercel.headers.find(h => h.source === '/((?!api/).*)');
  if (!rule) throw new Error('vercel.json: the page header rule /((?!api/).*) is missing');
  const pageHeaders = Object.fromEntries(rule.headers.map(h => [h.key, h.value]));
  const exactHeaders = (p) => Object.fromEntries(vercel.headers.filter(h => h.source === p).flatMap(h => h.headers.map(x => [x.key, x.value])));
  const apiHits = [];

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, origin);
    // vercel.json rewrites /download/mac to the API function; do the same here.
    if ((u.pathname.startsWith('/api/') || u.pathname === '/download/mac') && manual) {
      apiHits.push(req.method + ' ' + u.pathname);
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('No API in a SITE_MODE=manual build.');
    }
    if (u.pathname.startsWith('/api/') || u.pathname === '/download/mac') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      headers.set('x-real-ip', req.socket.remoteAddress || '127.0.0.1');
      const r = await app.fetch(new Request(origin + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const out = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (sc.length) out['set-cookie'] = sc;
      res.writeHead(r.status, out);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (u.pathname === '/__dev/outbox') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(repo.debugOutbox().map(m => ({ id: m.id, kind: m.kind, to: m.toEmail, subject: m.subject, text: m.text })), null, 2));
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/Home.dc.html';
    const f = path.join(DIST, p);
    const ok = f.startsWith(DIST + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile();
    res.writeHead(ok ? 200 : 404, { ...pageHeaders, ...exactHeaders(u.pathname), 'Cache-Control': 'no-store', 'Content-Type': ok ? (TYPES[path.extname(f)] || 'application/octet-stream') : TYPES['.html'] });
    fs.createReadStream(ok ? f : path.join(DIST, '404.html')).pipe(res);
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { origin, server, repo, botCheck, storage, logs, secrets, config, mode, apiHits, close: () => new Promise(r => server.close(r)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT) || 8787;
  const env = process.env.ADMIN_AUTH_SIGNER_SECRET ? { ADMIN_AUTH_SIGNER_SECRET: process.env.ADMIN_AUTH_SIGNER_SECRET } : {};
  const mode = process.env.SITE_MODE === 'manual' ? 'manual' : 'automated';
  const s = await startDevServer({ port, env, mode });
  if (mode === 'manual') console.log(`\nSidekick (SITE_MODE=manual: email only, no API) at ${s.origin}\n`);
  else console.log(`\nSidekick (real mode, fake adapters) at ${s.origin}\nEmails: ${s.origin}/__dev/outbox\nTo try tools/signer here, start this server with ADMIN_AUTH_SIGNER_SECRET set and give the signer the same value as SK_SIGNER_SECRET.\n`);
}
