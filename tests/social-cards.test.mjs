/*
 * What a shared Lexathon link looks like when it unfurls.
 *
 * This is growth-critical rather than cosmetic: every share path in the game
 * ends in a link to this site — the Standard result, the Gauntlet result, the
 * Clash invite and the FFA invite — so a missing or broken card turns the whole
 * share loop into a bare blue URL in Discord, iMessage, Slack and WhatsApp.
 *
 * It is also the kind of thing nothing else catches. A scraper fetches once,
 * caches hard, and reports nothing when it fails; the page itself looks
 * perfect in a browser either way. So the failure is invisible from inside the
 * product, which is precisely why it is worth a test.
 *
 * The page list is read off disk rather than written out here. A hardcoded
 * list is how 404.html was initially invisible to every other suite: it was
 * added, it carried analytics and a card, and not one check knew it existed.
 *
 * Pure; no browser, no emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

const SITE = 'https://lexathon.gg';
const CARD = 'og-card.png';

const t = [];
const ok = (name, cond, detail = '') => t.push({ name, cond: !!cond, detail });

// Every page at the repo root, found rather than listed.
const pages = fs.readdirSync(REPO).filter((f) => f.endsWith('.html')).sort();
ok('found the site pages on disk', pages.length >= 8, pages.join(','));
ok('and the list includes the ones added last', pages.includes('404.html') && pages.includes('index.html'),
   pages.join(','));

// ---- the card image itself -----------------------------------------------
const cardPath = path.join(REPO, CARD);
ok('the card image exists', fs.existsSync(cardPath), CARD);
let dims = null, kb = 0;
if (fs.existsSync(cardPath)) {
  const buf = fs.readFileSync(cardPath);
  kb = Math.round(buf.length / 1024);
  // PNG: 8-byte signature, then the IHDR chunk whose width and height are
  // big-endian 32-bit at offsets 16 and 20.
  ok('it is a real PNG', buf.slice(1, 4).toString() === 'PNG', buf.slice(0, 8).toString('hex'));
  dims = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // 1200x630 is the size Twitter's summary_large_image, Facebook and Discord
  // all render without re-cropping; 1.91:1 is the ratio they crop toward.
  ok('it is 1200x630', dims.w === 1200 && dims.h === 630, `${dims.w}x${dims.h}`);
  // Twitter rejects over 5 MB and several scrapers give up well before that.
  ok('and small enough that a scraper will fetch it', kb > 0 && kb < 1024, `${kb} KB`);
}

// ---- the tags, on every page ---------------------------------------------
const need = [
  'og:type', 'og:site_name', 'og:url', 'og:title', 'og:description',
  'og:image', 'og:image:width', 'og:image:height',
];
const attr = (src, kind, key) => {
  const m = src.match(new RegExp(`<meta ${kind}="${key.replace(/:/g, ':')}" content="([^"]*)"`));
  return m ? m[1] : null;
};
for (const page of pages) {
  const src = read(page);
  // 404.html is served for every unmatched path, so it has no one URL it could
  // honestly claim as its own - and therefore no og:url and no canonical.
  const wants = page === '404.html' ? need.filter((k) => k !== 'og:url') : need;
  for (const k of wants) ok(`${page}: has ${k}`, attr(src, 'property', k) !== null);
  ok(`${page}: has twitter:card`, attr(src, 'name', 'twitter:card') === 'summary_large_image',
     String(attr(src, 'name', 'twitter:card')));
  ok(`${page}: has twitter:image`, attr(src, 'name', 'twitter:image') !== null);

  // Scrapers do NOT resolve relative URLs. A card referenced as "/og-card.png"
  // simply does not appear, and the page looks fine in a browser regardless.
  const img = attr(src, 'property', 'og:image');
  ok(`${page}: the image url is absolute`, img && img.startsWith('https://'), String(img));
  ok(`${page}: and points at the card that exists`, img === `${SITE}/${CARD}`, String(img));
  ok(`${page}: twitter:image matches og:image`, attr(src, 'name', 'twitter:image') === img);

  // The declared size has to be the real size, or Twitter lays out a gap.
  if (dims) {
    ok(`${page}: declares the real image width`, attr(src, 'property', 'og:image:width') === String(dims.w));
    ok(`${page}: declares the real image height`, attr(src, 'property', 'og:image:height') === String(dims.h));
  }

  // og:url and the canonical must agree, or a scraper and a crawler disagree
  // about which URL this page is.
  const ogUrl = attr(src, 'property', 'og:url');
  const canon = (src.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || null;
  if (page === '404.html') {
    ok('404.html claims no url it cannot honour', ogUrl === null && canon === null, `${ogUrl} / ${canon}`);
  } else {
    ok(`${page}: has a canonical url`, !!canon, String(canon));
    ok(`${page}: og:url agrees with it`, ogUrl === canon, `${ogUrl} vs ${canon}`);
    ok(`${page}: the canonical is absolute`, canon && canon.startsWith(SITE), String(canon));
  }

  // A card gets one line. Discord and Twitter cut around 200 characters, and a
  // cut mid-word reads as a bug.
  const desc = attr(src, 'property', 'og:description');
  ok(`${page}: the description is short enough to survive`, desc && desc.length <= 200, `${desc && desc.length} chars`);
  ok(`${page}: and is not empty`, desc && desc.trim().length > 20, String(desc));
  const title = attr(src, 'property', 'og:title');
  ok(`${page}: the card title is short enough`, title && title.length <= 70, `${title && title.length} chars`);
}

// ---- the generated archive pages, which come out of a renderer ------------
// These are the pages most likely to be posted on their own, and they are the
// ones in sitemap.xml. They are built, not written, so they need the renderer
// checked rather than a file.
const renderer = read('tools/gauntlet-archive-render.mjs');
for (const k of [...need, 'twitter:card', 'twitter:image']) {
  ok(`the archive generator emits ${k}`, renderer.includes(`"${k}"`), k);
}
ok('the generated card url is absolute too', /content="\$\{SITE\}\/og-card\.png"/.test(renderer));

// ---- 404 ------------------------------------------------------------------
const notFound = read('404.html');
ok('404 tells crawlers not to index it', /name="robots" content="noindex/.test(notFound));
// A 404 in the sitemap is a self-inflicted crawl error.
ok('404 is not listed in the sitemap', !read('sitemap.xml').includes('404.html'));
ok('404 carries the shared stylesheet, not a bare page', /\.container\s*\{/.test(notFound));
ok('404 links back to the game', /href="\/"/.test(notFound));
ok('404 links to the archive, which is where a dead day-page lands',
   notFound.includes('href="/gauntlet/"'));

for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
