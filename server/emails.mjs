// The emails, as plain text in one simple shape that server/email-html.mjs turns into the branded HTML version (launch
// log Part 11): the first line is the headline; "Label:" on a line above a lone https link is a button; a line in
// CAPITALS is a section label; a token line on its own is the token card; "1. …" lines are numbered steps; "— Sidekick"
// starts the footer. The signer sends both versions (multipart) through Gmail SMTP, or this text alone through Mail.app.
// Subjects are constants except the first name in the copy's (tidied: one word, no control characters) and an
// announcement's, which only the owner sets (admin announce, checked for line breaks).
// Short content: one download link (/download/mac) and three install steps; no Drive folder, no SHA-256, no "full steps".
import { cleanText } from './validate.mjs';

export const CONTACT = 'chetanpujari.sitit@gmail.com';
// The token's length, as the Mac app's docs state it: "signed, time-boxed tokens, 45 days"
// (ConnectSuite docs/trial-licence-summary-2026-10-11.md, "Decided and built"). The signer issues --days 45.
export const TOKEN_DAYS = 45;

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
  'Paste your beta token when Sidekick asks for it (press Paste token).'
];
const APPLE_SILICON = 'For Macs with Apple silicon (M1 or later).';
const COPY_HINT = 'Select and copy the whole line, from SIDEKICK-TRIAL-1 to its last character.';
const tokenFacts = `It works for ${TOKEN_DAYS} days from the day it was made. It is yours: please don't share it. Sidekick checks it on your Mac and sends it nowhere.`;

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
  // The email flow, used when no token can be handed out on the page (pool empty, daily cap, beta full).
  confirm: ({ name, confirmUrl, updatesUrl, downloadUrl, android: wantsAndroid = false }) => ({
    kind: 'confirm',
    subject: 'Confirm your email for the Sidekick beta',
    text: hi(name, n => withName(n, 'Confirm your email')) + '\n\nOne click finishes your sign-up for the Sidekick beta. The link works for 48 hours.' +
      `\n\n${button('Confirm my email', confirmUrl)}` +
      `\n\nAfter you confirm, we email your beta token, usually within a day.${wantsAndroid ? ' We also add your Google account to the Android test list and email you its Google Play link.' : ''}` +
      (downloadUrl ? `\n\nYou can download the Mac app now. ${APPLE_SILICON}\n\n${button('Download for Mac', downloadUrl)}` : '') +
      (updatesUrl ? `\n\nYou also asked for Sidekick updates by email. We'll only send them if you confirm that too.\n\n${button('Yes, send me updates', updatesUrl)}` : '') +
      `\n\nIf you didn't sign up, ignore this email. Unconfirmed sign-ups are deleted after 7 days.${footer(false)}`
  }),
  // A repeat sign-up whose token is still on its way: the download link (no token here; it has its own email).
  access: ({ name, downloadUrl }) => ({
    kind: 'access',
    subject: 'Your Sidekick download link',
    text: hi(name, n => withName(n, 'Here is your download link')) + `\n\nYou already signed up for the Sidekick beta. ${APPLE_SILICON}\n\n${button('Download for Mac', downloadUrl)}` +
      `\n\nYour beta token comes in its own email, "Your Sidekick beta token". If it has already come, use that one. If you didn't ask for this, ignore this email.${footer()}`
  }),
  // "Email me a copy" on the result page, or a repeat sign-up of someone who already has a token: what the page
  // showed, sent only to the address on the sign-up. token is null when it has already been erased (after 46 days).
  copy: ({ name, token, downloadUrl, release }) => {
    const n = firstName(name), b = release.mac.builds.arm64;
    const tok = token ? `YOUR BETA TOKEN\n\n${token}\n\n${COPY_HINT} ${tokenFacts}`
      : 'YOUR BETA TOKEN\n\nIt was on the page you saw when you signed up, or in our earlier email. If you can\'t find it, reply to this email.';
    return {
      kind: 'copy',
      subject: n ? `You're in, ${n}: your Sidekick beta` : 'Your Sidekick beta',
      text: withName(n, "You're in") + `\n\nHere is your Sidekick beta: the Mac app, your beta token and three install steps. ${APPLE_SILICON}\n\n` +
        `${button('Download for Mac', downloadUrl)}\n\n${tok}\n\nINSTALL IN THREE STEPS\n\n${numbered(SHORT_STEPS(b.file))}${footer()}`
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
  // The invitation of the email flow: where the apps come from. Never the token (that is its own email).
  // downloadUrl is /download/mac (the server falls back to the Drive folder by itself while there is no direct link).
  invite: ({ name, downloadUrl, release, googleEmail }) => {
    const b = release.mac.builds.arm64;
    const and = googleEmail ? `THE ANDROID APP\n\n${android(release, googleEmail)}`
      : 'THE ANDROID APP\n\nYou didn\'t ask for the Android app. If you want it later, reply with the Google account your phone uses for Google Play.';
    return {
      kind: 'invite',
      subject: 'Your Sidekick beta invitation',
      text: hi(name, n => withName(n, "You're in")) + `\n\nWelcome to the Sidekick beta. Your beta token comes in a separate email, "Your Sidekick beta token". ${APPLE_SILICON}\n\n` +
        `${button('Download for Mac', downloadUrl)}\n\nINSTALL IN THREE STEPS\n\n${numbered(SHORT_STEPS(b.file))}\n\n${and}${footer()}`
    };
  },
  // The token, alone on its own line, with how to enter it. No link of any kind: it travels apart from the download.
  token: ({ name, token }) => ({
    kind: 'token',
    subject: 'Your Sidekick beta token',
    text: hi(name, n => withName(n, 'Here is your beta token')) + `\n\nYOUR BETA TOKEN\n\n${token}\n\n${COPY_HINT} ${tokenFacts}\n\nHOW TO ENTER IT\n\n` +
      numbered([
        'Install Sidekick on your Mac first (the steps are in our other email, "Your Sidekick beta invitation").',
        'Copy the whole token line above.',
        'Open Sidekick. The first time, it shows "Enter your beta token": press Paste token. To enter a new token later, use Settings › About › Beta access.'
      ]) + footer()
  }),
  notify: ({ confirmUrl }) => ({
    kind: 'notify',
    subject: 'Confirm: email me when this Sidekick feature ships',
    text: `One click to confirm.\n\nConfirm that you'd like one email when this roadmap item ships. The link works for 7 days.\n\n${button('Yes, email me when it ships', confirmUrl)}` +
      `\n\nIf you didn't ask, ignore this email and we'll delete the address after 7 days.\n\n— Sidekick\n\n${why}`
  }),
  // An update, to people who asked for updates and confirmed by email. Each copy has its own one-use link.
  announce: ({ subject, body, unsubscribeUrl }) => ({
    kind: 'announce',
    subject,
    text: `${body.replace(/\r\n?/g, '\n').trim()}\n\n— Sidekick\n\nYou get this because you asked for Sidekick updates and confirmed by email.\n` +
      `To stop them, open this link and press Unsubscribe (it works once):\n${unsubscribeUrl}\nOr reply to this email with "unsubscribe" and we'll remove you.`
  })
};
