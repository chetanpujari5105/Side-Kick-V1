// Sidekick website — config flags + release facts.
// Release facts: 2.0.1 values given by the owner on 2026-10-14; both DMGs' size and SHA-256 checked against the files on disk.
// In production these come from GET /api/releases; this file is the mock.
window.SK_CONFIG = {
  releaseState: 'invite',      // 'invite' | 'public'
  tokenRequired: true,         // false → Download page hides the Access token block
  intelBuildTested: false,     // false → Intel option carries the "not yet tested" label
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
      arm64: { label: 'Apple silicon', file: 'Sidekick-2.0.1-arm64.dmg', bytes: 121674754,
               sha256: 'bf8042be0447c1ac9670981674a5a617b0485d4f21ed9f3e600279ae09f8b716' },
      x64:   { label: 'Intel', file: 'Sidekick-2.0.1.dmg', bytes: 126571629,
               sha256: '1f1a021bb94e671ba4541653f1db04c5f4ae959013fa42c640d13088868f6a1b' }
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
