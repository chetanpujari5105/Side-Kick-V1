// Release facts: data/releases.json is the only source. This checks it and shapes the public answer.
export function releaseProblems(r) {
  const p = [];
  const hashOk = (v) => v === null || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
  const bytesOk = (v) => v === null || (Number.isInteger(v) && v > 0);
  if (!r || typeof r !== 'object') return ['not an object'];
  if (typeof r.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.version)) p.push('version');
  const builds = r.mac && r.mac.builds;
  if (!builds || typeof builds !== 'object') p.push('mac.builds');
  else {
    const archs = Object.keys(builds);
    if (archs.length !== 1 || archs[0] !== 'arm64') p.push('mac.builds must hold arm64 only (Apple silicon only; no x64)');
    const b = builds.arm64 || {};
    if (typeof b.file !== 'string' || !/^[A-Za-z0-9._-]+\.dmg$/.test(b.file)) p.push('mac.builds.arm64.file');
    if (!bytesOk(b.bytes)) p.push('mac.builds.arm64.bytes');
    if (!hashOk(b.sha256)) p.push('mac.builds.arm64.sha256');
  }
  const a = r.android || {};
  const ab = a.build || {};
  if (!bytesOk(ab.bytes ?? null)) p.push('android.build.bytes');
  if (!hashOk(ab.sha256 ?? null)) p.push('android.build.sha256');
  if (a.storeUrl !== null && a.storeUrl !== undefined && !(typeof a.storeUrl === 'string' && /^https:\/\/play\.google\.com\/[A-Za-z0-9/?=&._-]*$/.test(a.storeUrl))) p.push('android.storeUrl must be null or https://play.google.com/…');
  if (!Array.isArray(r.changelog)) p.push('changelog');
  return p;
}

export function publicReleases(r) {
  const { _comment, ...rest } = r;
  return rest;
}
