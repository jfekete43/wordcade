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
       /\/og-card\.png\?v=[0-9a-f]{8}$/.test(parsed.image) && fs.existsSync(REPO('og-card.png')), parsed.image);
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

// ---- one URL per page ----------------------------------------------------
//
// Google sent two "pages not indexed" notices a few days apart, and they were
// the same duplicate at two stages. GitHub Pages serves the homepage at both
// / and /index.html. Before canonicals existed here (they arrived 2026-10-01)
// Google saw two identical URLs with no instruction and chose one itself:
// "Duplicate without user-selected canonical". Once the canonical landed it
// obeyed that instead: "Alternate page with proper canonical tag" - the same
// pair, now resolved.
//
// What kept feeding the crawler that second URL was seventeen internal links
// written href="index.html". They are all href="/" now. Both halves are
// pinned below, because either one coming back re-opens the same notice.
const allHtml = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'tests' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.html')) allHtml.push(path.relative(REPO_DIR, full));
  }
})(REPO_DIR);
// The generated Gauntlet pages are the ones most likely to drift, since they
// come out of a renderer rather than being edited by hand.
ck('the sweep reaches the generated pages too', allHtml.length > pages.length,
   `${allHtml.length} html files, ${pages.length} at the root`);

// Every directory on this host serves its index.html at the bare path, so a
// link naming the file is always a link to a duplicate URL. There is no
// legitimate one.
const DUPE_LINK = /href=["'][^"']*index\.html(?:[#?][^"']*)?["']/;
const offenders = allHtml.filter((f) => DUPE_LINK.test(fs.readFileSync(REPO(f), 'utf8')));
ck('no page links to a URL that is only ever folded into another',
   offenders.length === 0, offenders.join(', '));
ck('and the sitemap does not list one either',
   !listed.some((u) => /index\.html$/.test(u)),
   listed.filter((u) => /index\.html$/.test(u)).join(' '));

// A page with no canonical is exactly the state that produced the first
// notice: a duplicate Google has to guess about.
const noCanonical = allHtml.filter((f) => {
  const src = fs.readFileSync(REPO(f), 'utf8');
  if (/name="robots" content="noindex/.test(src)) return false; // deliberately out of the index
  return !/<link rel="canonical" href="[^"]+"/.test(src);
});
ck('every indexable page declares a canonical', noCanonical.length === 0, noCanonical.join(', '));

// Two pages claiming one canonical means one of them is asking to be dropped.
const canonOwner = new Map();
const collisions = [];
for (const f of allHtml) {
  const c = grab(fs.readFileSync(REPO(f), 'utf8'), /<link rel="canonical" href="([^"]+)"/);
  if (!c) continue;
  if (canonOwner.has(c)) collisions.push(`${f} and ${canonOwner.get(c)} both claim ${c}`);
  else canonOwner.set(c, f);
}
ck('and no two pages claim the same one', collisions.length === 0, collisions.join('; '));

for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
