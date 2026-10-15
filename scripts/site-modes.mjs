// SITE_MODE: one setting, two sites. Used by scripts/build-site.mjs; tested in test/build.test.mjs.
//   manual     (the default) email-only beta: no backend, no Turnstile, no cookies, no forms. Needs no secret.
//   automated  the full signup → confirm → token → download flow (server/, api/). Needs its environment variables.
// Pages mark code that belongs to one mode only; the build removes the other mode's regions:
//   HTML  <!--AUTOMATED{--> … <!--}AUTOMATED-->      <!--MANUAL{--> … <!--}MANUAL-->
//   JS    /*AUTOMATED{*/ … /*}AUTOMATED*/            /*MANUAL{*/ … /*}MANUAL*/
// An expression region is written `(/*AUTOMATED{*/ value ?? /*}AUTOMATED*/ null)` so it is still valid JS (and
// still `value`) when kept, and `null` when removed. The page also checks SK_CONFIG.siteMode at runtime, so the
// unbuilt source behaves either way.
export const MODES = ['manual', 'automated'];

export function resolveMode(env) {
  const v = env.SITE_MODE;
  if (v === undefined || v === '') return { mode: 'manual', defaulted: true };
  if (!MODES.includes(v)) throw new Error(`SITE_MODE must be "manual" or "automated", not ${JSON.stringify(v)}`);
  return { mode: v, defaulted: false };
}

const REGION = {
  AUTOMATED: [/<!--AUTOMATED\{-->[\s\S]*?<!--\}AUTOMATED-->/g, /\/\*AUTOMATED\{\*\/[\s\S]*?\/\*\}AUTOMATED\*\//g],
  MANUAL: [/<!--MANUAL\{-->[\s\S]*?<!--\}MANUAL-->/g, /\/\*MANUAL\{\*\/[\s\S]*?\/\*\}MANUAL\*\//g]
};
const MARKERS = { AUTOMATED: /<!--AUTOMATED\{-->|<!--\}AUTOMATED-->|\/\*AUTOMATED\{\*\/|\/\*\}AUTOMATED\*\//g, MANUAL: /<!--MANUAL\{-->|<!--\}MANUAL-->|\/\*MANUAL\{\*\/|\/\*\}MANUAL\*\//g };

function balanced(text, name) {
  const open = (text.match(new RegExp(`<!--${name}\\{-->|/\\*${name}\\{\\*/`, 'g')) || []).length;
  const close = (text.match(new RegExp(`<!--\\}${name}-->|/\\*\\}${name}\\*/`, 'g')) || []).length;
  if (open !== close) throw new Error(`unbalanced ${name} region markers (${open} open, ${close} close)`);
}

// Keeps the active mode's regions (markers removed) and deletes the other mode's regions whole.
export function stripRegions(text, mode) {
  balanced(text, 'AUTOMATED'); balanced(text, 'MANUAL');
  const drop = mode === 'manual' ? 'AUTOMATED' : 'MANUAL', keep = mode === 'manual' ? 'MANUAL' : 'AUTOMATED';
  let out = text;
  for (const re of REGION[drop]) out = out.replace(re, '');
  return out.replace(MARKERS[keep], '');
}

// What a manual build must never ship: a backend call, the human check, a cookie or storage write, a form.
const LEAKS = [
  [/\/api\//, 'a call to /api/'],
  [/turnstile/i, 'a Turnstile reference'],
  [/challenges\.cloudflare\.com/, 'a Cloudflare script'],
  [/document\.cookie|cookieStore|sk_session/, 'cookie code'],
  [/sessionStorage|localStorage/, 'browser storage'],
  [/\bSK_API\b|\bSK_BOT\b/, 'the API client or bot check'],
  [/<form\b/i, 'a form'],
  [/\{AUTOMATED|AUTOMATED\}|\{MANUAL|MANUAL\}/, 'a region marker']
];
export function manualLeaks(text) {
  return LEAKS.filter(([re]) => re.test(text)).map(([, what]) => what);
}
