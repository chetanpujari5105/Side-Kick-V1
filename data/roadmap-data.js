// Sidekick roadmap — single source of truth. Edit here; layout reads it.
// status: 'next' | 'design' | 'exploring' | 'later'
// Only things the app does NOT do yet. Removed 2026-10-15 because the app already has them: mirror quality presets,
// notification actions, transfer destination & folder chooser. Relabelled: screenshots (Save a still exists) and
// resume (files sent to the phone already resume). Evidence: site-log-2026-10-15 Step 2, item 5.
window.SK_ROADMAP = {
  heading: "What we're building next.",
  subline: "Sidekick keeps growing. This is the direction — plans can change, and nothing here is promised until it ships.",
  footnote: "Platform rules sometimes limit what's possible, so some features depend on your phone or Android version.",
  categories: ['Reliability', 'Mac experience', 'Transfers', 'Mirror & media', 'Camera & audio', 'More devices'],
  phases: [
    { id: 1, status: 'next',      label: 'Next up',     title: 'Reliability & everyday polish' },
    { id: 2, status: 'design',    label: 'In design',   title: 'Faster, richer transfers & browsing' },
    { id: 3, status: 'exploring', label: 'Exploring',   title: 'Bigger capabilities' },
    { id: 4, status: 'later',     label: 'Later',       title: 'More devices' }
  ],
  items: [
    { id: 'health',      phase: 1, category: 'Reliability',    title: 'Connection health dashboard', benefit: 'See whether an issue is the phone, the network, pairing or the service.' },
    { id: 'reconnect',   phase: 1, category: 'Reliability',    title: 'Guided reconnect & recovery', benefit: 'Get back online step by step, without reinstalling.' },
    { id: 'quiet',       phase: 1, category: 'Reliability',    title: 'Lower background activity & quieter logs', benefit: "Gentler on your phone's battery, clearer diagnostics." },
    { id: 'menubar',     phase: 1, category: 'Mac experience', title: 'Menu-bar quick controls', benefit: 'Connection, battery, clipboard, transfers and mirror without opening the main window.' },
    { id: 'notifgroup',  phase: 1, category: 'Mac experience', title: 'Notification grouping & per-app filters', benefit: 'Less noise, easier to find what matters.' },
    { id: 'queue',       phase: 1, category: 'Transfers',      title: 'Transfer queue', benefit: 'Send several items without one pending request blocking the rest.' },
    { id: 'checksums',   phase: 1, category: 'Transfers',      title: 'Reliable checksums for large files', benefit: 'Integrity checking you can trust.' },
    { id: 'clipsearch',  phase: 1, category: 'Mac experience', title: 'Clipboard search, pinning & resend', benefit: 'Find and reuse what you copied.' },
    { id: 'speed',       phase: 2, category: 'Transfers',      title: 'Transfer speed, ETA & detailed progress', benefit: 'Know how long a transfer will take.' },
    { id: 'resume',      phase: 2, category: 'Transfers',      title: 'Resume files coming to your Mac', benefit: 'A dropped transfer from the phone picks up where it stopped, as files sent to the phone already do.' },
    { id: 'photos',      phase: 2, category: 'Transfers',      title: 'Richer photo browsing & previews', benefit: 'Multi-select and smoother browsing of large libraries.' },
    { id: 'imgclip',     phase: 2, category: 'Mac experience', title: 'Image clipboard support', benefit: 'Copy supported images between phone and Mac.', note: 'Size limits apply.' },
    { id: 'linkhand',    phase: 2, category: 'Mac experience', title: 'Safer link handoff', benefit: 'Open a phone link on your Mac only through an explicit action, never automatically.' },
    { id: 'record',      phase: 2, category: 'Mirror & media', title: 'Local recording of the mirror', benefit: 'Record what you mirror, with clear controls and an on-screen indicator. Saving a still already works.' },
    { id: 'mediaaudio',  phase: 3, category: 'Mirror & media', title: 'Phone media audio on your Mac', benefit: 'Hear supported playback through your Mac.', note: 'Android capture rules apply.' },
    { id: 'appwindows',  phase: 3, category: 'Mirror & media', title: 'Individual Android apps in their own Mac windows', benefit: 'Keep one phone app beside your work.' },
    { id: 'screenoff',   phase: 3, category: 'Mirror & media', title: 'Screen-off mirroring', benefit: 'Mirror while the phone screen stays dark.', note: 'Advanced, device-dependent mode.' },
    { id: 'webcam',      phase: 3, category: 'Camera & audio', title: 'Android camera as a Mac webcam', benefit: 'Use your phone camera in Mac video apps.' },
    { id: 'camctl',      phase: 3, category: 'Camera & audio', title: 'Better camera controls', benefit: 'More control over the phone camera.', note: 'Device-dependent.' },
    { id: 'mic',         phase: 3, category: 'Camera & audio', title: 'Android microphone as a Mac input', benefit: 'Use your phone as a microphone for your Mac.' },
    { id: 'twomacs',     phase: 4, category: 'More devices',   title: 'One phone connected to two Macs', benefit: 'Use the same phone with a work and a home Mac.' },
    { id: 'ipad',        phase: 4, category: 'More devices',   title: 'iPad companion', benefit: 'Bring Sidekick to iPad.' },
    { id: 'iphone',      phase: 4, category: 'More devices',   title: 'iPhone ↔ Android local sharing', benefit: 'Share between an iPhone and an Android phone locally.' }
  ]
};
