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

// The three install steps of the result page (launch log Part 7); the full six stay in data/releases.json.
// Get Sidekick.dc.html shows the same three (test/oneclick-pages.test.mjs compares them).
export const SHORT_STEPS = (file) => [
  `Open ${file} and drag Sidekick into Applications.`,
  'Open Sidekick. On the macOS warning choose Done, then open System Settings › Privacy & Security and click Open Anyway.',
  'Paste your beta token when Sidekick asks for it (press Paste token).'
];
// The Mac download: /download/mac, with the Drive folder only for when the download fails.
const macDownload = (downloadUrl, release) => {
  const b = release.mac.builds.arm64;
  return `Download it here (Apple silicon Macs only):\n${downloadUrl}` +
    (release.mac.betaDriveUrl ? `\n\nIf the download fails, download ${b.file} from our Google Drive folder instead:\n${release.mac.betaDriveUrl}` : '');
};
const shaLine = (b) => b.sha256 ? `\n\nTo check the download, its SHA-256 checksum is below. It is only for checking the file; it is not your token.\n${b.sha256}` : '';
const androidPara = (release, googleEmail) => {
  const play = release.android && release.android.playTestUrl;
  return play
    ? `Open this link on your phone, signed in to the Google account ${googleEmail}:\n${play}\n\nThe link works only once we have added your Google account to the Sidekick test list. We added ${googleEmail} before sending this email. If Google Play says you can't join, reply and tell us.`
    : 'The Android app isn\'t on Google Play yet. We\'ll email you when it is.';
};
const PAIR = 'Then open Sidekick on the phone, tap Get started, then Scan the code, and scan the code on your Mac.';

export const emails = {
  // The email flow, used when no token can be handed out on the page (pool empty, daily cap, beta full).
  confirm: ({ name, confirmUrl, updatesUrl, downloadUrl, android = false }) => ({
    kind: 'confirm',
    subject: 'Confirm your email for the Sidekick beta',
    text: `Hi ${first(name)},\n\nConfirm your email to finish signing up for the Sidekick beta:\n${confirmUrl}\n\nThe link works for 48 hours.` +
      `\n\nAfter you confirm, we email your beta token, usually within a day.${android ? ' We also add your Google account to the Android test list and email you its Google Play link.' : ''} We send our emails ourselves.` +
      (downloadUrl ? `\n\nYou can download the Mac app now:\n${downloadUrl}` : '') +
      (updatesUrl ? `\n\nYou also asked for Sidekick updates by email. We'll only send them if you confirm that too:\n${updatesUrl}` : '') +
      `\n\nIf you didn't sign up, ignore this email. Unconfirmed sign-ups are deleted after 7 days.${sign}`
  }),
  // A repeat sign-up whose token is still on its way: the download link (no token here; it has its own email).
  access: ({ name, downloadUrl }) => ({
    kind: 'access',
    subject: 'Your Sidekick download link',
    text: `Hi ${first(name)},\n\nYou already signed up for the Sidekick beta. Download the Mac app here:\n${downloadUrl}\n\nYour beta token comes in its own email, "Your Sidekick beta token". If it has already come, use that one.\n\nIf you didn't ask for this, ignore this email.${sign}`
  }),
  // "Email me a copy" on the result page, or a repeat sign-up of someone who already has a token: what the page
  // showed, sent only to the address on the sign-up. token is null when it has already been erased (after 46 days).
  copy: ({ name, token, downloadUrl, release }) => {
    const b = release.mac.builds.arm64;
    const tok = token
      ? `YOUR BETA TOKEN (the line below, on its own)\n\n${token}\n\nIt works for ${TOKEN_DAYS} days from the day it was made. It is yours: please don't share it. Sidekick checks it on your Mac and sends it nowhere.`
      : 'YOUR BETA TOKEN\n\nIt was in our earlier email, "Your Sidekick beta token" or the page you saw when you signed up. If you can\'t find it, write to us.';
    return {
      kind: 'copy',
      subject: 'Your Sidekick beta: download link and token',
      text: `Hi ${first(name)},\n\nHere is your Sidekick beta: the Mac app, your beta token and three install steps.\n\nTHE MAC APP\n\n${macDownload(downloadUrl, release)}\n\n${tok}\n\n` +
        `INSTALL\n${numbered(SHORT_STEPS(b.file))}\n\nThe full steps: ${downloadUrl.replace(/\/download\/mac$/, '/Support.dc.html#setup')}${shaLine(b)}${leave}${sign}`
    };
  },
  // The updates opt-in of an instant sign-up: still double opt-in, and only when ticked in that submission.
  updates: ({ name, updatesUrl }) => ({
    kind: 'updates',
    subject: 'Confirm Sidekick updates',
    text: `Hi ${first(name)},\n\nYou asked for Sidekick updates by email. We'll only send them if you confirm:\n${updatesUrl}\n\nThe link works for 7 days. If you didn't ask, ignore this email: nothing will be sent.${sign}`
  }),
  // An instant sign-up's Android part, once its Google account is on the Play test list (play-mark-added or the group).
  android: ({ name, release, googleEmail }) => ({
    kind: 'android',
    subject: 'Sidekick for Android: your Google Play link',
    text: `Hi ${first(name)},\n\nYour Google account is on Sidekick's Google Play test list now.\n\nTHE ANDROID APP\n\n${androidPara(release, googleEmail)}\n\n${PAIR}${leave}${sign}`
  }),
  waitlist: ({ name }) => ({
    kind: 'waitlist',
    subject: "You're on the Sidekick waitlist",
    text: `Hi ${first(name)},\n\nThanks for confirming your email. The beta is full for now, so you're on the waitlist. We'll email you when a place opens. There's nothing else to do.${sign}`
  }),
  // The invitation of the email flow: where the apps come from. Never the token (that is its own email).
  // downloadUrl is /download/mac; the Drive folder is mentioned only for when the download fails.
  invite: ({ name, downloadUrl, release, googleEmail }) => {
    const b = release.mac.builds.arm64;
    const steps = release.mac.installSteps || [];
    const android = googleEmail ? `THE ANDROID APP\n\n${androidPara(release, googleEmail)}\n\n${PAIR}`
      : 'THE ANDROID APP\n\nYou didn\'t ask for the Android app. If you want it later, reply with the Google account your phone uses for Google Play.';
    return {
      kind: 'invite',
      subject: 'Your Sidekick beta invitation',
      text: `Hi ${first(name)},\n\nYou're in the Sidekick beta. This email says where to get the apps. Your beta token comes in a separate email.\n\n` +
        `THE MAC APP\n\n${macDownload(downloadUrl, release)}${shaLine(b)}\n\nInstall it:\n${numbered(steps)}\n\n${android}${leave}${sign}`
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
