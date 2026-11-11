// The emails, as plain text in one simple shape that server/email-html.mjs turns into the branded HTML version (launch
// log Part 11): the first line is the headline; "Label:" on a line above a lone https link is a button; a line in
// CAPITALS is a section label; a token line on its own is the token card; "1. …" lines are numbered steps; "— Sidekick"
// starts the footer. The signer sends both versions (multipart) through Gmail SMTP, or this text alone through Mail.app.
// Subjects are constants except the first name in the copy's (tidied: one word, no control characters) and an
// announcement's, which only the owner sets (admin announce, checked for line breaks).
// Short content: one download link (/download/mac) and three install steps; no Drive folder, no SHA-256, no "full steps".
import { cleanText } from './validate.mjs';

export const CONTACT = 'chetanpujari.sitit@gmail.com';
// No email shows a beta token any more: Mac 2.0.2 asks for none. The server still issues and stores tokens
// (the pool, the signer's /api/admin/token); they are simply not sent. The privacy text in Support.dc.html still
// describes them, which stays true while they are made and stored.

// The first word of the name, first letter capitalised ("chetan pujari" → "Chetan"); '' when there is none.
export const capFirst = (s) => s ? s.charAt(0).toLocaleUpperCase('en') + s.slice(1) : '';
export const firstName = (name) => capFirst(cleanText(name, 120).split(' ')[0].slice(0, 40));
const hi = (name, line) => line(firstName(name));
const withName = (n, s) => n ? `${s}, ${n}.` : `${s}.`;

const why = 'You got this email because this address was entered on the Sidekick website.';
const footer = (beta = true) => `\n\n— Sidekick\n\nQuestions? Reply to this email or write to ${CONTACT}.` +
  `\n${beta ? 'To leave the beta and have your details deleted' : 'To have your details deleted'}, reply with "remove me".\n${why}`;
const numbered = (list) => list.map((s, i) => `${i + 1}. ${s}`).join('\n');
const button = (label, url) => `${label}:\n${url}`;

// The three install steps of the result page (launch log Part 7); the full six stay in data/releases.json.
// Get Sidekick.dc.html shows the same three (test/oneclick-pages.test.mjs compares them).
export const SHORT_STEPS = (file) => [
  `Open ${file} and drag Sidekick into Applications.`,
  'Open Sidekick. On the macOS warning choose Done, then open System Settings › Privacy & Security and click Open Anyway.',
  'Sidekick opens with nothing to enter. To pair a phone, scan the code it shows with the Sidekick Android app.'
];
const APPLE_SILICON = 'For Macs with Apple silicon (M1 or later).';

// Android: the Play test link as a button, the one line about the Google account, three steps to install and pair.
const android = (release, googleEmail) => {
  const play = release.android && release.android.playTestUrl;
  if (!play) return 'The Android app isn\'t on Google Play yet. We\'ll email you when it is.';
  return `${button('Open Google Play', play)}\n\nIt only works with the Google account you entered: ${googleEmail}. Open it on your Android phone, signed in to that account.\n\n` +
    `INSTALL AND PAIR\n\n${numbered([
      'Open the link on your phone and tap Install. If Google Play says you can\'t join, reply and tell us.',
      'Open Sidekick on the phone and tap Get started.',
      'Tap Scan the code and scan the code on your Mac.'
    ])}`;
};

