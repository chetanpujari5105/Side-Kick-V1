// Sidekick website — config flags + release facts.
// Release facts are from docs/release-candidate-2026-10-12.md (candidate 83c4096).
// In production these come from GET /api/releases; this file is the mock.
window.SK_CONFIG = {
  releaseState: 'invite',      // 'invite' | 'public'
  tokenRequired: true,         // false → Download page hides the Access token block
  intelBuildTested: false,     // false → Intel option carries the "not yet tested" label
  notarized: false,            // false → Download page shows the Gatekeeper "Open Anyway" steps
  mocksEnabled: true,          // true → API calls are answered by data/mock-api.js

  // PLACEHOLDERS — fill before launch (see Handoff.md → Launch blockers)
  domain: '[sidekick-domain.example]',
  supportEmail: '[support@sidekick-domain.example]',
  publisher: '[Publisher legal name]',
  publisherAddress: '[Publisher postal address]',
  policyEffectiveDate: '[Effective date]'
};

window.SK_RELEASES = {
  version: '2.0.0',
  mac: {
    minOS: 'macOS 11 or later',
    builds: {
      arm64: { label: 'Apple silicon', file: 'Sidekick-2.0.0-arm64.dmg', bytes: 121675455,
               sha256: 'a50c2461bcc8e34130707006005dc61be267672702694fe46567f0c853b11d35' },
      x64:   { label: 'Intel', file: 'Sidekick-2.0.0.dmg', bytes: 126572183,
               sha256: '5bab1f5b838acffa5f4195f0f4c6423b0e3d67cd6be7e832c90a117a7a803e50' }
    }
  },
  android: {
    minOS: 'Android 10 or later',
    // The 2026-10-12 candidate APK is unsigned and cannot be installed.
    // Size and hash below are PLACEHOLDERS until the signed APK exists.
    build: { file: 'Sidekick-2.0.0.apk', bytes: null, sha256: null, signed: false },
    storeUrl: null
  },
  changelog: [
    { version: '2.0.0', date: '[Release date]', items: [
      'Sidekick name and look across the Mac app and the phone app.',
      'Pair once by scanning a QR code; the link is TLS 1.3 with certificate pinning.',
      'Screen mirroring with control, notifications with replies, messages, calls, files, photos, clipboard history, apps and a media remote.',
      'First-launch access token on the Mac app.'
    ]}
  ]
};
