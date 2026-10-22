// Small server-rendered pages: the email-link landing pages and the no-JavaScript signup form.
// System fonts and one nonce'd <style>, so the strict CSP in http.mjs holds.
import { esc } from './http.mjs';
import { MSG } from './validate.mjs';
import { SHORT_STEPS } from './emails.mjs';
import { tokenEndText } from './pool.mjs';

const STYLE = `body{margin:0;background:#F6F3EC;color:#17142E;font:17px/1.55 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
main{max-width:620px;margin:0 auto;padding:48px 20px}h1{font-size:40px;line-height:1;letter-spacing:-.03em;margin:0 0 16px}
p{color:#55526B}a{color:#5B3DF5}:focus-visible{outline:2px solid #5B3DF5;outline-offset:2px}
.card{background:#fff;border:1px solid rgba(23,20,46,.1);border-radius:24px;padding:28px;display:flex;flex-direction:column;gap:18px}
label{font-weight:600;font-size:15px}.f{display:flex;flex-direction:column;gap:8px}
input[type=text],input[type=email]{height:54px;padding:0 16px;border-radius:14px;border:1.5px solid rgba(23,20,46,.22);font:17px Inter,sans-serif}
input[aria-invalid=true]{border-color:#D9432F;background:#FFF8F6}.err{color:#B3341F;font-size:14.5px}.hint{color:#55526B;font-size:14.5px}
fieldset{border:0;margin:0;padding:0}legend{font-weight:600;font-size:15px;padding:0 0 8px}.row{display:flex;gap:10px;align-items:flex-start}
button{min-height:56px;padding:0 30px;border-radius:999px;background:#C6FF33;border:1.5px solid #17142E;color:#17142E;font:600 17px Inter,sans-serif;cursor:pointer}
[hidden]{display:none!important}.m0{margin:0}.alert{border-radius:16px;background:#FCEBE7;border:1.5px solid #D9432F;padding:16px 18px}.alert a{color:#B3341F}
a.btn{display:inline-flex;align-items:center;min-height:56px;padding:0 30px;border-radius:999px;background:#C6FF33;border:1.5px solid #17142E;color:#17142E;font:600 17px Inter,sans-serif;text-decoration:none;box-sizing:border-box}
code.tok{display:block;font:13.5px/1.5 ui-monospace,Menlo,monospace;word-break:break-all;background:#F6F3EC;border-radius:12px;padding:12px 14px;user-select:all}
button.sec{min-height:44px;padding:0 18px;background:#fff;font-size:15px}ol{margin:0;padding-left:22px}details summary{cursor:pointer;font-weight:600}`;

function shell({ title, nonce, body, siteKey }) {
  const ts = siteKey && siteKey !== 'local-dev-fake' ? `<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><title>${esc(title)} · Sidekick</title><style nonce="${nonce}">${STYLE}</style>${ts}</head>
<body><main id="main">${body}<p><a href="/">Sidekick home</a> · <a href="/Support.dc.html#help">Help</a></p></main></body></html>`;
}

// 'local-dev-fake' exists only for npm run dev; on Vercel the key is checked (config) and Cloudflare rejects dummy tokens.
const widget = (siteKey) => siteKey === 'local-dev-fake' ? '<p class="hint m0">Human check (local test stand-in)</p><input type="hidden" name="cf-turnstile-response" value="XXXX.DUMMY.TOKEN.XXXX">'
  : siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div>` : '';

// Why an email link was refused (launch log Part 20): a tester pressed a confirm link twice and read "This link has
// expired" as their beta token having expired. A used link says so, and every refusal says the key is not affected.
// The form is offered only for a new link someone still needs, never as the next step for a link that did its job.
export const LINK_NOTE = 'Your beta key is not affected. This page is only about the link in our email; Sidekick shows how long your key works in Settings › About.';
const AGAIN = 'If you still need it, fill in the <a href="/Get%20Sidekick.dc.html">Get Sidekick form</a> again with the same email and we\'ll send a new link.';
const REFUSED = {
  used: {
    confirm: ['Link already used', 'This link has already been used.', 'You already confirmed your email with it. There\'s nothing else to do: we email you what comes next.'],
    updates: ['Link already used', 'This link has already been used.', 'You already confirmed Sidekick updates with it. There\'s nothing else to do.'],
    access: ['Link already used', 'This link has already been used.', `It opens your download page a few times only, and those are used up. ${AGAIN}`]
  },
  expired: ['Link expired', 'This link has expired.', `Links in our emails work for a limited time. If you already did what this link was for, there's nothing else to do. ${AGAIN}`],
  incomplete: ['Link incomplete', 'This link is incomplete.', 'Part of the link from our email is missing. Open the email again and use its button, or copy the whole link into the address bar.']
};