export const emails = {
  // The email flow, used when no place can be given on the page (pool empty, daily cap, beta full).
  confirm: ({ name, confirmUrl, updatesUrl, downloadUrl, android: wantsAndroid = false }) => ({
    kind: 'confirm',
    subject: 'Confirm your email for the Sidekick beta',
    text: hi(name, n => withName(n, 'Confirm your email')) + '\n\nOne click finishes your sign-up for the Sidekick beta. The link works for 48 hours.' +
      `\n\n${button('Confirm my email', confirmUrl)}` +
      `\n\nAfter you confirm, we email you your beta invitation, usually within a day.${wantsAndroid ? ' We also add your Google account to the Android test list and email you its Google Play link.' : ''}` +
      (downloadUrl ? `\n\nYou can download the Mac app now. ${APPLE_SILICON}\n\n${button('Download for Mac', downloadUrl)}` : '') +
      (updatesUrl ? `\n\nYou also asked for Sidekick updates by email. We'll only send them if you confirm that too.\n\n${button('Yes, send me updates', updatesUrl)}` : '') +
      `\n\nIf you didn't sign up, ignore this email. Unconfirmed sign-ups are deleted after 7 days.${footer(false)}`
  }),
  // A repeat sign-up whose invitation is still on its way: the download link now.
  access: ({ name, downloadUrl }) => ({
    kind: 'access',
    subject: 'Your Sidekick download link',
    text: hi(name, n => withName(n, 'Here is your download link')) + `\n\nYou already signed up for the Sidekick beta. ${APPLE_SILICON}\n\n${button('Download for Mac', downloadUrl)}` +
      `\n\nIf you didn't ask for this, ignore this email.${footer()}`
  }),
  // "Email me a copy" on the result page, or a repeat sign-up of someone already in: what the page showed (the
  // download and three steps), sent only to the address on the sign-up.
  copy: ({ name, downloadUrl, release }) => {
    const n = firstName(name), b = release.mac.builds.arm64;
    return {
      kind: 'copy',
      subject: n ? `You're in, ${n}: your Sidekick beta` : 'Your Sidekick beta',
      text: withName(n, "You're in") + `\n\nHere is your Sidekick beta: the Mac app and three install steps. ${APPLE_SILICON}\n\n` +
        `${button('Download for Mac', downloadUrl)}\n\nINSTALL IN THREE STEPS\n\n${numbered(SHORT_STEPS(b.file))}${footer()}`
    };
  },
  // The updates opt-in of an instant sign-up: still double opt-in, and only when ticked in that submission.
  updates: ({ name, updatesUrl }) => ({
    kind: 'updates',
    subject: 'Confirm Sidekick updates',
    text: hi(name, n => withName(n, 'One more step')) + '\n\nYou asked for Sidekick updates by email. We\'ll only send them if you confirm. The link works for 7 days.' +
      `\n\n${button('Yes, send me updates', updatesUrl)}\n\nIf you didn't ask, ignore this email: nothing will be sent.${footer(false)}`
  }),
  // An instant sign-up's Android part, once its Google account is on the Play test list (play-mark-added or the group).
  android: ({ name, release, googleEmail }) => ({
    kind: 'android',
    subject: 'Sidekick for Android: your Google Play link',
    text: hi(name, n => withName(n, 'Sidekick for Android is ready')) + `\n\nYour Google account is on Sidekick's Google Play test list now.\n\n${android(release, googleEmail)}${footer()}`
  }),
  waitlist: ({ name }) => ({
    kind: 'waitlist',
    subject: "You're on the Sidekick waitlist",
    text: hi(name, n => withName(n, "You're on the waitlist")) + '\n\nThanks for confirming your email. The beta is full for now. We\'ll email you when a place opens. There\'s nothing else to do.' + footer()
  }),
  // The invitation of the email flow: where the apps come from. The only email the signer's token step sends.
  // downloadUrl is /download/mac (the server falls back to the Drive folder by itself while there is no direct link).
  invite: ({ name, downloadUrl, release, googleEmail }) => {
    const b = release.mac.builds.arm64;
    const and = googleEmail ? `THE ANDROID APP\n\n${android(release, googleEmail)}`
      : 'THE ANDROID APP\n\nYou didn\'t ask for the Android app. If you want it later, reply with the Google account your phone uses for Google Play.';
    return {
      kind: 'invite',
      subject: 'Your Sidekick beta invitation',
      text: hi(name, n => withName(n, "You're in")) + `\n\nWelcome to the Sidekick beta. ${APPLE_SILICON}\n\n` +
        `${button('Download for Mac', downloadUrl)}\n\nINSTALL IN THREE STEPS\n\n${numbered(SHORT_STEPS(b.file))}\n\n${and}${footer()}`
    };
  },
  // An update, to people who asked for updates and confirmed by email. Each copy has its own one-use link.
  announce: ({ subject, body, unsubscribeUrl }) => ({
    kind: 'announce',
    subject,
    text: `${body.replace(/\r\n?/g, '\n').trim()}\n\n— Sidekick\n\nYou get this because you asked for Sidekick updates and confirmed by email.\n` +
      `To stop them, open this link and press Unsubscribe (it works once):\n${unsubscribeUrl}\nOr reply to this email with "unsubscribe" and we'll remove you.`
  })
};
