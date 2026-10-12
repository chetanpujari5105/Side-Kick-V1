// ─────────────────────────────────────────────────────────────
// MOCK API — stands in for the real endpoints until the backend exists.
// Every function returns a Promise shaped like the real response.
// Toggle outcomes for review with sessionStorage 'sk_mock_outcome':
//   'success' | 'server_error' | 'rate_limited' | 'invalid'
// Remove this file and set SK_CONFIG.mocksEnabled=false in production.
// ─────────────────────────────────────────────────────────────
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const outcome = () => sessionStorage.getItem('sk_mock_outcome') || 'success';

  async function real(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ...body };
  }

  window.SK_API = {
    // POST /api/get-sidekick  → 200 {ok:true, session:{name, expiresAt}} | 400 {ok:false, fieldErrors} | 429 {ok:false, retryAfter} | 5xx
    async getSidekick(payload) {
      if (!window.SK_CONFIG || !window.SK_CONFIG.mocksEnabled)
        return real('/api/get-sidekick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      await wait(1400);
      const o = outcome();
      if (o === 'server_error') return { status: 503, ok: false, error: 'SERVICE_UNAVAILABLE' };
      if (o === 'rate_limited') return { status: 429, ok: false, error: 'RATE_LIMITED', retryAfter: 600 };
      if (o === 'invalid') return { status: 400, ok: false, fieldErrors: { email: "We couldn't use that email address. Check it and try again." } };
      const session = { name: payload.name, macChip: payload.macChip, expiresAt: Date.now() + 1000 * 60 * 60 * 24 };
      sessionStorage.setItem('sk_session', JSON.stringify(session)); // real build: HttpOnly signed cookie
      return { status: 200, ok: true, session };
    },
    // GET /api/download/:platform/:arch → 302 to signed URL. Mock returns {url:null}.
    async download(platform, arch) {
      if (!window.SK_CONFIG.mocksEnabled) return real(`/api/download/${platform}${arch ? '/' + arch : ''}`);
      await wait(500);
      return { status: 200, ok: true, url: null, mock: true };
    },
    // POST /api/roadmap-notify {email, featureId} → 202 (double opt-in email sent)
    async roadmapNotify(email, featureId) {
      if (!window.SK_CONFIG.mocksEnabled) return real('/api/roadmap-notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, featureId }) });
      await wait(900);
      return { status: 202, ok: true };
    },
    // POST /api/feedback {message, email?} → 202
    async feedback(message, email) {
      if (!window.SK_CONFIG.mocksEnabled) return real('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, email }) });
      await wait(900);
      return { status: 202, ok: true };
    },
    session() {
      try { const s = JSON.parse(sessionStorage.getItem('sk_session') || 'null'); return s && s.expiresAt > Date.now() ? s : null; } catch (e) { return null; }
    }
  };
})();
