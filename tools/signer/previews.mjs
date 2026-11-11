// One sample of every email the signer sends (launch log Part 11). No email carries a token any more (Mac 2.0.2). Used by
// `signer --send-test` (to the owner's two addresses) and tools/email-preview.mjs (files on the owner's Mac).
// The links are real pages of the site that do nothing on their own (no confirm or unsubscribe link is real).
import fs from 'node:fs';
import { emails } from '../../server/emails.mjs';
import { SITE } from '../../server/email-html.mjs';

export function loadRelease() {
  const { _comment, ...r } = JSON.parse(fs.readFileSync(new URL('../../data/releases.json', import.meta.url), 'utf8'));
  return r;
}

export function previewSamples({ release = loadRelease(), name = 'chetan', googleEmail = 'cpujari12@gmail.com', site = SITE } = {}) {
  const dl = site + '/download/mac', inert = site + '/Get%20Sidekick.dc.html';
  return [
    ['copy', emails.copy({ name, downloadUrl: dl, release })],
    ['android', emails.android({ name, release, googleEmail })],
    ['confirm', emails.confirm({ name, confirmUrl: inert, updatesUrl: inert, downloadUrl: dl, android: true })],
    ['updates', emails.updates({ name, updatesUrl: inert })],
    ['access', emails.access({ name, downloadUrl: dl })],
    ['waitlist', emails.waitlist({ name })],
    ['invite', emails.invite({ name, downloadUrl: dl, release, googleEmail })],
    ['announce', emails.announce({ subject: 'Sidekick 2.0.2 is out', body: 'Sidekick 2.0.2 is out.\n\nThis is a preview of an update email. Nothing changed: there is no new build.', unsubscribeUrl: inert })]
  ];
}
