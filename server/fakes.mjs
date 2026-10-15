// In-memory stand-ins for the outside world: used by the tests, the local dev server and the demo.
import crypto from 'node:crypto';

export class FakeClock {
  constructor(start = Date.now()) { this.t = start; }
  now() { return this.t; }
  advance(ms) { this.t += ms; }
  set(ms) { this.t = ms; }
}
export const systemClock = { now: () => Date.now() };

// mode: 'pass' | 'fail' | 'timeout' | 'error' | 'hostname' | 'throw'
export class FakeBotCheck {
  constructor() { this.mode = 'pass'; this.calls = 0; }
  async verify(token) {
    this.calls++;
    if (!token) return { ok: false, code: 'missing-input-response' };
    if (this.mode === 'pass') return { ok: true };
    if (this.mode === 'throw') throw new Error('adapter crashed');
    if (this.mode === 'timeout') return { ok: false, code: 'timeout' };
    if (this.mode === 'error') return { ok: false, code: 'network-error' };
    if (this.mode === 'hostname') return { ok: false, code: 'hostname-mismatch' };
    return { ok: false, code: 'invalid-input-response' };
  }
}

// Signs URLs with a key made up at start; check() tells whether a URL is still good.
export class FakeStorage {
  constructor(clock, ttlSeconds = 600) { this.clock = clock; this.ttl = ttlSeconds; this.key = crypto.randomBytes(32); this.failNext = false; }
  async signedUrl({ file }) {
    if (this.failNext) { this.failNext = false; throw new Error('storage unavailable'); }
    const exp = this.clock.now() + this.ttl * 1000;
    const sig = crypto.createHmac('sha256', this.key).update(`${file}:${exp}`).digest('hex');
    return { url: `https://files.example.test/${encodeURIComponent(file)}?exp=${exp}&sig=${sig}`, expiresAt: exp };
  }
  check(url) {
    const u = new URL(url);
    const file = decodeURIComponent(u.pathname.slice(1)), exp = Number(u.searchParams.get('exp'));
    const sig = crypto.createHmac('sha256', this.key).update(`${file}:${exp}`).digest('hex');
    return sig === u.searchParams.get('sig') && exp > this.clock.now();
  }
}

export class MemoryMailer {
  constructor() { this.sent = []; this.mode = 'ok'; }
  async send(msg) {
    if (this.mode === 'fail') return { ok: false, code: 'provider-error' };
    this.sent.push(msg);
    return { ok: true };
  }
}
