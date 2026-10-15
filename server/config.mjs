// Reads and checks configuration from environment variables. Problems are reported by NAME only, never value.
export const DEFAULT_LIMITS = {
  signup_ip: [10, 3600], signup_email: [5, 3600],
  link_ip: [30, 3600],
  notify_ip: [20, 3600], notify_email: [5, 86400],
  feedback_ip: [5, 3600],
  download: [30, 3600],
  mail_address: [3, 3600] // emails we send to one address per hour, whatever triggers them
};

function limits(env) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_LIMITS)) {
    const v = env['RATE_LIMIT_' + k.toUpperCase()];
    const m = typeof v === 'string' && v.match(/^(\d{1,6})\/(\d{1,7})$/);
    out[k] = m ? [Number(m[1]), Number(m[2])] : def;
  }
  return out;
}

export function loadConfig(env = process.env) {
  const problems = [];
  const need = (name, test = (v) => !!v) => { if (!test(env[name])) problems.push(name); return env[name]; };
  const appOrigin = need('APP_ORIGIN', v => typeof v === 'string' && /^https?:\/\/[A-Za-z0-9.\-]+(:\d+)?$/.test(v));
  const sessionSecret = need('SESSION_SECRET', v => typeof v === 'string' && v.length >= 32);
  const storageProvider = (env.STORAGE_PROVIDER || 'github').toLowerCase();
  const emailProvider = (env.EMAIL_PROVIDER || 'outbox').toLowerCase();
  if (!['github', 'r2'].includes(storageProvider)) problems.push('STORAGE_PROVIDER');
  if (!['outbox', 'resend'].includes(emailProvider)) problems.push('EMAIL_PROVIDER');
  const cfg = {
    appOrigin,
    secure: typeof appOrigin === 'string' && appOrigin.startsWith('https://'),
    sessionSecrets: [sessionSecret, env.SESSION_SECRET_PREVIOUS].filter(v => typeof v === 'string' && v.length >= 32),
    databaseUrl: env.DATABASE_URL,
    turnstileSecret: env.TURNSTILE_SECRET,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    turnstileHostname: typeof appOrigin === 'string' ? appOrigin.replace(/^https?:\/\//, '').replace(/:\d+$/, '') : null,
    storageProvider,
    github: { token: env.GITHUB_RELEASES_TOKEN, repo: env.GITHUB_RELEASES_REPO, tag: env.GITHUB_RELEASE_TAG || null },
    r2: { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET },
    downloadTtl: Math.min(Math.max(Number(env.DOWNLOAD_URL_TTL) || 600, 60), 3600),
    emailProvider,
    resend: { apiKey: env.EMAIL_PROVIDER_KEY, from: env.EMAIL_FROM },
    adminSecret: env.ADMIN_AUTH_SECRET,
    signerSecret: env.ADMIN_AUTH_SIGNER_SECRET,
    cronSecret: env.CRON_SECRET,
    betaCapDefault: Number.isInteger(Number(env.BETA_CAP)) && Number(env.BETA_CAP) >= 0 ? Number(env.BETA_CAP) : 25,
    retentionSignupDays: Number(env.RETENTION_SIGNUP_DAYS) > 0 ? Number(env.RETENTION_SIGNUP_DAYS) : 365,
    limits: limits(env),
    problems
  };
  return cfg;
}

// The extra variables the real adapters need; checked when building them (api/index.mjs).
export function adapterProblems(cfg) {
  const p = [];
  if (!cfg.databaseUrl) p.push('DATABASE_URL');
  if (!cfg.turnstileSecret) p.push('TURNSTILE_SECRET');
  if (cfg.storageProvider === 'github') {
    if (!cfg.github.token) p.push('GITHUB_RELEASES_TOKEN');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.github.repo || '')) p.push('GITHUB_RELEASES_REPO');
  } else {
    if (!/^[0-9a-f]{32}$/.test(cfg.r2.accountId || '')) p.push('R2_ACCOUNT_ID');
    if (!cfg.r2.accessKeyId) p.push('R2_ACCESS_KEY_ID');
    if (!cfg.r2.secretAccessKey) p.push('R2_SECRET_ACCESS_KEY');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(cfg.r2.bucket || '')) p.push('R2_BUCKET');
  }
  if (cfg.emailProvider === 'resend') {
    if (!cfg.resend.apiKey) p.push('EMAIL_PROVIDER_KEY');
    if (!cfg.resend.from) p.push('EMAIL_FROM');
  }
  if (!cfg.adminSecret || cfg.adminSecret.length < 32) p.push('ADMIN_AUTH_SECRET');
  if (!cfg.signerSecret || cfg.signerSecret.length < 32) p.push('ADMIN_AUTH_SIGNER_SECRET');
  if (!cfg.cronSecret || cfg.cronSecret.length < 16) p.push('CRON_SECRET');
  return p;
}
