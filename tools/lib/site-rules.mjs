// What a visitor of the automated site must never read, and where it may send them (launch log Part 16). Used by
// test/site-audit.test.mjs (server-rendered and static pages) and tools/browser-e2e.mjs (the rendered pages).
export const DEV_TEXT = /\bTODO\b|FIXME|\bDRAFT\b|lorem ipsum|\bundefined\b|\bNaN\b|\{\{|\}\}|data\/site-config|launch log|\.dc\.html|\.mjs\b|\bmock\b|stand-in|test key|localhost|127\.0\.0\.1|\[set on|\[sidekick-domain/i;
// The product illustration on Home shows a sample link; it is a picture of the app, not a link.
export const ILLUSTRATION = /harbourlights\.example\/tour/g;
export const EXTERNAL_OK = [/^https:\/\/github\.com\/chetanpujari5105\/Side-Kick-V1\/releases\//, /^https:\/\/play\.google\.com\/apps\/internaltest\//, /^https:\/\/play\.google\.com\/apps\/testing\/com\.chetan\.connectsuite$/, /^https:\/\/drive\.google\.com\/drive\/folders\//, /^https:\/\/challenges\.cloudflare\.com\//, /^mailto:chetanpujari\.sitit@gmail\.com(\?|$)/];
