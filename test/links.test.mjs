// Every internal link, fragment and email link form resolves (tools/check-links.mjs, offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks } from '../tools/check-links.mjs';

test('links: every internal link and every email link form resolves on the built site', async () => {
  const { rows, failures, checked } = await checkLinks();
  assert.ok(checked > 100, `only ${checked} links found: the extractor broke`);
  assert.ok(rows.some(r => r.area === 'email' && /access: page script reads/.test(r.what)), 'email walk ran');
  assert.deepEqual(failures.map(f => `${f.area} ${f.what} ${f.note}`), []);
});
