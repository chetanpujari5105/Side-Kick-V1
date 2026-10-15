// GENERATED from data/releases.json by scripts/data-sync.mjs; do not edit by hand.
// Release facts: 2.0.1, Apple silicon (arm64) only. Size and SHA-256 stay null until the staged DMG exists.
window.SK_RELEASES = {
  "version": "2.0.1",
  "mac": {
    "minOS": "macOS 11.0 (Big Sur) or later",
    "betaDriveUrl": "https://drive.google.com/drive/folders/1dKfJlOaXiSCCwgYlXflQ8HTDWv8lIbhL",
    "builds": {
      "arm64": {
        "label": "Apple silicon",
        "file": "Sidekick-2.0.1-arm64.dmg",
        "bytes": 121668061,
        "sha256": "a03b3390db4a81b1602deefd25825c16d0b72dc654c7a45ba52f9d5834f71284"
      }
    }
  },
  "android": {
    "minOS": "Android 10 or later",
    "storeUrl": null,
    "playTestUrl": "https://play.google.com/apps/internaltest/4700743324703460563"
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
