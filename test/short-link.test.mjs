// The short link (launch log Part 10): /get and /beta lead to the Get Sidekick form, whose real path holds a space.
// vercel.json rewrites both to the API function (a rewrite cannot depend on SITE_MODE), which answers 302 to the form
// in automated mode only; with the kill switch (SITE_MODE=manual) they answer 404 and the manual build is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './helpers.mjs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const FORM = '/Get%20Sidekick.dc.html';
const SHORT = ['/get', '/beta'];

test('(a) automated: GET and HEAD /get and /beta answer 302 to the Get Sidekick form (the Vercel rewrite form too)', async () => {
  const h = setup();
  for (const p of [...SHORT, '/api/index?__route=get']) for (const m of ['GET', 'HEAD']) {
    const r = await h.call(m, p);
    assert.equal(r.status, 302, `${m} ${p}`);
    assert.equal(r.headers.get('location'), FORM, `${m} ${p} → the form`);
    assert.equal(r.headers.get('cache-control'), 'no-store', 'the mode can change: never cached');
  }
  assert.ok(fs.existsSync(new URL('../' + decodeURIComponent(FORM.slice(1)), import.meta.url)), 'the target page exists');
  assert.match(read(decodeURIComponent(FORM.slice(1))), /<form[\s>]/, 'the target page holds the sign-up form');
});

test('(b) vercel.json rewrites exactly /get and /beta to the API function', () => {
  const rw = JSON.parse(read('vercel.json')).rewrites;
  for (const p of SHORT) assert.ok(rw.some(r => r.source === p && r.destination === '/api/index?__route=get'), `rewrite for ${p}`);
  assert.ok(!rw.some(r => /Get Sidekick|Get%20Sidekick/.test(r.destination)), 'no static rewrite: it would serve the form in manual mode too');
});

test('(c) manual (kill switch): /get and /beta answer 404, nothing points at the form', async () => {
  const h = setup({ env: { SITE_MODE: 'manual' } });
  for (const p of [...SHORT, '/api/index?__route=get']) {
    const r = await h.call('GET', p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('location'), null, p);
  }
});

test('(d) only the exact short paths and GET/HEAD', async () => {
  const h = setup();
  for (const p of ['/get/x', '/getx', '/Get', '/beta/', '/api/index?__route=get/x']) assert.equal((await h.call('GET', p)).status, 404, p);
  assert.equal((await h.call('POST', '/get', { json: {} })).status, 405);
});
