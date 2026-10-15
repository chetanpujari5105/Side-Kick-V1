// The API: one Web-standard fetch handler. Every outside service comes in through an adapter, so the same code
// runs on Vercel (real adapters, api/index.mjs) and in tests, the demo and `npm run dev` (fakes).
import { json, html, redirect, readBody, parseCookies, clientIp, originAllowed, wantsHtml, newNonce, HttpError } from './http.mjs';
import { hmac, safeEqual, sha256hex, randomToken, signingString } from './crypto.mjs';
import { openSession, sessionCookie, COOKIE, SESSION_TTL_S } from './session.mjs';
import { validateSignup, validateFeedback, validateNotify, isTokenShaped, tokenLabel, normaliseEmail } from './validate.mjs';
import { publicReleases, releaseProblems } from './releases.mjs';
import { emails } from './emails.mjs';
import { linkPage, messagePage, signupFormPage, NO_JS_BOT, BOT_FAILED, RATE_TEXT, SERVER_TEXT } from './pages.mjs';

const H = 3600 * 1000;
const LINK = {
  signup_confirm: { ttl: 48 * H, uses: 1 },
  marketing_confirm: { ttl: 7 * 24 * H, uses: 1 },
  roadmap_confirm: { ttl: 7 * 24 * H, uses: 1 },
  access: { ttl: 72 * H, uses: 10 }
};
const ALLOWED = ['approved', 'issued', 'delivered'];
const STAGE = { pending_email: 'check_email', approved: 'approved', issued: 'approved', delivered: 'token_sent', waitlisted: 'waitlisted', denied: 'waitlisted' };
const SETTABLE = ['pending_email', 'approved', 'waitlisted', 'denied'];
const SIGNER_PATHS = new Set(['pending', 'token', 'outbox', 'outbox-ack']);
const CLAIM_TTL = 15 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createApp({ config, repo, botCheck, storage, mailer = null, clock, log, releases, roadmapIds = [] }) {
  const relProblems = releaseProblems(releases);
  const misconfigured = config.problems.length > 0 || relProblems.length > 0;
  if (misconfigured) log.error('config.invalid', { names: config.problems.concat(relProblems.map(p => 'releases:' + p)).join(',') });
  const secret = config.sessionSecrets[0];
  const keyFor = (purpose) => hmac(secret || 'unset', 'sk-key:' + purpose);
  const bucketKey = (k) => hmac(keyFor('ratelimit'), k).slice(0, 32);
  const features = new Set(roadmapIds);
  const now = () => clock.now();

  // ── helpers ────────────────────────────────────────────────────────────────
  async function limited(name, key) {
    const [max, sec] = config.limits[name];
    const win = sec * 1000, t = now();
    const start = Math.floor(t / win) * win;
    const count = await repo.hit(`${name}:${bucketKey(key)}`, start, t);
    if (count <= max) return null;
    return Math.max(1, Math.ceil((start + win - t) / 1000));
  }
  const tooMany = (retryAfter) => json(429, { ok: false, error: 'RATE_LIMITED', retryAfter }, { 'retry-after': String(retryAfter) });

  async function human(token, request) {
    if (typeof token !== 'string' || !token || token.length > 2048) return false;
    try { const r = await botCheck.verify(token, clientIp(request)); if (!r.ok) log.warn('botcheck.failed', { code: r.code }); return !!r.ok; }
    catch (e) { log.warn('botcheck.failed', { code: 'exception' }); return false; }
  }

  async function newLink(purpose, refId) {
    const t = randomToken(32);
    await repo.createLink({ hash: sha256hex(t), purpose, refId, expiresAt: now() + LINK[purpose].ttl, maxUses: LINK[purpose].uses }, now());
    return t;
  }
  const url = (path, t, extra = '') => `${config.appOrigin}${path}?t=${t}${extra}`;

  // Queues an email (always) and sends it at once when a server-side provider is configured.
  async function queueMail(msg, { to, signupId = null, capped = true }) {
    if (capped && await limited('mail_address', 'mail:' + to)) { log.info('mail.capped', { kind: msg.kind }); return; }
    const id = await repo.enqueue({ signupId, kind: msg.kind, toEmail: to, subject: msg.subject, text: msg.text }, now());
    log.info('mail.queued', { kind: msg.kind, signupId: signupId || undefined });
    if (mailer) {
      try {
        const r = await mailer.send({ to, subject: msg.subject, text: msg.text, idempotencyKey: id });
        await repo.ackOutbox(id, r.ok, r.code, now());
        if (!r.ok) log.warn('mail.failed', { kind: msg.kind, code: r.code });
      } catch { log.warn('mail.failed', { kind: msg.kind, code: 'exception' }); }
    }
  }

  function session(request) {
    const c = parseCookies(request)[COOKIE];
    return c ? openSession(c, config.sessionSecrets, now()) : null;
  }
  const setSession = (payload) => sessionCookie({ v: 1, iat: Math.floor(now() / 1000), exp: Math.floor(now() / 1000) + SESSION_TTL_S, ...payload }, secret, { secure: config.secure });
  const firstName = (name) => String(name || '').split(' ')[0].slice(0, 40);

  // ── signup ─────────────────────────────────────────────────────────────────
  async function getSidekick(request) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { data, form } = await readBody(request);
    const nonce = newNonce();
    const asPage = form || wantsHtml(request);
    const page = (status, o) => html(status, signupFormPage({ nonce, siteKey: config.turnstileSiteKey, values: data, ...o }), nonce);
    const v = validateSignup(data);
    if (!v.ok) {
      log.info('signup.invalid', { fields: Object.keys(v.fieldErrors).join(',') });
      return asPage ? page(400, { errors: v.fieldErrors }) : json(400, { ok: false, fieldErrors: v.fieldErrors });
    }
    const captcha = form ? data['cf-turnstile-response'] : data.captchaToken;
    if (!await human(captcha, request)) return asPage ? page(403, { banner: captcha ? BOT_FAILED : NO_JS_BOT }) : json(403, { ok: false, error: 'BOT_CHECK_FAILED' });
    const ra = (await limited('signup_ip', clientIp(request))) || (await limited('signup_email', 'email:' + v.value.emailNorm));
    if (ra) { log.info('signup.rate_limited'); return asPage ? page(429, { banner: RATE_TEXT }) : tooMany(ra); }
    let result;
    try {
      result = await repo.upsertSignup(v.value, now());
      const s = result.signup;
      if (s.state === 'pending_email') {
        const t = await newLink('signup_confirm', s.id);
        const u = s.marketingRequestedAt && !s.marketingConfirmedAt ? url('/api/confirm-email', await newLink('marketing_confirm', s.id), '&for=updates') : null;
        await queueMail(emails.confirm({ name: s.name, confirmUrl: url('/api/confirm-email', t), updatesUrl: u }), { to: s.emailNorm, signupId: s.id });
      } else if (ALLOWED.includes(s.state)) {
        await queueMail(emails.access({ name: s.name, accessUrl: url('/api/access', await newLink('access', s.id)) }), { to: s.emailNorm, signupId: s.id });
      }
    } catch (e) {
      log.error('signup.store_failed', { code: 'db' });
      return asPage ? page(503, { banner: SERVER_TEXT }) : json(503, { ok: false, error: 'SERVICE_UNAVAILABLE' });
    }
    log.info('signup.ok', { created: result.created });
    const cookie = setSession({ k: 'form', n: firstName(v.value.name) });
    return asPage ? redirect(303, '/check-email.html', { 'set-cookie': cookie }) : json(200, { ok: true }, { 'set-cookie': cookie });
  }

  // ── email links ────────────────────────────────────────────────────────────
  async function linkGet(request, path) {
    const t = new URL(request.url).searchParams.get('t') || '';
    const nonce = newNonce();
    const link = /^[A-Za-z0-9_-]{43}$/.test(t) ? await repo.peekLink(sha256hex(t), now()) : null;
    const purpose = !link ? 'confirm' : { signup_confirm: 'confirm', marketing_confirm: 'updates', roadmap_confirm: 'notify', access: 'access' }[link.purpose];
    const okPath = link && ((path === 'access') === (link.purpose === 'access'));
    return html(okPath ? 200 : 410, linkPage({ purpose, t, nonce, siteKey: config.turnstileSiteKey, valid: !!okPath }), nonce);
  }

  async function linkPost(request, path) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { data, form } = await readBody(request);
    const asPage = form || wantsHtml(request);
    const nonce = newNonce();
    const gone = () => asPage ? html(410, linkPage({ purpose: 'confirm', t: '', nonce, valid: false }), nonce) : json(410, { ok: false, error: 'LINK_EXPIRED' });
    const ra = await limited('link_ip', clientIp(request));
    if (ra) return asPage ? html(429, messagePage({ nonce, title: 'Too many tries', text: RATE_TEXT }).body, nonce) : tooMany(ra);
    const t = typeof data.t === 'string' ? data.t : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) return gone();
    if (!await human(form ? data['cf-turnstile-response'] : data.captchaToken, request))
      return asPage ? html(403, messagePage({ nonce, title: 'Human check failed', text: 'We couldn\'t confirm you\'re not a bot. It needs JavaScript: go back, turn it on and try again.' }).body, nonce) : json(403, { ok: false, error: 'BOT_CHECK_FAILED' });
    const peek = await repo.peekLink(sha256hex(t), now());
    if (!peek || ((path === 'access') !== (peek.purpose === 'access'))) return gone();
    const link = await repo.useLink(sha256hex(t), now());
    if (!link) return gone();
    log.info('link.used', { purpose: link.purpose });

    if (link.purpose === 'roadmap_confirm') {
      await repo.confirmNotify(link.refId, now());
      return asPage ? html(200, messagePage({ nonce, title: 'Confirmed', text: 'We\'ll email you once when it ships. That\'s all.' }).body, nonce) : json(200, { ok: true, stage: 'subscribed' });
    }
    if (link.purpose === 'marketing_confirm') {
      await repo.confirmMarketing(link.refId, now());
      return asPage ? html(200, messagePage({ nonce, title: 'Updates confirmed', text: 'We\'ll email you Sidekick updates. Every update has a one-click unsubscribe link.' }).body, nonce) : json(200, { ok: true, stage: 'subscribed' });
    }
    let s = await repo.getSignup(link.refId);
    if (!s) return gone();
    if (link.purpose === 'signup_confirm') {
      const state = await repo.confirmSignup(s.id, now(), config.betaCapDefault);
      log.info('signup.confirmed', { signupId: s.id, state });
      if (state === 'waitlisted' || state === 'denied') await queueMail(emails.waitlist({ name: s.name }), { to: s.emailNorm, signupId: s.id, capped: false });
      s = await repo.getSignup(s.id);
    }
    const cookie = setSession({ k: 'email', sid: s.id });
    const stage = STAGE[s.state] || 'check_email';
    return asPage ? redirect(303, '/Download.dc.html', { 'set-cookie': cookie }) : json(200, { ok: true, stage }, { 'set-cookie': cookie });
  }

  // ── session, download, releases ────────────────────────────────────────────
  async function getSession(request) {
    const p = session(request);
    if (!p) return json(401, { ok: false, error: 'NO_SESSION' });
    if (p.k === 'form') return json(200, { ok: true, session: { firstName: p.n || '', stage: 'check_email' } });
    const s = await repo.getSignup(p.sid);
    if (!s) return json(401, { ok: false, error: 'NO_SESSION' });
    return json(200, { ok: true, session: { firstName: firstName(s.name), stage: STAGE[s.state] || 'check_email' } });
  }

  async function download(request, parts) {
    const nav = wantsHtml(request);
    const deny = (status, error) => nav ? redirect(303, '/Download.dc.html') : json(status, { ok: false, error });
    const [platform, arch, extra] = parts;
    const isMac = platform === 'mac' && arch === 'arm64' && extra === undefined;
    const isAndroid = platform === 'android' && arch === undefined;
    if (!isMac && !isAndroid) return json(404, { ok: false, error: 'NOT_AVAILABLE' });
    const p = session(request);
    if (!p || p.k !== 'email') return deny(401, 'NO_SESSION');
    const s = await repo.getSignup(p.sid);
    if (!s) return deny(401, 'NO_SESSION');
    if (!ALLOWED.includes(s.state)) return deny(403, 'NOT_APPROVED');
    if (isAndroid && !releases.android.storeUrl) return json(404, { ok: false, error: 'NOT_AVAILABLE' });
    const ra = await limited('download', 'dl:' + s.id);
    if (ra) return tooMany(ra);
    let location;
    try {
      location = isMac ? (await storage.signedUrl({ file: releases.mac.builds.arm64.file, platform, arch, version: releases.version })).url : releases.android.storeUrl;
      await repo.logDownload({ signupId: s.id, platform, arch: isMac ? 'arm64' : null }, now());
    } catch {
      log.error('download.failed', { signupId: s.id, platform });
      return json(503, { ok: false, error: 'DOWNLOAD_UNAVAILABLE' });
    }
    log.info('download.ok', { signupId: s.id, platform });
    return redirect(302, location);
  }

  // ── roadmap notify, feedback ───────────────────────────────────────────────
  async function roadmapNotify(request) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { data } = await readBody(request, { allowForm: false });
    const v = validateNotify(data, features);
    if (!v.ok) return json(400, { ok: false, fieldErrors: v.fieldErrors });
    if (!await human(data.captchaToken, request)) return json(403, { ok: false, error: 'BOT_CHECK_FAILED' });
    const ra = (await limited('notify_ip', clientIp(request))) || (await limited('notify_email', 'n:' + v.value.email));
    if (ra) return tooMany(ra);
    try {
      const { row } = await repo.addNotify(v.value, now());
      if (!row.confirmedAt) await queueMail(emails.notify({ confirmUrl: url('/api/confirm-email', await newLink('roadmap_confirm', row.id)) }), { to: v.value.email });
    } catch { log.error('notify.store_failed'); return json(503, { ok: false, error: 'SERVICE_UNAVAILABLE' }); }
    return json(202, { ok: true });
  }

  async function feedback(request) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { data } = await readBody(request, { allowForm: false });
    const v = validateFeedback(data);
    if (!v.ok) return json(400, { ok: false, fieldErrors: v.fieldErrors });
    if (!await human(data.captchaToken, request)) return json(403, { ok: false, error: 'BOT_CHECK_FAILED' });
    const ra = await limited('feedback_ip', clientIp(request));
    if (ra) return tooMany(ra);
    try { await repo.addFeedback(v.value, now()); } catch { return json(503, { ok: false, error: 'SERVICE_UNAVAILABLE' }); }
    log.info('feedback.ok');
    return json(202, { ok: true });
  }

  // ── admin (HMAC) ───────────────────────────────────────────────────────────
  async function verifyAdmin(request, raw, action) {
    const key = request.headers.get('x-sk-key'), ts = request.headers.get('x-sk-ts'), nonce = request.headers.get('x-sk-nonce'), sig = request.headers.get('x-sk-sig');
    const sec = key === 'admin' ? config.adminSecret : key === 'signer' ? config.signerSecret : null;
    if (!sec || !/^\d{10,16}$/.test(ts || '') || !/^[0-9a-f]{32}$/.test(nonce || '') || !/^[0-9a-f]{64}$/.test(sig || '')) return 401;
    if (Math.abs(now() - Number(ts)) > 300000) return 401;
    const expect = hmac(sec, signingString({ method: request.method, path: '/api/admin/' + action, ts, nonce, body: raw }));
    if (!safeEqual(sig, expect)) return 401;
    if (!await repo.useNonce(nonce, now())) return 401;
    if (key === 'signer' && !SIGNER_PATHS.has(action)) return 403;
    return 0;
  }

  async function findPerson(d) {
    if (typeof d.signupId === 'string' && UUID.test(d.signupId)) return repo.getSignup(d.signupId);
    const e = normaliseEmail(d.email || '');
    return e ? repo.getSignupByEmail(e) : null;
  }

  async function adminRoute(request, action) {
    const raw = await request.clone().text();
    const bad = await verifyAdmin(request, raw, action);
    if (bad) { log.warn('admin.refused', { status: bad }); return json(bad, { ok: false, error: bad === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' }); }
    const { data } = await readBody(request, { allowForm: false });
    log.info('admin.call', { action });
    switch (action) {
      case 'pending': {
        const rows = await repo.claimPending(now(), 10, CLAIM_TTL);
        return json(200, { ok: true, pending: rows.map(r => ({ signupId: r.id, label: tokenLabel(r.name) })) });
      }
      case 'token': {
        if (typeof data.signupId !== 'string' || !UUID.test(data.signupId) || !isTokenShaped(data.token)) return json(400, { ok: false, error: 'BAD_TOKEN' });
        const r = await repo.storeToken(data.signupId, data.token, now());
        if (r === 'not_found') return json(404, { ok: false, error: 'NOT_FOUND' });
        if (r === 'conflict') return json(409, { ok: false, error: 'ALREADY_ISSUED' });
        const s = await repo.getSignup(data.signupId);
        await queueMail(emails.token({ name: s.name, token: data.token, accessUrl: url('/api/access', await newLink('access', s.id)) }), { to: s.emailNorm, signupId: s.id, capped: false });
        log.info('token.stored', { signupId: s.id });
        return json(200, { ok: true });
      }
      case 'outbox': {
        const rows = await repo.claimOutbox(now(), 20, CLAIM_TTL);
        return json(200, { ok: true, messages: rows.map(m => ({ id: m.id, kind: m.kind, to: m.toEmail, subject: m.subject, text: m.text })) });
      }
      case 'outbox-ack': {
        if (typeof data.id !== 'string' || !UUID.test(data.id)) return json(400, { ok: false, error: 'BAD_ID' });
        const done = await repo.ackOutbox(data.id, data.ok === true, typeof data.errorCode === 'string' ? data.errorCode.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : null, now());
        return json(done ? 200 : 404, { ok: done });
      }
      case 'stats': return json(200, { ok: true, ...(await repo.stats()), betaCap: (await repo.getSettings(config.betaCapDefault)).betaCap });
      case 'export': return json(200, { ok: true, csv: toCsv(await repo.exportSignups()) });
      case 'set-state': {
        if (!SETTABLE.includes(data.state)) return json(400, { ok: false, error: 'BAD_STATE' });
        const s = await findPerson(data);
        if (!s) return json(404, { ok: false, error: 'NOT_FOUND' });
        await repo.setState(s.id, data.state, now());
        return json(200, { ok: true });
      }
      case 'delete': {
        const s = await findPerson(data);
        const n = s ? await repo.deleteSignup(s.id) : 0;
        log.info('admin.deleted', { count: n });
        return json(200, { ok: true, deleted: n });
      }
      case 'settings': {
        const patch = {};
        if (data.betaCap !== undefined) { if (!Number.isInteger(data.betaCap) || data.betaCap < 0 || data.betaCap > 100000) return json(400, { ok: false, error: 'BAD_CAP' }); patch.betaCap = data.betaCap; }
        for (const k of ['allow', 'deny']) if (data[k] !== undefined) {
          if (!Array.isArray(data[k]) || data[k].length > 500) return json(400, { ok: false, error: 'BAD_LIST' });
          const list = data[k].map(x => String(x).trim().toLowerCase());
          if (list.some(x => !(normaliseEmail(x) || /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))) return json(400, { ok: false, error: 'BAD_LIST' });
          patch[k] = list;
        }
        if (Object.keys(patch).length) await repo.setSettings(patch);
        return json(200, { ok: true, settings: await repo.getSettings(config.betaCapDefault) });
      }
      case 'promote': return json(200, { ok: true, promoted: await repo.promote(now(), config.betaCapDefault) });
      case 'retention': return json(200, { ok: true, ...(await runRetention()) });
      default: return json(404, { ok: false, error: 'NOT_FOUND' });
    }
  }

  async function runRetention() {
    const removed = await repo.retention(now(), { signupDays: config.retentionSignupDays });
    const promoted = await repo.promote(now(), config.betaCapDefault);
    log.info('retention.done', { ...removed, promoted });
    return { removed, promoted };
  }

  // ── router ─────────────────────────────────────────────────────────────────
  async function route(request) {
    const u = new URL(request.url);
    // Vercel rewrites /api/* to /api/index?__route=*; locally the path arrives as is.
    const path = u.pathname.startsWith('/api/') && u.pathname !== '/api/index' ? u.pathname.slice(5) : (u.searchParams.get('__route') || '');
    const parts = path.split('/').filter(Boolean);
    const m = request.method;
    const only = (method, fn) => m === method ? fn() : json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: method });
    if (parts[0] === 'health' && parts.length === 1) return only('GET', () => misconfigured ? json(503, { ok: false, error: 'MISCONFIGURED' }) : json(200, { ok: true }));
    if (misconfigured) return json(503, { ok: false, error: 'MISCONFIGURED' });
    switch (parts[0]) {
      case 'get-sidekick': if (parts.length === 1) return only('POST', () => getSidekick(request)); break;
      case 'confirm-email': if (parts.length === 1) return m === 'GET' ? linkGet(request, 'confirm') : only('POST', () => linkPost(request, 'confirm')); break;
      case 'access': if (parts.length === 1) return m === 'GET' ? linkGet(request, 'access') : only('POST', () => linkPost(request, 'access')); break;
      case 'session': if (parts.length === 1) return only('GET', () => getSession(request)); break;
      case 'download': return only('GET', () => download(request, parts.slice(1)));
      case 'releases': if (parts.length === 1) return only('GET', () => json(200, publicReleases(releases))); break;
      case 'roadmap-notify': if (parts.length === 1) return only('POST', () => roadmapNotify(request)); break;
      case 'feedback': if (parts.length === 1) return only('POST', () => feedback(request)); break;
      case 'admin': if (parts.length === 2) return only('POST', () => adminRoute(request, parts[1])); break;
      case 'cron':
        if (parts[1] === 'retention' && parts.length === 2) return only('GET', async () => {
          const auth = request.headers.get('authorization') || '';
          if (!config.cronSecret || !safeEqual(auth, 'Bearer ' + config.cronSecret)) return json(401, { ok: false, error: 'UNAUTHORIZED' });
          return json(200, { ok: true, ...(await runRetention()) });
        });
        break;
    }
    return json(404, { ok: false, error: 'NOT_FOUND' });
  }

  return {
    roadmapIds,
    async fetch(request) {
      try { return await route(request); }
      catch (e) {
        if (e instanceof HttpError) return json(e.status, { ok: false, error: e.code });
        log.error('request.failed', { code: (e && e.name) || 'Error' });
        return json(500, { ok: false, error: 'INTERNAL' });
      }
    }
  };
}

function toCsv(rows) {
  const cols = ['id', 'created_at', 'state', 'name', 'email', 'mac_chip', 'phone_model', 'marketing_confirmed_at', 'confirmed_at', 'approved_at', 'token_issued_at', 'token_emailed_at', 'downloads'];
  const pick = (r) => [r.id, r.createdAt, r.state, r.name, r.email, r.macChip, r.phoneModel, r.marketingConfirmedAt, r.confirmedAt, r.approvedAt, r.tokenIssuedAt, r.tokenEmailedAt, r.downloads];
  const cell = (v) => {
    let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(',')].concat(rows.map(r => pick(r).map(cell).join(','))).join('\n') + '\n';
}