// purpose: 'confirm' | 'updates' | 'access' | 'unsubscribe' (roadmap 'notify' is closed: launch log Part 14)
// reason (only when !valid): 'used' | 'expired' (also an unknown link) | 'incomplete'
export function linkPage({ purpose, nonce, siteKey, valid, reason = 'expired' }) {
  const copy = {
    confirm: ['Confirm your email', 'One click to finish signing up for the Sidekick beta.', 'Confirm my email', '/api/confirm-email'],
    updates: ['Confirm Sidekick updates', 'One click and we\'ll email you Sidekick updates. To stop them, write to us at the address on our Privacy page.', 'Yes, email me updates', '/api/confirm-email'],
    access: ['Open your downloads', 'This takes you to your Sidekick download page in this browser.', 'Open my download page', '/api/access'],
    unsubscribe: ['Stop Sidekick updates', 'One click and we stop sending you Sidekick update emails. Emails about your own beta place, if you have one, still come.', 'Unsubscribe', '/api/unsubscribe']
  }[purpose];
  const noscript = purpose === 'unsubscribe'
    ? 'This page needs JavaScript to read the link. Without it, reply to any of our update emails with “unsubscribe” and we\'ll remove you.'
    : 'The human check needs JavaScript. Turn it on and reload this page, or <a href="/Support.dc.html#help">ask us for help</a>.';
  if (!valid) {
    const [title, h, text] = reason === 'used' ? (REFUSED.used[purpose] || REFUSED.expired) : (REFUSED[reason] || REFUSED.expired);
    return shell({ title, nonce, body: `<h1>${esc(h)}</h1><p>${text}</p><p>${esc(LINK_NOTE)}</p>` });
  }
  return shell({ title: copy[0], nonce, siteKey, body: `<h1>${esc(copy[0])}</h1><form class="card" method="post" action="${copy[3]}">
<p class="m0">${esc(copy[1])}</p><input type="hidden" name="t" id="t" value="">${widget(siteKey)}
<p class="alert m0" id="nolink" hidden>This page needs the whole link from our email. Open the email again and use its link, or copy all of it into the address bar.</p>
<noscript><p class="alert m0">${noscript}</p></noscript>
<button type="submit">${esc(copy[2])}</button></form>
<script nonce="${nonce}">(function(){var m=location.hash.match(/[#&]t=([A-Za-z0-9_-]{43})(?:&|$)/);if(m){document.getElementById('t').value=m[1];history.replaceState(null,'',location.pathname+location.search);}else{document.getElementById('nolink').hidden=false;}})();</script>` });
}

// The result page's Android line, per ANDROID_ACCESS (Get Sidekick.dc.html shows the same words).
export const ANDROID_TEXT = {
  'manual-batch': "Android: we're adding your Google account to the test list. Your Google Play link comes by email, usually within a day.",
  'google-group': "Android: we're adding your Google account to the test list. Your Google Play link comes by email, usually within the hour."
};

