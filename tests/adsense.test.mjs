/*
 * The AdSense tag, and the policy that has to agree with it.
 *
 * Google requires the script in the head of every page: it is how the site is
 * verified and, later, how ads are placed. That is a real change in posture,
 * because the rest of this site contacts Google only after a yes - gtag.js is
 * injected on Accept and not before. The ad script cannot work that way: a
 * review cannot accept cookies, so a tag behind consent is a tag Google never
 * sees.
 *
 * What makes it defensible is the thing most likely to be quietly undone:
 * consent.js queues ad_storage, ad_user_data and ad_personalization as DENIED
 * before anything loads, and Accept grants analytics_storage ALONE. If that
 * ever drifts, the site starts setting advertising cookies and the privacy
 * policy becomes false in the same moment, silently.
 *
 * So this suite holds three things together:
 *   - every page carries the tag, in the head, with the publisher id ads.txt
 *     names - one id, not two that agree until one is edited;
 *   - the three advertising signals are denied and never granted;
 *   - privacy.html describes that, and no longer says the opposite.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = (f) => path.join(DIR, '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ---- one publisher id, taken from ads.txt ---------------------------------
const adsTxt = read('ads.txt');
// ads.txt writes it `pub-NNN` and the script tag writes it `ca-pub-NNN`.
// The number is the identity the two share, so that is what is compared -
// matching the prefixes would be comparing two spellings of nothing.
const pubNum = (adsTxt.match(/\bpub-(\d+)/) || [])[1];
const pub = pubNum ? 'ca-pub-' + pubNum : '';
ck(!!pubNum, 'ads.txt names a publisher', adsTxt.trim());
ck(/^google\.com,\s*pub-\d+,\s*DIRECT,/m.test(adsTxt),
   'in the line format Google parses', adsTxt.trim());

// ---- every page Google can land on ----------------------------------------
const pages = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(REPO(dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'tests' || e.name.startsWith('.')) continue;
    if (e.name === 'admin.html') continue;   // internal tooling - see the note below
    // play/ is the card-less landing a shared score links to: noindex, and
    // on screen for about one frame before its redirect fires. An ad unit on
    // a page with no content and no reader is the "low content" problem this
    // site has already been told off for, not revenue. See
    // tests/share-no-card.test.mjs, which pins what it does and does not do.
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (rel === 'play/index.html') continue;
    if (e.isDirectory()) walk(rel);
    else if (e.name.endsWith('.html')) pages.push(rel);
  }
};
walk('');
ck(pages.length >= 8, 'found the site’s pages', String(pages.length));

const missing = [], outside = [], wrongId = [];
for (const f of pages) {
  const s = read(f);
  const i = s.indexOf('adsbygoogle.js');
  if (i < 0) { missing.push(f); continue; }
  // In the HEAD, which is where Google's instructions put it - a tag in the
  // body still runs, but the instruction is explicit and a review is not the
  // place to be interesting.
  const head = s.indexOf('</head>');
  if (!(head > 0 && i < head)) outside.push(f);
  if (!s.includes(`client=${pub}`)) wrongId.push(f);
}
eq('every page carries the tag', missing, []);
eq('every one of them in the head', outside, []);
eq('and all on the same publisher id as ads.txt', wrongId, []);
ck(pages.some((f) => f.startsWith('gauntlet/')),
   'including the generated archive pages, which are most of the site',
   String(pages.filter((f) => f.startsWith('gauntlet/')).length));

// A page built tomorrow has to carry it too, or the count above is only true
// until the next nightly run.
const gen = read('tools/gauntlet-archive-render.mjs');
ck(gen.includes('adsbygoogle.js'), 'the archive generator emits the tag');
ck(gen.includes(`client=${pub}`), 'with the same id', pub);

// ---- the three signals that keep it honest --------------------------------
const consent = read('consent.js');
const defaults = (consent.match(/gtag\("consent",\s*"default",\s*\{[\s\S]*?\}\)/) || [''])[0];
ck(defaults.length > 40, 'consent.js declares defaults', defaults.slice(0, 60));
for (const sig of ['ad_storage', 'ad_user_data', 'ad_personalization']) {
  ck(new RegExp(`${sig}:\\s*"denied"`).test(defaults), `${sig} starts denied`, defaults);
}
ck(/analytics_storage:\s*"denied"/.test(defaults), 'and so does analytics_storage');

// Accept must move analytics and nothing else. This is the assertion worth
// having: granting all four here is a one-word edit that turns on advertising
// cookies and makes the policy false, with nothing on screen to show it.
const update = (consent.match(/gtag\("consent",\s*"update",\s*\{[^}]*\}\)/) || [''])[0];
ck(update.length > 20, 'and an update on Accept', update);
ck(/analytics_storage:\s*"granted"/.test(update), 'which grants analytics');
for (const sig of ['ad_storage', 'ad_user_data', 'ad_personalization']) {
  ck(!new RegExp(`${sig}:\\s*"granted"`).test(consent),
     `nothing anywhere grants ${sig}`,
     (consent.match(new RegExp(`[^\\n]*${sig}[^\\n]*granted[^\\n]*`)) || [''])[0].trim());
}

// ---- and nothing on the site promises the opposite ------------------------
// The support note on the home page said "free and always will be - no ads,
// no paywall", and all 53 archive pages said "free to play, with no ads". The
// ad script makes that a promise the site is actively working to break: if the
// application is approved, an ad renders directly above the sentence denying
// there are any. A claim in prose is not covered by the consent checks above,
// so it is checked here, where the tag is.
{
  const promises = [];
  for (const f of pages) {
    const body = read(f)
      .replace(/<!--[\s\S]*?-->/g, ' ')          // the consent comments discuss ads at length
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ');
    if (/\bno ads\b|\bad[- ]free\b|\bwithout ads\b/i.test(body)) promises.push(f);
  }
  eq('no page promises there are no ads, because one is loaded on all of them', promises, []);
  // Free, no paywall and nothing-bought-affects-scoring are all still true and
  // still said - the trim took the false claim, not the honest ones.
  const home = read('index.html');
  ck(/no paywall/.test(home), 'the home page still says there is no paywall');
  ck(/score higher/.test(home), 'and that nothing in the shop makes anyone score higher');
}

// ---- and the policy says that, rather than the opposite -------------------
const privacy = read('privacy.html');
ck(!/no advertising network is loaded on the site/.test(privacy),
   'the policy no longer says no ad network is loaded, because one is',
   (privacy.match(/[^<]*no advertising network[^<]*/) || [''])[0]);
ck(/AdSense/.test(privacy), 'it names AdSense');
for (const sig of ['ad_storage', 'ad_user_data', 'ad_personalization']) {
  ck(privacy.includes(sig), `and names ${sig}, which is the promise being made`);
}
ck(/denied/.test(privacy), 'and says they are denied');
// The page a reader is sent to has to carry the tag like any other, or the
// policy describing it is served from a page that disproves it.
ck(read('privacy.html').includes('adsbygoogle.js'), 'the policy page carries the tag too');

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
