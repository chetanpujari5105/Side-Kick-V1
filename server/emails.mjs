// Plain-text emails. Subjects are constants (no user text in any header); names are tidied before use.
import { cleanText } from './validate.mjs';

const first = (name) => cleanText(name, 120).split(' ')[0].slice(0, 40) || 'there';
const sign = '\n\n— Sidekick\nThis email was sent because someone entered this address on the Sidekick website.';

export const emails = {
  confirm: ({ name, confirmUrl, updatesUrl }) => ({
    kind: 'confirm',
    subject: 'Confirm your email for the Sidekick beta',
    text: `Hi ${first(name)},\n\nConfirm your email to finish signing up for the Sidekick beta:\n${confirmUrl}\n\nThe link works for 48 hours.` +
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
  token: ({ name, token, accessUrl }) => ({
    kind: 'token',
    subject: 'Your Sidekick beta token',
    text: `Hi ${first(name)},\n\nYou're in. Here is your beta token. The Mac app asks for it the first time it opens. Copy all of it, from SIDEKICK-TRIAL-1 to the end:\n\n${token}\n\n` +
      `It is yours: please don't share it. It works for 45 days.\n\nDownload Sidekick for your Mac from your download page:\n${accessUrl}\n\nThe page link works for 72 hours. Each download button gives you a fresh, short-lived file link.${sign}`
  }),
  notify: ({ confirmUrl }) => ({
    kind: 'notify',
    subject: 'Confirm: email me when this Sidekick feature ships',
    text: `Hi,\n\nConfirm that you'd like one email when this roadmap item ships:\n${confirmUrl}\n\nThe link works for 7 days. If you didn't ask, ignore this email and we'll delete the address after 7 days.${sign}`
  })
};
