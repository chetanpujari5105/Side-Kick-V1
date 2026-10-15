// Event logging. Callers pass an event code and, at most, ids; redact() is a second line of defence that
// removes anything shaped like an email, a beta token, a link token, an IP address or a bearer secret.
const PATTERNS = [
  [/SIDEKICK-TRIAL-1\.[A-Za-z0-9_\-.]+/g, '[token]'],
  [/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  [/([?&](?:t|token|sig|X-Amz-Signature)=)[^&\s"]+/gi, '$1[redacted]'],
  [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]'],
  [/\b[A-Za-z0-9_\-]{43,}\b/g, '[secret]']
];

export function redact(text) {
  let s = String(text);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

export function createLogger(sink = (line) => console.log(line)) {
  const emit = (level, event, fields) => {
    const safe = {};
    for (const [k, v] of Object.entries(fields || {})) if (v !== undefined) safe[k] = typeof v === 'string' ? redact(v) : v;
    sink(redact(JSON.stringify({ level, event, ...safe })));
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields)
  };
}
