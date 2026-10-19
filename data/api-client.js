// REAL API client. The production build (scripts/build-site.mjs) loads this file in place of the mock client,
// so nothing in production can answer with a mock or read the design-review switches.
(function () {
  if (window.SK_API && window.SK_API.real) return; // loaded once per page, even if a component includes it again
  const C = window.SK_CONFIG || {};

  async function call(path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { accept: 'application/json' } }, opts));
    const body = await res.json().catch(() => ({}));
    return Object.assign({ status: res.status }, body);
  }
  const post = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });

  let session = null;
  window.SK_API = {
    real: true,
    // POST /api/get-sidekick → 200 {ok, stage: 'in' (token, download, android) | 'already' | 'check_email'} + HttpOnly
    // session cookie | 400 {fieldErrors} | 403 bot check | 429 {retryAfter} | 503 SIGNUP_CLOSED | 5xx
    getSidekick: (payload) => post('/api/get-sidekick', payload),
    // POST /api/email-copy → 202 queued | 200 {stage: 'already_sent'} | 401 (this browser saw no result page)
    emailCopy: () => post('/api/email-copy', {}),
    // A browser navigation: the API answers 302 to a short-lived file link (or 303 back here without a session).
    download(platform, arch) { window.location.href = '/api/download/' + platform + (arch ? '/' + arch : ''); return Promise.resolve({ status: 0, navigated: true }); },
    roadmapNotify: (email, featureId, captchaToken) => post('/api/roadmap-notify', { email, featureId, captchaToken }),
    feedback: (message, email, captchaToken) => post('/api/feedback', { message, email, captchaToken }),
    async loadSession() {
      try { const r = await call('/api/session'); session = r.ok && r.session ? { name: r.session.firstName, stage: r.session.stage } : null; }
      catch (e) { session = null; }
      return session;
    },
    session: () => session
  };

  // Cloudflare Turnstile, rendered explicitly into a container the page owns. A holder object keeps one
  // widget per form. 'local-dev-fake' (npm run dev only; the build refuses it for Vercel) skips the network.
  let loading = null;
  function load() {
    if (window.turnstile) return Promise.resolve();
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error('turnstile')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const FAKE = C.turnstileSiteKey === 'local-dev-fake';
  window.SK_BOT = {
    // opts: extra Turnstile render options, e.g. { appearance: 'interaction-only' } (shown only if a challenge is needed).
    ensure(holder, el, opts) {
      if (!el || holder.el === el) return;
      if (holder.id != null && window.turnstile) { try { window.turnstile.remove(holder.id); } catch (e) {} }
      holder.el = el; holder.id = null; holder.token = null;
      if (FAKE) { el.textContent = 'Human check (local test stand-in)'; holder.token = 'XXXX.DUMMY.TOKEN.XXXX'; return; }
      if (!C.turnstileSiteKey) return;
      load().then(() => {
        if (holder.el !== el) return;
        // Cloudflare's normal widget is 300 px wide; in a narrower box (the Roadmap card on a phone) it would be cut off.
        const narrow = !(opts && opts.size) && el.clientWidth > 0 && el.clientWidth < 300;
        holder.id = window.turnstile.render(el, { ...(opts || {}), ...(narrow ? { size: 'compact' } : {}), sitekey: C.turnstileSiteKey, callback: (t) => { holder.token = t; },
          'expired-callback': () => { holder.token = null; }, 'error-callback': () => { holder.token = null; } });
      }).catch(() => { el.textContent = 'The human check could not load. Check your connection and reload the page.'; });
    },
    token: (holder) => holder.token || null,
    reset(holder) {
      if (FAKE) { holder.token = 'XXXX.DUMMY.TOKEN.XXXX'; return; }
      holder.token = null;
      if (holder.id != null && window.turnstile) { try { window.turnstile.reset(holder.id); } catch (e) {} }
    }
  };
})();
