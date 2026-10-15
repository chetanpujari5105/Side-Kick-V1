// GENERATED from data/releases.json by scripts/data-sync.mjs; do not edit by hand.
// Release facts: 2.0.1, Apple silicon (arm64) only. Size and SHA-256 stay null until the staged DMG exists.
window.SK_RELEASES = {
  "version": "2.0.1",
  "mac": {
    "minOS": "macOS 11.0 (Big Sur) or later",
    "builds": {
      "arm64": {
        "label": "Apple silicon",
        "file": "Sidekick-2.0.1-arm64.dmg",
        "bytes": null,
        "sha256": null
      }
    }
  },
  "android": {
    "minOS": "Android 10 or later",
    "build": {
      "file": "Sidekick-2.0.0.apk",
      "bytes": null,
      "sha256": null,
      "signed": false
    },
    "storeUrl": null
  },
  "changelog": [
    {
      "version": "2.0.1",
      "date": "14 October 2026",
      "items": [
        "A Paste token button on the token screen.",
        "Pasted tokens are cleaned up automatically, and the app says plainly when the text you pasted isn't a token (for example, a download checksum).",
        "A short note before macOS may ask for your Mac password: choose Always Allow so it doesn't ask again."
      ]
    },
    {
      "version": "2.0.0",
      "date": null,
      "items": [
        "Sidekick name and look across the Mac app and the phone app.",
        "Pair once by scanning a QR code; the link is TLS 1.3 with certificate pinning.",
        "Screen mirroring with control, notifications with replies, messages, calls, files, photos, clipboard history, apps and a media remote.",
        "First-launch access token on the Mac app."
      ]
    }
  ]
};
