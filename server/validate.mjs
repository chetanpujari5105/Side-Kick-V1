// Input validation. Error strings are the ones in Handoff.md §4 and Get Sidekick.dc.html, word for word.
export const MSG = {
  name: 'Enter your name.',
  emailEmpty: 'Enter your email address.',
  email: 'Enter an email address like name@example.com.',
  chip: "Choose your Mac's chip, or Not sure.",
  phone: 'Enter your phone model, for example the name in Settings › About phone.',
  phoneNumber: "Enter the phone's model name, for example Pixel 8, not its number.",
  googleEmpty: 'Enter the Google account email your phone uses for Google Play.',
  google: 'Enter a Google account email like name@gmail.com.',
  privacy: "Confirm you've read the Privacy Policy to continue.",
  message: 'Write at least 3 characters, and at most 2,000.',
  feature: 'Choose a roadmap item.'
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROL_G = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export const cleanText = (v, max) => (typeof v === 'string' ? v : '').replace(CONTROL_G, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Deliberately strict: one @, no spaces, quotes, angle brackets, commas, semicolons or control characters,
// a dot in the domain. That rules out header injection and display-name tricks in every mail transport.
export function normaliseEmail(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 254 || CONTROL.test(s)) return null;
  if (!/^[^\s@"'<>(),;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(s)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null; // the same rule as the page, so both agree
  return s.toLowerCase();
}

// A phone number typed into "Android phone model": digits with phone punctuation only, or 7+ digits with at most one
// letter. Real model codes (SM-G991B, CPH2449, 2201117TG) have more letters or fewer digits, so they pass.
// Get Sidekick.dc.html's phoneLike is the same expression (test/signup.test.mjs compares them).
export const looksLikePhoneNumber = (s) => { const d = (s.match(/\d/g) || []).length, l = (s.match(/\p{L}/gu) || []).length; return d > 0 && ((l === 0 && /^[\d\s+().\/-]+$/.test(s)) || (d >= 7 && l <= 1)); };

const truthy = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 'yes';

export function validateSignup(body) {
  const fieldErrors = {};
  const rawName = typeof body.name === 'string' ? body.name : '';
  const name = cleanText(rawName, 200);
  if (!name || name.length > 120 || CONTROL.test(rawName.replace(/[\t ]/g, ''))) fieldErrors.name = MSG.name;
  const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const email = normaliseEmail(rawEmail);
  if (!rawEmail) fieldErrors.email = MSG.emailEmpty;
  else if (!email) fieldErrors.email = MSG.email;
  const macChip = body.macChip;
  if (macChip !== 'apple' && macChip !== 'unsure') fieldErrors.macChip = MSG.chip;
  const rawPhone = typeof body.phoneModel === 'string' ? body.phoneModel : '';
  const phoneModel = cleanText(rawPhone, 200);
  if (!phoneModel || phoneModel.length > 120 || CONTROL.test(rawPhone.replace(/[\t ]/g, ''))) fieldErrors.phoneModel = MSG.phone;
  else if (looksLikePhoneNumber(phoneModel)) fieldErrors.phoneModel = MSG.phoneNumber;
  // The Google account the owner adds to the Play test list. Same strict address rule as the email field.
  const rawGoogle = typeof body.googleEmail === 'string' ? body.googleEmail.trim() : '';
  const googleEmail = normaliseEmail(rawGoogle);
  if (!rawGoogle) fieldErrors.googleEmail = MSG.googleEmpty;
  else if (!googleEmail || !/^[a-z0-9]/.test(googleEmail)) fieldErrors.googleEmail = MSG.google; // also keeps the Play CSV free of formulas
  if (!truthy(body.privacyAccepted)) fieldErrors.privacyAccepted = MSG.privacy;
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value: { name, email: rawEmail, emailNorm: email, macChip, phoneModel, googleEmail, marketingOptIn: truthy(body.marketingOptIn) } };
}

// The page's own field keys differ from the API's for two fields; map server errors back for the page.
export const PAGE_FIELD = { name: 'name', email: 'email', macChip: 'chip', phoneModel: 'phone', googleEmail: 'google', privacyAccepted: 'privacy' };

export function validateFeedback(body) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const fieldErrors = {};
  if (message.length < 3 || message.length > 2000) fieldErrors.message = MSG.message;
  let email = null;
  if (body.email !== undefined && body.email !== null && String(body.email).trim() !== '') {
    email = normaliseEmail(String(body.email));
    if (!email) fieldErrors.email = MSG.email;
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value: { message: message.replace(/\u0000/g, ''), email } };
}

export function validateNotify(body, featureIds) {
  const fieldErrors = {};
  const email = normaliseEmail(typeof body.email === 'string' ? body.email : '');
  if (!email) fieldErrors.email = MSG.email;
  if (typeof body.featureId !== 'string' || !featureIds.has(body.featureId)) fieldErrors.featureId = MSG.feature;
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value: { email, featureId: body.featureId } };
}

// SIDEKICK-TRIAL-1.<payload>.<signature>: base64url parts, and a 64-byte Ed25519 signature is 86 characters
// (ConnectSuite docs/token-entry-2026-10-14.md §1–2). The shape is all the server can check: the app verifies.
export function isTokenShaped(t) {
  return typeof t === 'string' && t.length <= 4096 && /^SIDEKICK-TRIAL-1\.[A-Za-z0-9_-]{8,3000}\.[A-Za-z0-9_-]{86}$/.test(t);
}

// The label the issuer writes into the token (shown in the app's Settings › About): the name, tidied.
export const tokenLabel = (name) => cleanText(name, 60).replace(/["`$\\]/g, '') || 'Beta tester';
