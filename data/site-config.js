// Sidekick website — config flags + release facts.
// Release facts: 2.0.1, Apple silicon (arm64) only — there is no Intel build.
// Mac size and SHA-256 stay null until the staged beta DMG exists; never fill them from memory or a guess.
// In production these come from GET /api/releases; this file is the mock.
window.SK_CONFIG = {
  releaseState: 'invite',      // 'invite' | 'public'
  tokenRequired: true,         // false → Download page hides the Access token block
  notarized: false,            // false → Download page shows the Gatekeeper "Open Anyway" steps
  mocksEnabled: true,          // true → API calls are answered by data/mock-api.js

  // PLACEHOLDER — fill before launch (see Handoff.md → Launch blockers). Not shown on any page.
  domain: '[sidekick-domain.example]',
  // Publisher details. Country only — no postal address or phone number, by the owner's choice.
  supportEmail: 'chetanpujari.sitit@gmail.com',
  publisher: 'Chetan Pujari',
  publisherAddress: 'India',
  policyEffectiveDate: '13 October 2026'
};

window.SK_RELEASES = {
  version: '2.0.1',
  mac: {
    minOS: 'macOS 11.0 (Big Sur) or later',
    builds: {
      arm64: { label: 'Apple silicon', file: 'Sidekick-2.0.1-arm64.dmg', bytes: null, sha256: null } // fill from the staged DMG
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
    { version: '2.0.1', date: '14 October 2026', items: [
      'A Paste token button on the token screen.',
      'Pasted tokens are cleaned up automatically, and the app says plainly when the text you pasted isn\'t a token (for example, a download checksum).',
      'A short note before macOS may ask for your Mac password: choose Always Allow so it doesn\'t ask again.'
    ]},
    { version: '2.0.0', date: null, items: [ // release date not confirmed yet; null hides it
      'Sidekick name and look across the Mac app and the phone app.',
      'Pair once by scanning a QR code; the link is TLS 1.3 with certificate pinning.',
      'Screen mirroring with control, notifications with replies, messages, calls, files, photos, clipboard history, apps and a media remote.',
      'First-launch access token on the Mac app.'
    ]}
  ]
};
