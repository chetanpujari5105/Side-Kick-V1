// Manual mode (SITE_MODE=manual): every way to reach us is an email the visitor sends from their own email app.
// The one source of those emails' subject and body. Pages call these at runtime; tools/noscript.mjs calls the same
// functions for the static copies, so the two can't drift. Needs data/site-config.js first (the address).
(function () {
  const to = () => (window.SK_CONFIG && window.SK_CONFIG.supportEmail) || '';
  // RFC 6068: encode everything, and line breaks as %0D%0A.
  const enc = (s) => encodeURIComponent(s).replace(/%0A/g, '%0D%0A');
  const link = (subject, lines) => 'mailto:' + to() + '?subject=' + enc(subject) + '&body=' + enc(lines.join('\n'));
  window.SK_MAILTO = {
    to,
    requestSubject: 'Sidekick beta: request access',
    requestFields: [
      'Your name:',
      'Your Mac\'s chip (Apple menu > About This Mac > Chip; the beta runs on Apple silicon only, M1 or later):',
      'Your Android phone model (Android 10 or later):',
      'The Google account email you use on that phone (we add it to the Google Play test list):'
    ],
    requestConsent: 'I have read Privacy on the Sidekick website (Support > Privacy) and agree to you using these details to run the beta.',
    request() {
      return link(this.requestSubject, ['Hi,', '', 'I\'d like to join the Sidekick beta.', '', ...this.requestFields.flatMap(f => [f, '']), this.requestConsent, '']);
    },
    notify(title) {
      return link('Sidekick: tell me when "' + title + '" ships', ['Hi,', '', 'Please email me once when "' + title + '" ships in Sidekick.', '']);
    },
    suggest() {
      return link('Sidekick: feature suggestion', ['Hi,', '', 'My suggestion for Sidekick:', '', '', 'Why it would help me:', '', '']);
    }
  };
})();
