/*
 * What a search engine is told about each page.
 *
 * This is the half of the site that no human ever looks at, which is exactly
 * why it rots. Every title and description on this site once led with
 * "Lexathon" — a brand with no search volume — so the pages were invisible to
 * anyone who did not already know the name. Nothing caught that, because
 * nothing was looking.
 *
 * What is pinned here is the stuff that silently breaks: a title Google will
 * truncate, two pages claiming the same title, a description that is empty or
 * a novel, structured data that no longer parses, a canonical pointing
 * somewhere else. Not the wording — wording is the author's business.
 *
 * The page list is read off disk. A hardcoded one is how 404.html stayed
 * invisible to every suite in this repo until it was found by accident.
 *
 * Pure; no browser, no emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = (f) => path.join(REPO_DIR, f);

const t = [];
const ck = (name, cond, detail = '') => t.push({ name, cond: !!cond, detail });

const pages = fs.readdirSync(REPO_DIR).filter((f) => f.endsWith('.html')).sort();
ck('found the site pages', pages.length >= 8, pages.join(','));

const read = (f) => fs.readFileSync(REPO(f), 'utf8');
const grab = (src, re) => { const m = src.match(re); return m ? m[1] : null; };

const seen = { title: new Map(), desc: new Map() };
for (const page of pages) {
  const src = read(page);
  const title = grab(src, /<title>([^<]*)<\/title>/);
  const desc = grab(src, /<meta name="description" content="([^"]*)"/);

  ck(`${page}: has a title`, !!title && title.trim().length > 0);
  ck(`${page}: has a description`, !!desc && desc.trim().length > 0);
  if (!title || !desc) continue;

  // Google truncates a title around 60 characters and a description around
  // 155. Over that is not an error, it is just text nobody will ever read.
  ck(`${page}: title fits in a result (<= 65)`, title.length <= 65, `${title.length} chars`);
  ck(`${page}: description fits in a result (<= 165)`, desc.length <= 165, `${desc.length} chars`);
  // And under-length is its own failure: a three-word description tells a
  // searcher nothing and gets replaced by whatever Google scrapes instead.
  ck(`${page}: description is long enough to be useful (>= 50)`, desc.length >= 50, `${desc.length} chars`);

  // Duplicate titles across pages make them compete with each other.
  for (const [key, val] of [['title', title], ['desc', desc]]) {
    const prev = seen[key].get(val);
    ck(`${page}: ${key} is not a duplicate of another page`, !prev, prev ? `same as ${prev}` : '');
    seen[key].set(val, page);
  }

  // A title that is only the brand ranks for the brand and nothing else, which
  // is the state every page on this site was in.
  ck(`${page}: the title says more than the brand name`,
     title.replace(/Lexathon/gi, '').replace(/[^a-z]/gi, '').length > 8, title);

  // The <title> and the card title are deliberately different - one is a
  // browser tab, the other sits under an image already showing the wordmark -
  // but both have to exist and neither may be empty.
  const ogTitle = grab(src, /<meta property="og:title" content="([^"]*)"/);
  ck(`${page}: has a card title too`, !!ogTitle && ogTitle.trim().length > 0, String(ogTitle));
}

// ---- the homepage carries the structured data ----------------------------
// Everything above the intro is a JS-built game board, so this is one of the
// few unambiguous signals a crawler gets about what the page is.
const home = read('index.html');
const ld = grab(home, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
ck('the homepage has structured data', !!ld, 'no ld+json block');
if (ld) {
  let parsed = null;
  try { parsed = JSON.parse(ld); } catch (e) { /* reported below */ }
  ck('and it parses as JSON', !!parsed, parsed ? '' : 'JSON.parse threw');
  if (parsed) {
    ck('it declares a schema.org context', parsed['@context'] === 'https://schema.org', String(parsed['@context']));
    ck('and a type', !!parsed['@type'], String(parsed['@type']));
    for (const k of ['name', 'url', 'description', 'image']) {
      ck(`it carries ${k}`, !!parsed[k], String(parsed[k]));
    }
    // Contradicting your own page is worse than saying nothing, so the facts
    // in the markup and the facts in the data have to agree.
    ck('its url matches the homepage canonical',
       parsed.url.replace(/\/$/, '') === (grab(home, /<link rel="canonical" href="([^"]*)"/) || '').replace(/\/$/, ''),
       `${parsed.url} vs ${grab(home, /<link rel="canonical" href="([^"]*)"/)}`);
    ck('its image is the card that exists',
       parsed.image.endsWith('/og-card.png') && fs.existsSync(REPO('og-card.png')), parsed.image);
    ck('it says free, and the page says free too',
       parsed.isAccessibleForFree === true && /\bfree\b/i.test(home), String(parsed.isAccessibleForFree));
    ck('and prices it at zero to match', parsed.offers && parsed.offers.price === '0', JSON.stringify(parsed.offers));
  }
}

// ---- crawlability --------------------------------------------------------
const robots = read('robots.txt');
ck('robots.txt does not block the site', !/^Disallow: \/$/m.test(robots), robots.slice(0, 80));
ck('robots.txt points at the sitemap', /Sitemap:\s*https:\/\//i.test(robots));
const sitemap = read('sitemap.xml');
// Every indexable page should be listed, and nothing that should not be.
const listed = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
ck('the sitemap lists the homepage', listed.some((u) => /lexathon\.gg\/?$/.test(u)), listed.slice(0, 3).join(' '));
for (const page of ['how-to-play.html', 'strategy.html', 'faq.html', 'about.html']) {
  ck(`the sitemap lists ${page}`, listed.some((u) => u.endsWith(page)), '');
}
ck('and does not list the 404', !listed.some((u) => u.endsWith('404.html')));
ck('404 is marked noindex so it cannot outrank a real page',
   /name="robots" content="noindex/.test(read('404.html')));

for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
