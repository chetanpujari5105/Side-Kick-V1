// Small server-rendered pages: the email-link landing pages and the no-JavaScript signup form.
// System fonts and one nonce'd <style>, so the strict CSP in http.mjs holds.
import { esc } from './http.mjs';
import { MSG } from './validate.mjs';

const STYLE = `body{margin:0;background:#F6F3EC;color:#17142E;font:17px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
main{max-width:620px;margin:0 auto;padding:48px 20px}h1{font-size:40px;line-height:1;letter-spacing:-.03em;margin:0 0 16px}
p{color:#55526B}a{color:#5B3DF5}:focus-visible{outline:2px solid #5B3DF5;outline-offset:2px}
.card{background:#fff;border:1px solid rgba(23,20,46,.1);border-radius:24px;padding:28px;display:flex;flex-direction:column;gap:18px}
label{font-weight:600;font-size:15px}.f{display:flex;flex-direction:column;gap:8px}
input[type=text],input[type=email]{height:54px;padding:0 16px;border-radius:14px;border:1.5px solid rgba(23,20,46,.22);font:17px Inter,sans-serif}
input[aria-invalid=true]{border-color:#D9432F;background:#FFF8F6}.err{color:#B3341F;font-size:14.5px}.hint{color:#55526B;font-size:14.5px}
fieldset{border:0;margin:0;padding:0}legend{font-weight:600;font-size:15px;padding:0 0 8px}.row{display:flex;gap:10px;align-items:flex-start}
button{min-height:56px;padding:0 30px;border-radius:999px;background:#C6FF33;border:1.5px solid #17142E;color:#17142E;font:600 17px Inter,sans-serif;cursor:pointer}
.m0{margin:0}.alert{border-radius:16px;background:#FCEBE7;border:1.5px solid #D9432F;padding:16px 18px}.alert a{color:#B3341F}`;

function shell({ title, nonce, body, siteKey }) {
  const ts = siteKey ? `<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Sidekick</title><style nonce="${nonce}">${STYLE}</style>${ts}</head>
<body><main id="main">${body}<p><a href="/">Sidekick home</a> · <a href="/Support.dc.html#help">Help</a></p></main></body></html>`;
}

const widget = (siteKey) => siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>` : '';

// purpose: 'confirm' | 'updates' | 'notify' | 'access'
export function linkPage({ purpose, t, nonce, siteKey, valid }) {
  const copy = {
    confirm: ['Confirm your email', 'One click to finish signing up for the Sidekick beta.', 'Confirm my email', '/api/confirm-email'],
    updates: ['Confirm Sidekick updates', 'One click and we\'ll email you Sidekick updates. Every update has a one-click unsubscribe link.', 'Yes, email me updates', '/api/confirm-email'],
    notify: ['Confirm this notification', 'One click and we\'ll email you once when this roadmap item ships.', 'Confirm', '/api/confirm-email'],
    access: ['Open your downloads', 'This takes you to your Sidekick download page in this browser.', 'Open my download page', '/api/access']
  }[purpose];
  if (!valid) return shell({ title: 'Link expired', nonce, body: `<h1>This link has expired.</h1><p>Links in our emails work for a limited time and some only once. Fill in the <a href="/Get%20Sidekick.dc.html">Get Sidekick form</a> again with the same email and we'll send a new one.</p>` });
  return shell({ title: copy[0], nonce, siteKey, body: `<h1>${esc(copy[0])}</h1><form class="card" method="post" action="${copy[3]}">
<p class="m0">${esc(copy[1])}</p><input type="hidden" name="t" value="${esc(t)}">${widget(siteKey)}
<noscript><p class="alert m0">The human check needs JavaScript. Turn it on and reload this page, or <a href="/Support.dc.html#help">ask us for help</a>.</p></noscript>
<button type="submit">${esc(copy[2])}</button></form>` });
}

export function messagePage({ nonce, title, text, status = 200 }) {
  return { status, body: shell({ title, nonce, body: `<h1>${esc(title)}</h1><p>${esc(text)}</p>` }) };
}

// The signup form for browsers without JavaScript, with errors. Field names match the JSON API.
export function signupFormPage({ nonce, siteKey, values = {}, errors = {}, banner = '' }) {
  const ids = { name: 'f-name', email: 'f-email', macChip: 'f-chip', phoneModel: 'f-phone', privacyAccepted: 'f-privacy' };
  const keys = Object.keys(ids).filter(k => errors[k]);
  const inv = (k) => errors[k] ? ` aria-invalid="true" aria-describedby="e-${k}${k === 'phoneModel' ? ' h-phone' : ''}"` : (k === 'phoneModel' ? ' aria-describedby="h-phone"' : '');
  const err = (k) => errors[k] ? `<span class="err" id="e-${k}">${esc(errors[k])}</span>` : '';
  const summary = banner ? `<div class="alert" role="alert" tabindex="-1" autofocus>${banner}</div>`
    : keys.length ? `<div class="alert" role="alert" tabindex="-1" id="err-summary" autofocus><strong>Please fix ${keys.length === 1 ? '1 thing' : keys.length + ' things'} before continuing:</strong><ul>${keys.map(k => `<li><a href="#${ids[k]}">${esc(errors[k])}</a></li>`).join('')}</ul></div>` : '';
  const chip = (v, label) => `<label class="row"><input type="radio" name="macChip" value="${v}"${values.macChip === v ? ' checked' : ''}> ${label}</label>`;
  return shell({ title: 'Get Sidekick', nonce, siteKey, body: `<h1>Get Sidekick</h1>${summary}
<form class="card" method="post" action="/api/get-sidekick" novalidate>
<div class="f"><label for="f-name">Name</label><input id="f-name" name="name" type="text" autocomplete="name" value="${esc(values.name)}"${inv('name')}>${err('name')}</div>
<div class="f"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email" value="${esc(values.email)}"${inv('email')}>${err('email')}</div>
<fieldset id="f-chip"${errors.macChip ? ' aria-describedby="e-macChip"' : ''}><legend>Your Mac's chip</legend>${chip('apple', 'Apple silicon')}${chip('unsure', 'Not sure')}${err('macChip')}</fieldset>
<div class="f"><label for="f-phone">Android phone model</label><input id="f-phone" name="phoneModel" type="text" value="${esc(values.phoneModel)}"${inv('phoneModel')}><span class="hint" id="h-phone">Settings › About phone shows the model name.</span>${err('phoneModel')}</div>
<label class="row"><input id="f-privacy" type="checkbox" name="privacyAccepted" value="on"${values.privacyAccepted ? ' checked' : ''}${inv('privacyAccepted')}> <span>I've read the <a href="/Support.dc.html#privacy">Privacy Policy</a>. (required)</span></label>${err('privacyAccepted')}
<label class="row"><input type="checkbox" name="marketingOptIn" value="on"${values.marketingOptIn ? ' checked' : ''}> <span>Email me Sidekick updates. (optional — we'll ask you to confirm)</span></label>
${widget(siteKey)}<button type="submit">Continue</button></form>` });
}

export const NO_JS_BOT = 'We couldn\'t run the human check. It needs JavaScript: turn it on and send the form again. Your answers are still here.';
export const BOT_FAILED = 'We couldn\'t confirm you\'re not a bot. Send the form again. Your answers are still here.';
export const RATE_TEXT = 'Too many tries in a short time. Please wait about 10 minutes and send the form again. Your answers are still here.';
export const SERVER_TEXT = 'We couldn\'t save your details. Nothing was sent and you haven\'t been signed up. Your answers are still here — try again.';
void MSG;