// The instant result (launch log Part 7) for a browser without JavaScript: the form post answers with this page.
// The token is shown here once, so nothing here navigates this tab away (launch log Part 8): no meta refresh, and the
// download is a normal link that opens a new tab, whether /download/mac sends the file itself or the Drive folder.
// Short content (launch log Part 11): one download link, three steps; the checksum only under More details; no Drive.
// The token's end date under the token (launch log Part 20); Get Sidekick.dc.html says the same (resUntil).
export const untilLine = (until) => `It works until ${until}. If Sidekick later says your beta access has ended, write to us for a new token.`;
export function resultPage({ nonce, firstName, token, download, release, android }) {
  const b = release.mac.builds.arm64, until = tokenEndText(token);
  const button = `<p class="m0"><a class="btn" href="${download.url}" target="_blank" rel="noopener">Download the Mac app</a></p>`;
  const steps = SHORT_STEPS(b.file).map(x => `<li class="step">${esc(x)}</li>`).join('');
  const all = (release.mac.installSteps || []).map(x => `<li>${esc(x)}</li>`).join('');
  const androidBlock = android === 'manual-batch'
    ? `<section class="card"><p class="m0">${esc(ANDROID_TEXT['manual-batch'])}</p></section>`
    : android === 'google-group' ? `<section class="card"><p class="m0">${esc(ANDROID_TEXT['google-group'])}</p></section>` : '';
  const body = `<h1>You're in, ${esc(firstName)}.</h1>${button}
<section class="card" aria-labelledby="tok-h"><h2 id="tok-h" class="m0">Your beta token</h2><p class="m0">Paste it in Sidekick the first time you open it. It is shown only here, so copy it now (or use Email me a copy below).</p>
<code class="tok" id="tok">${esc(token)}</code><button type="button" class="sec" id="copy" hidden>Copy</button>${until ? `<p class="m0">${esc(untilLine(until))}</p>` : ''}</section>
<section class="card" aria-labelledby="inst-h"><h2 id="inst-h" class="m0">Install</h2><ol>${steps}</ol>
<details><summary>More details</summary><ol>${all}</ol><p>SHA-256 of ${esc(b.file)} (to check the download; not your token):<br><code>${esc(b.sha256 || 'not staged yet')}</code></p></details></section>
${androidBlock}<form method="post" action="/api/email-copy"><button type="submit" class="sec">Email me a copy</button></form>
<script nonce="${nonce}">(function(){var b=document.getElementById('copy'),t=document.getElementById('tok');if(!b||!t)return;b.hidden=false;b.addEventListener('click',function(){var v=t.textContent;var ok=function(){b.textContent='Copied';};var sel=function(){var r=document.createRange();r.selectNodeContents(t);var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Selected: press Command-C';};if(navigator.clipboard)navigator.clipboard.writeText(v).then(ok,sel);else sel();});})();</script>`;
  return shell({ title: "You're in", nonce, body });
}

// A repeat sign-up: never the token again (anyone could type another person's address); the copy goes by email.
export function alreadyPage({ nonce }) {
  return shell({ title: 'Already signed up', nonce, body: `<h1>You already signed up.</h1><p>We emailed you your link. It comes from our own mailbox, so it can take a while: check your spam folder too.</p><p><a class="btn" href="/download/mac" target="_blank" rel="noopener">Download the Mac app</a></p>` });
}

export function messagePage({ nonce, title, text, status = 200 }) {
  return { status, body: shell({ title, nonce, body: `<h1>${esc(title)}</h1><p>${esc(text)}</p>` }) };
}

// The signup form for browsers without JavaScript, with errors. Field names match the JSON API.
export function signupFormPage({ nonce, siteKey, values = {}, errors = {}, banner = '' }) {
  const ids = { name: 'f-name', email: 'f-email', macChip: 'f-name', phoneModel: 'f-phone', googleEmail: 'f-google', privacyAccepted: 'f-privacy' };
  const keys = Object.keys(ids).filter(k => errors[k]);
  const hint = { phoneModel: 'h-phone', googleEmail: 'h-google' };
  const inv = (k) => errors[k] ? ` aria-invalid="true" aria-describedby="e-${k}${hint[k] ? ' ' + hint[k] : ''}"` : (hint[k] ? ` aria-describedby="${hint[k]}"` : '');
  const err = (k) => errors[k] ? `<span class="err" id="e-${k}">${esc(errors[k])}</span>` : '';
  const summary = banner ? `<div class="alert" role="alert" tabindex="-1" autofocus>${banner}</div>`
    : keys.length ? `<div class="alert" role="alert" tabindex="-1" id="err-summary" autofocus><strong>Please fix ${keys.length === 1 ? '1 thing' : keys.length + ' things'} before continuing:</strong><ul>${keys.map(k => `<li><a href="#${ids[k]}">${esc(errors[k])}</a></li>`).join('')}</ul></div>` : '';
  const chip = (v, label) => `<label class="row"><input type="radio" name="macChip" value="${v}"${values.macChip === v ? ' checked' : ''}> ${label}</label>`;
  return shell({ title: 'Get Sidekick', nonce, siteKey, body: `<h1>Get Sidekick</h1>${summary}${signupForm({ values, errors, siteKey, inv, err, chip })}` });
}

