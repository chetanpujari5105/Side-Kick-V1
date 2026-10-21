// The branded HTML version of every email (launch log Part 11), rendered from the plain text server/emails.mjs writes
// (see the shape described there). The signer renders it at send time, so the outbox keeps storing plain text only and
// the Mail.app fallback sends exactly that text.
// Email-client rules: one column at most 600 px, role="presentation" tables, every style inline plus bgcolor attributes
// (the <style> block only adds dark-mode and phone overrides), a web-safe font stack, 16 px body text, a hidden
// preheader, table-cell buttons over 44 px tall, absolute https URLs, and alt/width/height on every image.
// The site's address (launch log Part 19). The signer passes the address it talks to (SK_API_BASE) as `site`, so the
// logo and the footer follow the site through a change of address; this is the default.
export const SITE = 'https://sidekickapp.in';
export const LOGO_URL = SITE + '/email/logo.png';
// The only token the previews and `signer --send-test` ever show. Not token-shaped (server/validate.mjs isTokenShaped),
// so the app refuses it and the server never stores it.
export const DUMMY_TOKEN = 'SIDEKICK-TRIAL-1.PREVIEW-ONLY';
const CONTACT = 'chetanpujari.sitit@gmail.com';

const C = { cream: '#F6F3EC', ink: '#17142E', muted: '#55526B', lime: '#C6FF33', violet: '#5B3DF5', lavender: '#E8E2FF', white: '#FFFFFF', line: '#E6E1D6', black: '#0A0A0A', onInk: '#C9C6DA' };
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "'Bricolage Grotesque', " + SANS;
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const TOKEN_LINE = /^SIDEKICK-TRIAL-1\.[A-Za-z0-9._-]+$/;
const URL_LINE = /^https:\/\/[^\s<>"]+$/;
const URL_ANY = /https:\/\/[^\s<>"]+/g;
const LABEL = /^(?=.*[A-Z])[A-Z0-9 '’&:,-]{3,40}$/;
const STEP = /^\d+\. \S/;
const HINT = /^Select and copy the whole line/;

// The text → blocks. Everything after the line "— Sidekick" is the footer.
export function parseEmail(text) {
  const t = String(text).replace(/\r\n?/g, '\n').trim();
  const at = t.search(/^— Sidekick$/m);
  const body = (at >= 0 ? t.slice(0, at) : t).trim(), foot = at >= 0 ? t.slice(at + '— Sidekick'.length).trim() : '';
  const paras = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const blocks = paras.map((p, i) => {
    const lines = p.split('\n');
    if (i === 0 && lines.length === 1 && p.length <= 90 && paras.length > 1 && !URL_LINE.test(p) && !TOKEN_LINE.test(p)) return { type: 'headline', text: p };
    if (lines.length === 1 && TOKEN_LINE.test(p)) return { type: 'token', token: p };
    if (lines.length === 1 && LABEL.test(p)) return { type: 'label', text: p };
    if (lines.length === 2 && /:$/.test(lines[0]) && lines[0].length <= 48 && !/https?:/.test(lines[0]) && URL_LINE.test(lines[1])) return { type: 'button', label: lines[0].slice(0, -1), url: lines[1] };
    if (lines.every(l => STEP.test(l))) return { type: 'steps', items: lines.map(l => l.replace(/^\d+\. /, '')) };
    return { type: 'para', lines };
  });
  return { blocks, signed: at >= 0, footer: foot ? foot.split(/\n{2,}/).map(p => p.split('\n')) : [] };
}

// Text with its https links (and our address) made into links; everything escaped.
const linkify = (s, color) => {
  let out = '', last = 0;
  for (const m of s.matchAll(URL_ANY)) {
    out += esc(s.slice(last, m.index)).split(esc(CONTACT)).join(`<a href="mailto:${CONTACT}" class="sk-link" style="color:${color};text-decoration:underline;">${esc(CONTACT)}</a>`);
    out += `<a href="${esc(m[0])}" target="_blank" rel="noopener" class="sk-link" style="color:${color};text-decoration:underline;word-break:break-all;">${esc(m[0])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last)).split(esc(CONTACT)).join(`<a href="mailto:${CONTACT}" class="sk-link" style="color:${color};text-decoration:underline;">${esc(CONTACT)}</a>`);
};
const T = (attrs = '') => `<table role="presentation" border="0" cellpadding="0" cellspacing="0"${attrs}>`;
const wrapToken = (t) => esc(t).replace(/(.{20})/g, '$1<wbr>');

const P = (inner, extra = '') => `<p class="sk-text" style="margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.ink};${extra}" data-sk="body">${inner}</p>`;
const headline = (s) => `<h1 class="sk-text sk-h1" style="margin:0 0 14px;font-family:${DISPLAY};font-size:34px;line-height:38px;font-weight:800;letter-spacing:-0.5px;color:${C.ink};">${esc(s)}</h1>`;
const label = (s) => `<p class="sk-accent" style="margin:30px 0 12px;font-family:${SANS};font-size:13px;line-height:18px;font-weight:700;letter-spacing:1.2px;color:${C.violet};">${esc(s)}</p>`;
const button = ({ label: l, url }, primary) => `${T(' style="margin:6px 0 26px;border-collapse:separate;"')}<tr><td align="center" bgcolor="${primary ? C.lime : C.white}" style="background-color:${primary ? C.lime : C.white};border:2px solid ${C.ink};border-radius:999px;">` +
  `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:${primary ? 17 : 16}px;line-height:22px;font-weight:700;color:${C.ink};text-decoration:none;border-radius:999px;">${esc(l)}</a></td></tr></table>`;
const tokenCard = (token, title, hint) => `${T(' width="100%" style="margin:0 0 26px;border-collapse:separate;"')}<tr><td bgcolor="${C.ink}" style="background-color:${C.ink};border:2px solid ${C.ink};border-radius:18px;padding:18px 18px 16px;" data-sk="token">` +
  `<p style="margin:0 0 10px;font-family:${MONO};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.5px;color:${C.lime};">${esc(title || 'YOUR BETA TOKEN')}</p>` +
  `<div style="margin:0;padding:14px 16px;background-color:${C.black};border:1px solid #3A3654;border-radius:12px;font-family:${MONO};font-size:14px;line-height:22px;color:${C.cream};word-break:break-all;overflow-wrap:anywhere;word-wrap:break-word;-webkit-user-select:all;user-select:all;">${wrapToken(token)}</div>` +
  `<p style="margin:12px 0 0;font-family:${SANS};font-size:15px;line-height:22px;color:${C.onInk};">${esc(hint || 'Select and copy the whole line.')}</p></td></tr></table><!--data-sk="token-end"-->`;
const steps = (items) => `${T(' width="100%" style="margin:0 0 26px;border-collapse:separate;"')}<tr><td bgcolor="${C.lavender}" class="sk-lav" style="background-color:${C.lavender};border-radius:18px;padding:20px 20px 6px;">${T(' width="100%" style="width:100%;"')}` +
  items.map((s, i) => `<tr data-sk="step"><td width="32" valign="top" style="width:32px;padding:0 14px 14px 0;">${T(' style="border-collapse:separate;"')}<tr><td width="32" height="32" align="center" valign="middle" bgcolor="${C.ink}" style="width:32px;height:32px;border-radius:16px;background-color:${C.ink};font-family:${SANS};font-size:15px;line-height:32px;font-weight:700;color:${C.lime};text-align:center;" data-sk="badge">${i + 1}</td></tr></table></td>` +
    `<td valign="top" class="sk-text" style="padding:4px 0 14px;font-family:${SANS};font-size:16px;line-height:24px;color:${C.ink};">${linkify(s, C.violet)}</td></tr>`).join('') + '</table></td></tr></table>';

const preheaderOf = (blocks) => {
  const p = blocks.find(b => b.type === 'para');
  const s = p ? p.lines.join(' ').replace(URL_ANY, '').replace(/SIDEKICK-TRIAL-1\.\S+/g, '').replace(/\s+/g, ' ').trim() : '';
  return s.length <= 110 ? s : s.slice(0, 109).replace(/\s+\S*$/, '') + '…';
};

export function renderEmail({ subject, text }, { site = SITE } = {}) {
  const { blocks, signed, footer } = parseEmail(text);
  const out = [];
  let buttons = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], next = blocks[i + 1];
    if (b.type === 'headline') out.push(headline(b.text));
    else if (b.type === 'label' && next && next.type === 'token') continue; // the label goes inside the card
    else if (b.type === 'label') out.push(label(b.text));
    else if (b.type === 'token') {
      const prev = blocks[i - 1], after = blocks[i + 1];
      const hint = after && after.type === 'para' && HINT.test(after.lines.join(' ')) ? after.lines.join(' ') : null;
      out.push(tokenCard(b.token, prev && prev.type === 'label' ? prev.text : null, hint));
      if (hint) i++;
    }
    else if (b.type === 'button') out.push(button(b, buttons++ === 0));
    else if (b.type === 'steps') out.push(steps(b.items));
    else out.push(P(b.lines.map(l => linkify(l, C.violet)).join('<br>')));
  }
  if (signed) out.push(`<p class="sk-text" style="margin:8px 0 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:600;color:${C.ink};">— Sidekick</p>`);
  const foot = footer.map(lines => `<p class="sk-muted" style="margin:0 0 10px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};">${lines.map(l => linkify(l, C.muted)).join('<br>')}</p>`).join('') +
    `<p class="sk-muted" style="margin:14px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.muted};">Sidekick · <a href="${site}/" target="_blank" rel="noopener" class="sk-link" style="color:${C.muted};text-decoration:underline;">${esc(new URL(site).host)}</a></p>`;
  const pre = preheaderOf(blocks);
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject || 'Sidekick')}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme: dark){
.sk-bg{background-color:#100E1F !important;}
.sk-card{background-color:#1B1830 !important;border-color:#2E2A4A !important;}
.sk-text{color:#F6F3EC !important;}
.sk-muted{color:#B8B5CC !important;}
.sk-accent,.sk-link{color:#C9BDFF !important;}
.sk-lav{background-color:#2A2550 !important;}
}
[data-ogsc] .sk-text{color:#F6F3EC !important;}
[data-ogsc] .sk-muted{color:#B8B5CC !important;}
[data-ogsc] .sk-accent,[data-ogsc] .sk-link{color:#C9BDFF !important;}
[data-ogsb] .sk-bg{background-color:#100E1F !important;}
[data-ogsb] .sk-card{background-color:#1B1830 !important;}
[data-ogsb] .sk-lav{background-color:#2A2550 !important;}
@media only screen and (max-width:620px){
.sk-outer{padding:16px 10px 24px !important;}
.sk-pad{padding:28px 22px 22px !important;}
.sk-h1{font-size:30px !important;line-height:34px !important;}
}
</style>
</head>
<body class="sk-bg" bgcolor="${C.cream}" style="margin:0;padding:0;width:100%;background-color:${C.cream};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.cream};">${esc(pre)}${'&#8199;&#847;'.repeat(40)}</div>
${T(` width="100%" bgcolor="${C.cream}" class="sk-bg" style="background-color:${C.cream};"`)}<tr><td align="center" class="sk-outer" style="padding:28px 12px 32px;">
<!--[if mso]>${T(' width="600" align="center" style="width:600px;"')}<tr><td style="padding:0;"><![endif]-->
${T(' width="100%" style="max-width:600px;width:100%;"')}
<tr><td style="padding:0 0 18px;">${T(' style="border-collapse:separate;"')}<tr><td bgcolor="${C.cream}" style="background-color:${C.cream};border-radius:12px;padding:6px 10px;"><a href="${site}/" target="_blank" rel="noopener" style="display:block;text-decoration:none;"><img src="${site}/email/logo.png" width="136" height="36" alt="Sidekick" style="display:block;width:136px;height:36px;border:0;outline:none;text-decoration:none;"></a></td></tr></table></td></tr>
<tr><td class="sk-card sk-pad" bgcolor="${C.white}" style="background-color:${C.white};border:1px solid ${C.line};border-radius:24px;padding:36px 40px 30px;">
${out.join('\n')}
</td></tr>
<tr><td class="sk-pad" style="padding:22px 40px 8px;">${foot}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
  return { html, text: String(text) };
}
