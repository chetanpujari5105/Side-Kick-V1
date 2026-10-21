// Writes every email the signer sends — HTML, plain text and the full .eml (as SMTP would send it) — with the dummy
// token only, for checking by eye (launch log Part 11). Files are mode 600 in a mode 700 folder; nothing is sent.
//   node tools/email-preview.mjs [folder]     default ~/Documents/Sidekick-private/email-previews
// Also writes copy-long-token.*: the copy email with a 280-character dummy token, to check that the token card wraps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderEmail, DUMMY_TOKEN, SITE } from '../server/email-html.mjs';
import { buildMime } from './signer/smtp.mjs';
import { previewSamples } from './signer/previews.mjs';
import { CONTACT } from '../server/emails.mjs';

const dir = process.argv[2] || path.join(os.homedir(), 'Documents/Sidekick-private/email-previews');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
const longDummy = (DUMMY_TOKEN + '-PREVIEW-ONLY'.repeat(30)).slice(0, 280);
const samples = previewSamples().concat([['copy-long-token', previewSamples({ token: longDummy })[0][1]]]);
const write = (f, body) => { const p = path.join(dir, f); fs.writeFileSync(p, body, { mode: 0o600 }); fs.chmodSync(p, 0o600); };
for (const [name, m] of samples) {
  const { html, text } = renderEmail(m);
  write(`${name}.html`, html);
  write(`${name}.txt`, `Subject: ${m.subject}\n\n${text}\n`);
  write(`${name}.eml`, buildMime({ from: CONTACT, to: 'preview@example.invalid', subject: m.subject, text, html, messageId: `<preview-${name}@${new URL(SITE).hostname}>` }));
  console.log(`${name.padEnd(16)} ${String(Buffer.byteLength(html)).padStart(6)} bytes HTML  "${m.subject}"`);
}
console.log(`\n${samples.length} previews in ${dir}`);
