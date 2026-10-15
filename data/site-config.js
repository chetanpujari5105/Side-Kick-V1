// Sidekick website — config flags. The production build (scripts/build-site.mjs) rewrites mocksEnabled to false
// and fills turnstileSiteKey from the TURNSTILE_SITE_KEY environment variable.
window.SK_CONFIG = {
  releaseState: 'invite',      // 'invite' | 'public'
  tokenRequired: true,         // false → Download page hides the Access token block
  notarized: false,            // false → Download page shows the Gatekeeper "Open Anyway" steps
  mocksEnabled: true,          // true → API calls are answered by data/mock-api.js and the forms stay closed
  turnstileSiteKey: null,      // public Cloudflare Turnstile site key; the build fills it (never the secret)

  // PLACEHOLDER — fill before launch (see Handoff.md → Launch blockers). Not shown on any page.
  domain: '[sidekick-domain.example]',
  // Publisher details. Country only — no postal address or phone number, by the owner's choice.
  supportEmail: 'chetanpujari.sitit@gmail.com',
  publisher: 'Chetan Pujari',
  publisherAddress: 'India',
  // Placeholder on purpose: the privacy text changed on 15 Oct 2026 and needs legal review. Set the real date on
  // the day the reviewed policy goes live; until then Support › Privacy shows the DRAFT banner.
  policyEffectiveDate: '[set on go-live day, after legal review]'
};

// Release facts moved to data/releases.json (the one source); pages load the generated data/releases.js.
