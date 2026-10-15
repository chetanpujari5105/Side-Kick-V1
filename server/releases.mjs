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
  // The invited-beta links on the unlisted Beta page: null (not available) or https on exactly these hosts.
  if (!linkOn((r.mac || {}).betaDriveUrl, 'drive.google.com', /^\/drive\/folders\/[A-Za-z0-9_-]{10,100}$/)) p.push('mac.betaDriveUrl must be null or https://drive.google.com/drive/folders/…');
  const a = r.android || {};
  if (a.build !== undefined) p.push('android.build is not allowed: this site never serves an APK (store URL or nothing)');
  if (a.storeUrl !== null && a.storeUrl !== undefined && !(typeof a.storeUrl === 'string' && /^https:\/\/play\.google\.com\/[A-Za-z0-9/?=&._-]*$/.test(a.storeUrl))) p.push('android.storeUrl must be null or https://play.google.com/…');
  if (!linkOn(a.playTestUrl, 'play.google.com', /^\/apps\/internaltest\/\d{6,30}$/)) p.push('android.playTestUrl must be null or https://play.google.com/apps/internaltest/…');
  if (!Array.isArray(r.changelog)) p.push('changelog');
  return p;
}

// null means "not available yet". Anything else must be exactly an https URL on `host`, with a path matching
// `pathRe` and no port, credentials, query or fragment. A missing key is a problem: the page needs both.
function linkOn(v, host, pathRe) {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^https:\/\/[A-Za-z0-9./_-]+$/.test(v)) return false;
  let u;
  try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' && u.hostname === host && !u.port && !u.username && !u.search && !u.hash && u.href === v && pathRe.test(u.pathname);
}

export function publicReleases(r) {
  const { _comment, ...rest } = r;
  return rest;
}
