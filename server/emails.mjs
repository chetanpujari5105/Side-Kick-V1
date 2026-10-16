// Plain-text emails. Subjects are constants (no user text in any header) except an announcement's, which only the
// owner sets (admin announce, checked for line breaks); names are tidied before use.
import { cleanText } from './validate.mjs';

export const CONTACT = 'chetanpujari.sitit@gmail.com';
// The token's length, as the Mac app's docs state it: "signed, time-boxed tokens, 45 days"
// (ConnectSuite docs/trial-licence-summary-2026-10-11.md, "Decided and built"). The signer issues --days 45.
export const TOKEN_DAYS = 45;

const first = (name) => cleanText(name, 120).split(' ')[0].slice(0, 40) || 'there';
const sign = '\n\n— Sidekick\nThis email was sent because someone entered this address on the Sidekick website.';
const leave = `\n\nQuestions: write to ${CONTACT}.\nTo leave the beta and have your details deleted, reply to this email with "remove me", or write to ${CONTACT}.`;
const numbered = (list) => list.map((s, i) => `${i + 1}. ${s}`).join('\n');

export const emails = {
  confirm: ({ name, confirmUrl, updatesUrl }) => ({
    kind: 'confirm',
    subject: 'Confirm your email for the Sidekick beta',
    text: `Hi ${first(name)},\n\nConfirm your email to finish signing up for the Sidekick beta:\n${confirmUrl}\n\nThe link works for 48 hours.` +
      `\n\nAfter you confirm, we add you to the Android test list and email your download links and token, up to a day later. The token comes in its own email. We send them ourselves.` +
      (updatesUrl ? `\n\nYou also asked for Sidekick updates by email. We'll only send them if you confirm that too:\n${updatesUrl}` : '') +
      `\n\nIf you didn't sign up, ignore this email. Unconfirmed sign-ups are deleted after 7 days.${sign}`
  }),
  access: ({ name, accessUrl }) => ({
    kind: 'access',
    subject: 'Your Sidekick download page',
    text: `Hi ${first(name)},\n\nHere is a new link to your Sidekick download page:\n${accessUrl}\n\nIt works for 72 hours, on this device or another one.\n\nIf you didn't ask for it, ignore this email.${sign}`
  }),
  waitlist: ({ name }) => ({
    kind: 'waitlist',
    subject: "You're on the Sidekick waitlist",
    text: `Hi ${first(name)},\n\nThanks for confirming your email. The beta is full for now, so you're on the waitlist. We'll email you when a place opens. There's nothing else to do.${sign}`
  }),
  // The invitation: where the apps come from. Never the token (that is its own email).
  // macUrl is the Beta page (STORAGE_PROVIDER=static) or a 72-hour link to the download page (github, r2).
  invite: ({ name, macUrl, macIsBetaPage, release, googleEmail }) => {
    const b = release.mac.builds.arm64;
    const steps = release.mac.installSteps || [];
    const play = release.android && release.android.playTestUrl;
    const mac = macIsBetaPage
      ? `Open the Beta page:\n${macUrl}\n\nIt links to the download folder on Google Drive.` +
        (release.mac.betaDriveUrl ? ` You can also open that folder directly:\n${release.mac.betaDriveUrl}\n\n` : ' ') + `Download ${b.file} from there.`
      : `Open your download page (the link works for 72 hours):\n${macUrl}\n\nDownload ${b.file} there.`;
    const sha = b.sha256 ? `\n\nTo check the download, its SHA-256 checksum is below. It is only for checking the file; it is not your token.\n${b.sha256}` : '';
    const android = play
      ? `Open this link on your phone, signed in to the Google account ${googleEmail}:\n${play}\n\nThe link works only once we have added your Google account to the Sidekick test list. We added ${googleEmail} before sending this email. If Google Play says you can't join, reply and tell us.`
      : 'The Android app isn\'t on Google Play yet. We\'ll email you when it is.';
    return {
      kind: 'invite',
      subject: 'Your Sidekick beta invitation',
      text: `Hi ${first(name)},\n\nYou're in the Sidekick beta. This email says where to get both apps. Your beta token comes in a separate email.\n\n` +
        `THE MAC APP\n\n${mac}${sha}\n\nInstall it:\n${numbered(steps)}\n\nTHE ANDROID APP\n\n${android}` +
        `\n\nThen open Sidekick on the phone, tap Get started, then Scan the code, and scan the code on your Mac.${leave}${sign}`
    };
  },
  // The token, alone on its own line, with how to enter it. No link of any kind: it travels apart from the download.
  token: ({ name, token }) => ({
    kind: 'token',
    subject: 'Your Sidekick beta token',
    text: `Hi ${first(name)},\n\nHere is your Sidekick beta token. It is the line below, on its own:\n\n${token}\n\n` +
      `How to enter it:\n1. Install Sidekick on your Mac first (the steps are in our other email, "Your Sidekick beta invitation").\n` +
      `2. Copy the whole token line above, from SIDEKICK-TRIAL-1 to its last character.\n` +
      `3. Open Sidekick. The first time, it shows "Enter your beta token": press Paste token. To enter a new token later, use Settings › About › Beta access.\n\n` +
      `The token works for ${TOKEN_DAYS} days from the day it was made. It is yours: please don't share it. Sidekick checks it on your Mac and sends it nowhere.\n\n` +
      `This token is not the download checksum: the SHA-256 in the invitation is only for checking the file.${leave}${sign}`
  }),
  notify: ({ confirmUrl }) => ({
    kind: 'notify',
    subject: 'Confirm: email me when this Sidekick feature ships',
    text: `Hi,\n\nConfirm that you'd like one email when this roadmap item ships:\n${confirmUrl}\n\nThe link works for 7 days. If you didn't ask, ignore this email and we'll delete the address after 7 days.${sign}`
  }),
  // An update, to people who asked for updates and confirmed by email. Each copy has its own one-use link.
  announce: ({ subject, body, unsubscribeUrl }) => ({
    kind: 'announce',
    subject,
    text: `${body.replace(/\r\n?/g, '\n').trim()}\n\n—\nYou get this because you asked for Sidekick updates and confirmed by email.\n` +
      `To stop them, open this link and press Unsubscribe (it works once):\n${unsubscribeUrl}\nOr reply to this email with "unsubscribe" and we'll remove you.\n\n— Sidekick`
  })
};