// The <form> alone: also embedded in Get Sidekick.dc.html's <noscript> by the production build.
export function signupFormHtml() {
  const chip = (v, label) => `<label class="row"><input type="radio" name="macChip" value="${v}"> ${label}</label>`;
  const hint = { phoneModel: 'h-phone', googleEmail: 'h-google' };
  return signupForm({ values: {}, errors: {}, siteKey: null, inv: (k) => hint[k] ? ` aria-describedby="${hint[k]}"` : '', err: () => '', chip });
}

// The disabled first submit button is the form's default button, so Enter in a text field sends nothing (HTML
// implicit submission). Chrome still presses Continue on Enter on a box or radio; without JavaScript the human check
// then refuses it (Get Sidekick.dc.html stops that key with script). The updates box is sent only ticked ("on").
function signupForm({ values, errors, siteKey, inv, err, chip }) {
  return `<form class="card" method="post" action="/api/get-sidekick" novalidate>
<button type="submit" disabled hidden aria-hidden="true" tabindex="-1"></button>
<div class="f"><label for="f-name">Name</label><input id="f-name" name="name" type="text" autocomplete="name" value="${esc(values.name)}"${inv('name')}>${err('name')}</div>
<div class="f"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email" value="${esc(values.email)}"${inv('email')}>${err('email')}</div>
<p class="hint m0">For Macs with Apple silicon (M1 or later).</p>
<label class="row"><input id="f-android" type="checkbox" name="android" value="on"${values.android ? ' checked' : ''}> <span>I also want the Android app (Google Play test). (optional)</span></label>
<div class="f"><label for="f-phone">Android phone model <span class="hint">(only with Android)</span></label><input id="f-phone" name="phoneModel" type="text" value="${esc(values.phoneModel)}"${inv('phoneModel')}><span class="hint" id="h-phone">The model name, like Pixel 8 or Galaxy S23 — not your phone number. Settings › About phone shows it.</span>${err('phoneModel')}</div>
<div class="f"><label for="f-google">Google account email for Google Play <span class="hint">(only with Android)</span></label><input id="f-google" name="googleEmail" type="email" autocomplete="off" value="${esc(values.googleEmail)}"${inv('googleEmail')}><span class="hint" id="h-google">The account your phone's Play Store uses. We add it to Sidekick's Google Play test list so you can install the Android app.</span>${err('googleEmail')}</div>
<label class="row"><input id="f-privacy" type="checkbox" name="privacyAccepted" value="on"${values.privacyAccepted ? ' checked' : ''}${inv('privacyAccepted')}> <span>I've read the <a href="/Support.dc.html#privacy">Privacy Policy</a>. (required)</span></label>${err('privacyAccepted')}
<label class="row"><input type="checkbox" name="marketingOptIn" value="on"${values.marketingOptIn ? ' checked' : ''}> <span>Email me Sidekick updates. (optional — we'll ask you to confirm)</span></label>
${widget(siteKey)}<button type="submit">Get the Mac app</button></form>`;
}

export const FORM_STYLE = STYLE;

export const NO_JS_BOT = 'We couldn\'t run the human check. It needs JavaScript: turn it on and send the form again. Your answers are still here.';
export const BOT_FAILED = 'We couldn\'t confirm you\'re not a bot. Send the form again. Your answers are still here.';
export const RATE_TEXT = 'Too many tries in a short time. Please wait about 10 minutes and send the form again. Your answers are still here.';
export const SERVER_TEXT = 'We couldn\'t save your details. Nothing was sent and you haven\'t been signed up. Your answers are still here — try again.';
void MSG;
