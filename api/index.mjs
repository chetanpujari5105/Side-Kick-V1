// The one Vercel Function. vercel.json rewrites /api/* here; server/app.mjs routes by path.
// Real adapters are built once per instance from environment variables (docs/OWNER-SETUP.md lists them).
import { createApp } from '../server/app.mjs';
import { loadConfig, adapterProblems } from '../server/config.mjs';
import { createLogger } from '../server/log.mjs';
import { PgRepo, neonDb } from '../server/repo-pg.mjs';
import { TurnstileBotCheck, GitHubReleaseStorage, R2Storage, ResendMailer } from '../server/adapters.mjs';
import { systemClock } from '../server/fakes.mjs';
import releases from '../data/releases.json' with { type: 'json' };
import roadmap from '../server/roadmap-ids.json' with { type: 'json' };

let appPromise = null;

async function build() {
  const config = loadConfig(process.env);
  const log = createLogger();
  config.problems.push(...adapterProblems(config));
  const ok = config.problems.length === 0;
  const repo = ok ? new PgRepo(await neonDb(config.databaseUrl)) : null;
  const botCheck = ok ? new TurnstileBotCheck({ secret: config.turnstileSecret, hostname: config.turnstileHostname }) : null;
  const storage = !ok ? null : config.storageProvider === 'r2'
    ? new R2Storage({ ...config.r2, ttl: config.downloadTtl, clock: systemClock })
    : new GitHubReleaseStorage({ token: config.github.token, repo: config.github.repo, tag: config.github.tag });
  const mailer = ok && config.emailProvider === 'resend' ? new ResendMailer({ apiKey: config.resend.apiKey, from: config.resend.from }) : null;
  return createApp({ config, repo, botCheck, storage, mailer, clock: systemClock, log, releases, roadmapIds: roadmap.ids });
}

export default {
  async fetch(request) {
    appPromise ||= build().catch((e) => { appPromise = null; throw e; });
    const app = await appPromise;
    return app.fetch(request);
  }
};
