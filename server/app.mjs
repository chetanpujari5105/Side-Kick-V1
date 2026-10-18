// The API: one Web-standard fetch handler. Every outside service comes in through an adapter, so the same code
// runs on Vercel (real adapters, api/index.mjs) and in tests, the demo and `npm run dev` (fakes).
import { json, html, redirect, readBody, parseCookies, clientIp, originAllowed, wantsHtml, newNonce, HttpError } from './http.mjs';
import { hmac, safeEqual, sha256hex, randomToken, signingString } from './crypto.mjs';
import { openSession, sessionCookie, COOKIE, SESSION_TTL_S } from './session.mjs';
import { validateSignup, validateFeedback, validateNotify, isTokenShaped, tokenLabel, normaliseEmail } from './validate.mjs';
import { publicReleases, releaseProblems } from './releases.mjs';
import { emails } from './emails.mjs';
import { linkPage, messagePage, signupFormPage, resultPage, alreadyPage, NO_JS_BOT, BOT_FAILED, RATE_TEXT, SERVER_TEXT } from './pages.mjs';
import { poolRules, poolTokenEnd, POOL_ADD_MAX } from './pool.mjs';

const H = 3600 * 1000;
const LINK = {
  signup_confirm: { ttl: 48 * H, uses: 1 },
  marketing_confirm: { ttl: 7 * 24 * H, uses: 1 },
  roadmap_confirm: { ttl: 7 * 24 * H, uses: 1 },
  access: { ttl: 72 * H, uses: 10 },
  unsubscribe: { ttl: 365 * 24 * H, uses: 1 }
};
const ALLOWED = ['approved', 'play_added', 'issued', 'delivered'];
const STAGE = { pending_email: 'check_email', approved: 'approved', play_added: 'approved', issued: 'approved', delivered: 'token_sent', waitlisted: 'waitlisted', denied: 'waitlisted' };
const SETTABLE = ['pending_email', 'approved', 'waitlisted', 'denied'];
const SIGNER_PATHS = new Set(['pending', 'token', 'outbox', 'outbox-ack', 'queue', 'pool-add', 'pool-status', 'pool-prune', 'android-pending', 'android-added']);
const CLAIM_TTL = 15 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export function createApp({ config, repo, botCheck, storage, mailer = null, clock, log, releases, roadmapIds = [], schemas = [] }) {
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
  // The token rides in the #fragment, which browsers never send: it stays out of request logs and Referer headers.
  const url = (path, t, extra = '') => `${config.appOrigin}${path}${extra ? '?' + extra : ''}#t=${t}`;

  // Queues an email (always) and sends it at once when a server-side provider is configured.
  async function queueMail(msg, { to, signupId = null, capped = true }) {
    if (capped && ((await limited('mail_address', 'mail:' + to)) || (await limited('mail_address_day', 'mailday:' + to)))) { log.info('mail.capped', { kind: msg.kind }); return; }
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
  // The Mac download everyone is sent to: GET /download/mac redirects to the asset, so it can move without new pages.
  const DOWNLOAD_PATH = '/download/mac';
  const downloadUrl = config.appOrigin + DOWNLOAD_PATH;
  const stageOf = (s) => s.tokenSource === 'pool' && s.state === 'delivered' ? 'token_shown' : (STAGE[s.state] || 'check_email');

  // ── instant tokens (launch log Part 7) ─────────────────────────────────────
  // A sign-up gets a pool token on the page when: the daily cap allows it, its address isn't on the deny list, the
  // beta isn't full (allow-listed addresses skip that), this IP hasn't had 3 in the hour, and the pool has a token
  // with 35+ days left. Otherwise null: that sign-up takes the email flow. A database error is also just null.
  async function instantToken(s, request) {
    if (config.signupDailyCap <= 0) return null;
    try {
      const set = await repo.getSettings(config.betaCapDefault);
      const on = (list) => list.some(p => p === s.emailNorm || p === '@' + s.emailNorm.split('@')[1]);
      if (on(set.deny)) return null;
      if (!on(set.allow)) { const c = (await repo.stats()).signups; if (c.approved + c.play_added + c.issued + c.delivered >= set.betaCap) return null; }
      // The per-IP count is taken only when a token could be handed out, so it counts tokens, not email-flow sign-ups.
      const st = await repo.poolStatus(now(), poolRules(now()));
      if (!st.ready || st.issuedToday >= config.signupDailyCap) { log.info('signup.instant_unavailable'); return null; }
      if (await limited('instant_ip', clientIp(request))) { log.info('signup.instant_ip_limited'); return null; }
      const t = await repo.issuePoolToken(s.id, now(), { ...poolRules(now()), dailyCap: config.signupDailyCap });
      log.info(t ? 'signup.instant' : 'signup.instant_unavailable', t ? { signupId: s.id } : {});
      return t;
    } catch { log.warn('signup.instant_failed', { code: 'db' }); return null; }
  }
  const downloadInfo = () => {
    const b = releases.mac.builds.arm64;
    return { url: DOWNLOAD_PATH, auto: !!releases.mac.directUrl, file: b.file, bytes: b.bytes, sha256: b.sha256 };
  };
  // Queues the Android invitation of an instant sign-up once (after play-mark-added or the Google Group add).
  async function androidInvite(id) {
    const s = await repo.getSignup(id);
    if (!s || !s.googleEmail || !(await repo.markAndroidInvited(s.id, now()))) return;
    await queueMail(emails.android({ name: s.name, release: releases, googleEmail: s.googleEmail }), { to: s.emailNorm, signupId: s.id, capped: false });
  }
  async function copyMail(s, capped = true) {
    const token = (await repo.poolTokenFor(s.id)) || s.token || null;
    await queueMail(emails.copy({ name: s.name, token, downloadUrl, release: releases }), { to: s.emailNorm, signupId: s.id, capped });
  }

  // ── signup ─────────────────────────────────────────────────────────────────
  async function getSidekick(request) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { data, form } = await readBody(request);
    const nonce = newNonce();
    const asPage = form || wantsHtml(request);
    const page = (status, o) => html(status, signupFormPage({ nonce, siteKey: config.turnstileSiteKey, values: data, ...o }), nonce);
    // The kill switch: SITE_MODE=manual closes the API too (the manual build serves the email-only page there).
    if (config.signupClosed) { log.info('signup.closed'); return asPage ? redirect(303, '/Get%20Sidekick.dc.html') : json(503, { ok: false, error: 'SIGNUP_CLOSED' }); }
    const v = validateSignup(data);
    if (!v.ok) {
      log.info('signup.invalid', { fields: Object.keys(v.fieldErrors).join(',') });
      return asPage ? page(400, { errors: v.fieldErrors }) : json(400, { ok: false, fieldErrors: v.fieldErrors });
    }
    const captcha = form ? data['cf-turnstile-response'] : data.captchaToken;
    if (!await human(captcha, request)) return asPage ? page(403, { banner: captcha ? BOT_FAILED : NO_JS_BOT }) : json(403, { ok: false, error: 'BOT_CHECK_FAILED' });
    const ra = (await limited('signup_ip', clientIp(request))) || (await limited('signup_email', 'email:' + v.value.emailNorm));
    if (ra) { log.info('signup.rate_limited'); return asPage ? page(429, { banner: RATE_TEXT }) : tooMany(ra); }
    let result, outcome = 'check_email', token = null, s;
    try {
      result = await repo.upsertSignup(v.value, now());
      s = result.signup;
      // The updates choice is this submission's alone (launch log Part 6): sent again unticked, an unconfirmed request
      // is withdrawn (its old link stops working); ticked, it is asked for again, but only by its own confirm link.
      const wantsUpdates = v.value.marketingOptIn === true && s.state === 'pending_email';
      if (!result.created && (wantsUpdates || v.value.marketingOptIn !== true)) s = (await repo.setMarketingRequest(s.id, wantsUpdates, now())) || s;
      const updatesUrl = async () => wantsUpdates && s.marketingRequestedAt && !s.marketingConfirmedAt ? url('/api/confirm-email', await newLink('marketing_confirm', s.id), 'for=updates') : null;
      if (s.state === 'pending_email' && (token = await instantToken(s, request))) {
        // You're in: the token is on the page; no confirmation email (it is no longer a gate for the download).
        outcome = 'in';
        s = (await repo.getSignup(s.id)) || s;
        const u = await updatesUrl();
        if (u) await queueMail(emails.updates({ name: s.name, updatesUrl: u }), { to: s.emailNorm, signupId: s.id });
      } else if (s.state === 'pending_email') {
        // The email flow (pool empty, daily cap, beta full): confirm, then the signer makes this person a token.
        const t = await newLink('signup_confirm', s.id);
        await queueMail(emails.confirm({ name: s.name, confirmUrl: url('/api/confirm-email', t), updatesUrl: await updatesUrl(), downloadUrl, android: !!s.googleEmail }), { to: s.emailNorm, signupId: s.id });
      } else if (s.state === 'delivered') {
        // Already has a token: NEVER shown again here (anyone could type this address). A copy goes to the address.
        outcome = 'already';
        await copyMail(s);
      } else if (ALLOWED.includes(s.state)) {
        outcome = 'already'; // in, token still on its way: the download link now, the token in its own email
        await queueMail(emails.access({ name: s.name, downloadUrl }), { to: s.emailNorm, signupId: s.id });
      } else {
        await queueMail(emails.waitlist({ name: s.name }), { to: s.emailNorm, signupId: s.id }); // waitlisted and denied read the same
      }
    } catch (e) {
      log.error('signup.store_failed', { code: 'db' });
      return asPage ? page(503, { banner: SERVER_TEXT }) : json(503, { ok: false, error: 'SERVICE_UNAVAILABLE' });
    }
    log.info('signup.ok', { created: result.created, outcome });
    if (outcome === 'in') {
      const cookie = setSession({ k: 'in', sid: s.id });
      const android = s.googleEmail ? config.androidAccess : null;
      if (asPage) return html(200, resultPage({ nonce, firstName: firstName(s.name), token, download: downloadInfo(), release: releases, android }), nonce, { 'set-cookie': cookie });
      return json(200, { ok: true, stage: 'in', firstName: firstName(s.name), token, download: downloadInfo(), android }, { 'set-cookie': cookie });
    }
    if (outcome === 'already') return asPage ? html(200, alreadyPage({ nonce }), nonce) : json(200, { ok: true, stage: 'already' });
    const cookie = setSession({ k: 'form', n: firstName(v.value.name) });
    return asPage ? redirect(303, '/check-email.html', { 'set-cookie': cookie }) : json(200, { ok: true, stage: 'check_email' }, { 'set-cookie': cookie });
  }

  // ── "Email me a copy" ──────────────────────────────────────────────────────
  // Only the browser that saw the result page (its sk_session of kind 'in') may ask, and only once per sign-up.
  async function emailCopy(request) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { form } = await readBody(request);
    const asPage = form || wantsHtml(request);
    const nonce = newNonce();
    const page = (status, title, text) => html(status, messagePage({ nonce, title, text }).body, nonce);
    const p = session(request);
    const s = p && p.k === 'in' ? await repo.getSignup(p.sid) : null;
    if (!s) return asPage ? page(401, 'Nothing to send', 'This browser has no sign-up to copy. Fill in the Get Sidekick form; if you already did, we have emailed you your link.') : json(401, { ok: false, error: 'NO_SESSION' });
    const ra = await limited('link_ip', clientIp(request));
    if (ra) return asPage ? page(429, 'Too many tries', RATE_TEXT) : tooMany(ra);
    if (!(await repo.markCopyEmailed(s.id, now()))) return asPage ? page(200, 'Already on its way', 'We have already queued your copy. It comes from our own mailbox, so it can take a while: check your spam folder too.') : json(200, { ok: true, stage: 'already_sent' });
    await copyMail(s);
    log.info('copy.queued', { signupId: s.id });
    return asPage ? page(200, 'On its way', 'We\'ll email you a copy: the download link, your token and the install steps. It comes from our own mailbox, so it can take a while.') : json(202, { ok: true, stage: 'queued' });
  }

  // ── GET /download/mac ──────────────────────────────────────────────────────
  // Public, no session and no JavaScript: a 302 to the verified direct download, or to the Drive folder while there is
  // none. Each hit adds one to a per-day counter (no IP, no sign-up). Limited per IP; a database problem never blocks it.
  async function downloadMac(request) {
    const nonce = newNonce();
    let ra = null;
    try { ra = await limited('download_ip', clientIp(request)); } catch { log.warn('download.limit_failed', { code: 'db' }); }
    if (ra) return html(429, messagePage({ nonce, title: 'Too many downloads', text: `This address has started the download many times in the last hour. Please try again in about ${Math.ceil(ra / 60)} minutes.` }).body, nonce, { 'retry-after': String(ra) });
    const direct = releases.mac.directUrl || null, target = direct ? 'direct' : 'drive';
    const location = direct || releases.mac.betaDriveUrl;
    if (!location) return html(404, messagePage({ nonce, title: 'Not available yet', text: 'The Mac download isn\'t available yet.' }).body, nonce);
    if (request.method === 'GET') {
      try { await repo.countDownload({ platform: 'mac', target }, now()); } catch { log.warn('download.count_failed', { code: 'db' }); }
      log.info('download.mac', { target });
    }
    return redirect(302, location, { 'x-robots-tag': 'noindex' });
  }

  // ── email links ────────────────────────────────────────────────────────────
  // GET never sees the token (it is in the fragment) and changes nothing; the page's own script moves the token
  // into the form. Validity is checked on POST.
  async function linkGet(request, path) {
    const f = new URL(request.url).searchParams.get('for');
    const purpose = path === 'access' ? 'access' : f === 'updates' ? 'updates' : f === 'notify' ? 'notify' : 'confirm';
    const nonce = newNonce();
    return html(200, linkPage({ purpose, nonce, siteKey: config.turnstileSiteKey, valid: true }), nonce);
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
    if (!peek || peek.purpose === 'unsubscribe' || ((path === 'access') !== (peek.purpose === 'access'))) return gone();
    const link = await repo.useLink(sha256hex(t), now());
    if (!link) return gone();
    log.info('link.used', { purpose: link.purpose });

    if (link.purpose === 'roadmap_confirm') {
      await repo.confirmNotify(link.refId, now());
      return asPage ? html(200, messagePage({ nonce, title: 'Confirmed', text: 'We\'ll email you once when it ships. That\'s all.' }).body, nonce) : json(200, { ok: true, stage: 'subscribed' });
    }
    if (link.purpose === 'marketing_confirm') {
      await repo.confirmMarketing(link.refId, now());
      return asPage ? html(200, messagePage({ nonce, title: 'Updates confirmed', text: 'We\'ll email you Sidekick updates. To stop them, write to us at the address on our Privacy page.' }).body, nonce) : json(200, { ok: true, stage: 'subscribed' });
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

  // ── unsubscribe (update emails) ────────────────────────────────────────────
  // The link in each update email: GET is a page that changes nothing; POST with the one-use token stops updates.
  // No human check: the unguessable token is the permission, and a person leaving a list shouldn't meet a puzzle.
  async function unsubscribePost(request) {
    if (!originAllowed(request, config.appOrigin)) return json(403, { ok: false, error: 'BAD_ORIGIN' });
    const { data, form } = await readBody(request);
    const asPage = form || wantsHtml(request);
    const nonce = newNonce();
    const gone = () => asPage ? html(410, messagePage({ nonce, title: 'Link already used', text: 'This unsubscribe link has been used or has expired. If you still get update emails, reply to one with "unsubscribe" and we\'ll remove you.' }).body, nonce) : json(410, { ok: false, error: 'LINK_EXPIRED' });
    const ra = await limited('link_ip', clientIp(request));
    if (ra) return asPage ? html(429, messagePage({ nonce, title: 'Too many tries', text: RATE_TEXT }).body, nonce) : tooMany(ra);
    const t = typeof data.t === 'string' ? data.t : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) return gone();
    const peek = await repo.peekLink(sha256hex(t), now());
    if (!peek || peek.purpose !== 'unsubscribe') return gone();
    const link = await repo.useLink(sha256hex(t), now());
    if (!link) return gone();
    const s = await repo.getSignup(link.refId);
    if (s) await repo.unsubscribe(s.emailNorm, now());
    log.info('link.used', { purpose: 'unsubscribe' });
    return asPage ? html(200, messagePage({ nonce, title: 'Unsubscribed', text: 'We won\'t send you Sidekick update emails any more. Emails about your own beta place, if you have one, still come.' }).body, nonce) : json(200, { ok: true, stage: 'unsubscribed' });
  }

  // ── session, download, releases ────────────────────────────────────────────
  async function getSession(request) {
    const p = session(request);
    if (!p) return json(401, { ok: false, error: 'NO_SESSION' });
    if (p.k === 'form') return json(200, { ok: true, session: { firstName: p.n || '', stage: 'check_email' } });
    const s = await repo.getSignup(p.sid);
    if (!s) return json(401, { ok: false, error: 'NO_SESSION' });
    return json(200, { ok: true, session: { firstName: firstName(s.name), stage: stageOf(s) } });
  }

  async function download(request, parts) {
    const nav = wantsHtml(request);
    const deny = (status, error) => nav ? redirect(303, '/Download.dc.html') : json(status, { ok: false, error });
    const [platform, arch, extra] = parts;
    const isMac = platform === 'mac' && arch === 'arm64' && extra === undefined;
    const isAndroid = platform === 'android' && arch === undefined;
    if (!isMac && !isAndroid) return json(404, { ok: false, error: 'NOT_AVAILABLE' });
    const p = session(request);
    if (!p || (p.k !== 'email' && p.k !== 'in')) return deny(401, 'NO_SESSION');
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
      if (!row.confirmedAt) await queueMail(emails.notify({ confirmUrl: url('/api/confirm-email', await newLink('roadmap_confirm', row.id), 'for=notify') }), { to: v.value.email });
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
    if (key === 'signer' && !SIGNER_PATHS.has(action)) return 403;
    let fresh;
    try { fresh = await repo.useNonce(nonce, now()); }
    catch (e) {
      // On an empty database there is no nonce table yet. Only the owner's (signed, timestamped) migrate may go
      // ahead without one: it is idempotent, so a replay within the 5 minutes changes nothing.
      if (action !== 'migrate' || key !== 'admin') throw e;
      fresh = true;
    }
    if (!fresh) return 401;
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
        const rows = await repo.claimPending(now(), 10, CLAIM_TTL, { gate: config.playGate });
        return json(200, { ok: true, pending: rows.map(r => ({ signupId: r.id, label: tokenLabel(r.name) })) });
      }
      case 'token': {
        if (typeof data.signupId !== 'string' || !UUID.test(data.signupId) || !isTokenShaped(data.token)) return json(400, { ok: false, error: 'BAD_TOKEN' });
        const r = await repo.storeToken(data.signupId, data.token, now(), { gate: config.playGate });
        if (r === 'not_found') return json(404, { ok: false, error: 'NOT_FOUND' });
        if (r === 'conflict') return json(409, { ok: false, error: 'ALREADY_ISSUED' });
        const s = await repo.getSignup(data.signupId);
        // Two emails: the invitation (where the apps come from: /download/mac) and the token on its own.
        await queueMail(emails.invite({ name: s.name, downloadUrl, release: releases, googleEmail: s.googleEmail }), { to: s.emailNorm, signupId: s.id, capped: false });
        await queueMail(emails.token({ name: s.name, token: data.token }), { to: s.emailNorm, signupId: s.id, capped: false });
        log.info('token.stored', { signupId: s.id });
        return json(200, { ok: true });
      }
      case 'outbox': {
        // The signer asks for at most what its hourly sending budget allows (max), never more than 20.
        const max = data.max === undefined ? 20 : data.max;
        if (!Number.isInteger(max) || max < 0) return json(400, { ok: false, error: 'BAD_MAX' });
        const rows = max === 0 ? [] : await repo.claimOutbox(now(), Math.min(20, max), CLAIM_TTL);
        return json(200, { ok: true, messages: rows.map(m => ({ id: m.id, kind: m.kind, to: m.toEmail, subject: m.subject, text: m.text })) });
      }
      // For `signer --status`: counts only, no addresses. With the Play gate on, approved people wait for the Play list
      // and play_added people wait for their token.
      case 'queue': {
        const s = await repo.stats();
        const c = s.signups;
        let poolReady = null, androidPending = null;
        try { poolReady = (await repo.poolStatus(now(), poolRules(now()))).ready; androidPending = await repo.androidPendingCount(); } catch { log.warn('queue.pool_failed', { code: 'db' }); }
        return json(200, { ok: true, outboxQueued: s.outboxPending, awaitingToken: config.playGate ? c.play_added : c.approved + c.play_added, awaitingPlayList: config.playGate ? c.approved : 0, poolReady, androidPending });
      }
      // The token pool. The signer uploads only token strings; the server keeps each with its end date (read from
      // the payload) and the upload time. Token values are never logged.
      case 'pool-add': {
        const list = data.tokens;
        if (!Array.isArray(list) || !list.length || list.length > POOL_ADD_MAX) return json(400, { ok: false, error: 'BAD_LIST' });
        const items = list.map(t => ({ token: t, notAfter: poolTokenEnd(t) }));
        if (items.some(x => x.notAfter === null)) return json(400, { ok: false, error: 'BAD_TOKEN' });
        const added = await repo.addPoolTokens(items, now());
        log.info('pool.added', { added });
        return json(200, { ok: true, added });
      }
      case 'pool-status': return json(200, { ok: true, ...(await repo.poolStatus(now(), poolRules(now()))), dailyCap: config.signupDailyCap });
      case 'pool-prune': {
        const discarded = await repo.prunePool(now(), poolRules(now()));
        log.info('pool.pruned', { discarded });
        return json(200, { ok: true, discarded });
      }
      // ANDROID_ACCESS=google-group only: the signer adds these Google accounts to the group from the owner's Mac.
      case 'android-pending': {
        if (config.androidAccess !== 'google-group') return json(404, { ok: false, error: 'NOT_FOUND' });
        return json(200, { ok: true, pending: (await repo.androidPending(20)).map(r => ({ signupId: r.id, googleEmail: r.googleEmail })) });
      }
      case 'android-added': {
        if (config.androidAccess !== 'google-group') return json(404, { ok: false, error: 'NOT_FOUND' });
        if (typeof data.signupId !== 'string' || !UUID.test(data.signupId)) return json(400, { ok: false, error: 'BAD_ID' });
        const marked = await repo.markAndroidAdded(data.signupId, now());
        if (marked) await androidInvite(data.signupId);
        return json(200, { ok: true, marked: marked ? 1 : 0 });
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
        // By signupId or email; either way everything held under that address goes (sign-up, links, downloads,
        // queued emails, roadmap requests, feedback). signupId comes back so the CLI can remove the signer's token copy.
        const s = await findPerson(data);
        const e = s ? s.emailNorm : normaliseEmail(data.email || '');
        if (!e) return typeof data.signupId === 'string' ? json(200, { ok: true, deleted: 0, notify: 0, feedback: 0 }) : json(400, { ok: false, error: 'BAD_EMAIL' });
        const r = await repo.deleteByEmail(e);
        log.info('admin.deleted', { count: r.signups, notify: r.notify, feedback: r.feedback });
        return json(200, { ok: true, deleted: r.signups, notify: r.notify, feedback: r.feedback, signupId: s ? s.id : null });
      }
      case 'unsubscribe': {
        const s = await findPerson(data);
        const e = s ? s.emailNorm : normaliseEmail(data.email || '');
        if (!e) return json(400, { ok: false, error: 'BAD_EMAIL' });
        const r = await repo.unsubscribe(e, now());
        log.info('admin.unsubscribed', r);
        return json(200, { ok: true, ...r });
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
      case 'play-pending': {
        // csv: the Google accounts still to add, one per line. fullCsv: everyone who should be on the list, because
        // a CSV upload in Play Console REPLACES the list (support.google.com/googleplay/android-developer/answer/9845334).
        const rows = await repo.playPending();
        const all = await repo.playListAll();
        return json(200, { ok: true, count: rows.length, csv: rows.map(r => r.googleEmail + '\n').join(''), total: all.length, fullCsv: all.map(e => e + '\n').join('') });
      }
      case 'play-mark-added': {
        if (!Array.isArray(data.googleEmails) || data.googleEmails.length > 1000) return json(400, { ok: false, error: 'BAD_LIST' });
        const list = data.googleEmails.map(e => normaliseEmail(String(e)));
        if (list.some(e => !e)) return json(400, { ok: false, error: 'BAD_LIST' });
        const { androidInvite: invite = [], ...r } = await repo.markPlayAdded(list, now());
        for (const id of invite) await androidInvite(id); // instant sign-ups: their Android invitation, once
        log.info('admin.play_added', r);
        return json(200, { ok: true, ...r });
      }
      case 'announce': {
        // Update emails: only people who asked for them AND confirmed by email. Each copy gets a one-use
        // unsubscribe link. The signer sends them from the owner's Mail.app within its hourly budget.
        const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
        const body = typeof data.body === 'string' ? data.body : '';
        if (!subject || subject.length > 150 || CONTROL.test(subject)) return json(400, { ok: false, error: 'BAD_SUBJECT' });
        if (!body.trim() || body.length > 10000 || /\u0000/.test(body)) return json(400, { ok: false, error: 'BAD_BODY' });
        const people = await repo.announceRecipients();
        if (data.dryRun === true) return json(200, { ok: true, recipients: people.length, queued: 0 });
        let queued = 0;
        for (const p of people) {
          const u = url('/api/unsubscribe', await newLink('unsubscribe', p.id));
          await queueMail(emails.announce({ subject, body, unsubscribeUrl: u }), { to: p.emailNorm, signupId: p.id, capped: false });
          queued++;
        }
        log.info('admin.announced', { queued });
        return json(200, { ok: true, recipients: people.length, queued });
      }
      case 'migrate': {
        // Owner only (admin key): applies schema v1 then v2 inside the function, so the database connection
        // string never leaves Vercel. Idempotent.
        for (const sql of schemas) await repo.migrate(sql);
        const version = await repo.schemaVersion();
        log.info('admin.migrated', { version });
        return json(200, { ok: true, version });
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
    // /download/mac is rewritten to __route=download-mac on Vercel (vercel.json); locally it arrives as is.
    const path = u.pathname === DOWNLOAD_PATH ? 'download-mac' : u.pathname.startsWith('/api/') && u.pathname !== '/api/index' ? u.pathname.slice(5) : (u.searchParams.get('__route') || '');
    const parts = path.split('/').filter(Boolean);
    const m = request.method;
    const only = (method, fn) => m === method ? fn() : json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: method });
    if (parts[0] === 'health' && parts.length === 1) return only('GET', () => misconfigured ? json(503, { ok: false, error: 'MISCONFIGURED' }) : json(200, { ok: true }));
    if (misconfigured) return json(503, { ok: false, error: 'MISCONFIGURED' });
    switch (parts[0]) {
      case 'get-sidekick': if (parts.length === 1) return only('POST', () => getSidekick(request)); break;
      case 'email-copy': if (parts.length === 1) return only('POST', () => emailCopy(request)); break;
      case 'download-mac': if (parts.length === 1) return m === 'HEAD' ? downloadMac(request) : only('GET', () => downloadMac(request)); break;
      case 'confirm-email': if (parts.length === 1) return m === 'GET' ? linkGet(request, 'confirm') : only('POST', () => linkPost(request, 'confirm')); break;
      case 'unsubscribe': if (parts.length === 1) return m === 'GET' ? (() => { const nonce = newNonce(); return html(200, linkPage({ purpose: 'unsubscribe', nonce, siteKey: null, valid: true }), nonce); })() : only('POST', () => unsubscribePost(request)); break;
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
  const cols = ['id', 'created_at', 'state', 'name', 'email', 'mac_chip', 'phone_model', 'google_email', 'marketing_confirmed_at', 'confirmed_at', 'approved_at', 'play_added_at', 'token_issued_at', 'token_emailed_at', 'downloads'];
  const pick = (r) => [r.id, r.createdAt, r.state, r.name, r.email, r.macChip, r.phoneModel, r.googleEmail, r.marketingConfirmedAt, r.confirmedAt, r.approvedAt, r.playAddedAt, r.tokenIssuedAt, r.tokenEmailedAt, r.downloads];
  const cell = (v) => {
    let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(',')].concat(rows.map(r => pick(r).map(cell).join(','))).join('\n') + '\n';
}
