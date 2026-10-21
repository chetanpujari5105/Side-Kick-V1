// What search engines read on the automated site (launch log Part 19). Used by scripts/build-site.mjs; tested in
// test/domain.test.mjs and tools/check-links.mjs. The manual site gets none of it (its bytes stay as they were).
//   - the site's address: APP_ORIGIN (a bare https origin), the same variable the API uses for its links and checks;
//   - the public pages (PUBLIC_PAGES) get a canonical link and an absolute share image (og:image, twitter:image);
//   - robots.txt lets every crawler in, except the download route (each GET counts a download), and names the sitemap;
//   - sitemap.xml lists the public pages only. Download, Beta, check-email, 404 and the server pages (confirm, updates,
//     access, unsubscribe) stay noindex and out of it. Support's sub-pages (#setup, #help, #permissions, #privacy,
//     #changelog) are one URL: a crawler ignores the part after #.
export const DEFAULT_ORIGIN = 'https://sidekickapp.in';

// [path in the URL, file in dist/]
export const PUBLIC_PAGES = [
  ['/', 'Home.dc.html'],
  ['/Get%20Sidekick.dc.html', 'Get Sidekick.dc.html'],
  ['/Roadmap.dc.html', 'Roadmap.dc.html'],
  ['/Support.dc.html', 'Support.dc.html']
];

// The site's address for the automated build. Production must name it; elsewhere (local, tests, a Preview without it)
// it defaults to the real domain, so a canonical never points at a throwaway host by accident.
export function siteOrigin(env) {
  const v = env.APP_ORIGIN;
  if (v === undefined || v === '') {
    if (env.VERCEL_ENV === 'production') throw new Error('APP_ORIGIN is not set for this Production build (it names the canonical address).');
    return DEFAULT_ORIGIN;
  }
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(v)) throw new Error('APP_ORIGIN must be a bare https origin, like https://sidekickapp.in (no path, no trailing slash).');
  return v;
}

export const robotsTxt = (origin) => `# Sidekick: every crawler may read the site, except the download route (each request counts a download).
User-agent: *
Allow: /
Disallow: /download/

Sitemap: ${origin}/sitemap.xml
`;

export const sitemapXml = (origin) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PUBLIC_PAGES.map(([p]) => `  <url><loc>${origin}${p}</loc></url>`).join('\n')}
</urlset>
`;

// A public page's <head>: the placeholder note becomes the canonical link, the share image becomes absolute and
// twitter:image is added. Each piece must be found exactly once, or the build fails.
const OG = '<meta property="og:image" content="icons/og-image.png">';
const NOTE = /<!-- PLACEHOLDER: og:image must become an absolute URL[\s\S]*?-->/g;
const CARD = '<meta name="twitter:card" content="summary_large_image">';
export function seoHead(html, origin, urlPath) {
  const head = html.split('</head>')[0];
  const once = (n, what) => { if (n !== 1) throw new Error(`${what} found ${n} times in the <head> (expected once)`); };
  once(head.split(OG).length - 1, 'the relative og:image');
  once((head.match(NOTE) || []).length, 'the og:image placeholder note');
  once(head.split(CARD).length - 1, 'twitter:card');
  const image = `${origin}/icons/og-image.png`;
  const out = head.replace(NOTE, `<link rel="canonical" href="${origin}${urlPath}">`)
    .replace(OG, `<meta property="og:image" content="${image}">`)
    .replace(CARD, `${CARD}\n<meta name="twitter:image" content="${image}">`);
  return out + html.slice(head.length);
}
