/*
 * The static Gauntlet archive pages.
 *
 * One rule here matters more than all the others: a page must NEVER be
 * produced for a date that is still today in Eastern time. The answers to
 * today's puzzle live only on the server; publishing them kills the day for
 * everyone who hasn't played. The comparison is DST-sensitive, and this
 * codebase has already shipped one off-by-an-hour date bug (the Gauntlet
 * countdown, caught before release), so the boundary is tested on both
 * transition days rather than assumed.
 *
 * Everything else is rendered from fixtures: per-word difficulty, tie
 * handling in the standings, the distribution, and the sitemap rewrite.
 *
 * Pure; no emulator, no browser, no credentials.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as R from '../tools/gauntlet-archive-render.mjs';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ok = (name, cond, detail = '') => t.push({ name, cond, detail });

// ---- 1. the publish boundary, including both DST transitions -------------
// 2026 US DST: forward Sun 8 Mar, back Sun 1 Nov.
const at = (iso) => new Date(iso);
ok('a normal day resolves in Eastern', R.etDateStr(at('2026-06-15T12:00:00Z')) === '2026-06-15');
ok('just before ET midnight is still the previous day',
   R.etDateStr(at('2026-06-16T03:59:00Z')) === '2026-06-15', R.etDateStr(at('2026-06-16T03:59:00Z')));
ok('just after ET midnight has rolled over',
   R.etDateStr(at('2026-06-16T04:01:00Z')) === '2026-06-16', R.etDateStr(at('2026-06-16T04:01:00Z')));
// EST is UTC-5, so midnight ET is 05:00Z in winter and 04:00Z in summer.
ok('winter midnight rolls at 05:00Z, not 04:00Z',
   R.etDateStr(at('2026-01-10T04:30:00Z')) === '2026-01-09'
   && R.etDateStr(at('2026-01-10T05:30:00Z')) === '2026-01-10');
ok('the spring-forward day resolves correctly',
   R.etDateStr(at('2026-03-08T12:00:00Z')) === '2026-03-08');
ok('the fall-back day resolves correctly',
   R.etDateStr(at('2026-11-01T12:00:00Z')) === '2026-11-01');

const now = at('2026-09-25T18:00:00Z'); // 2pm ET on the 25th
ok('today is NEVER publishable', !R.isPublishable('2026-09-25', now));
ok('yesterday is', R.isPublishable('2026-09-24', now));
ok('tomorrow is not', !R.isPublishable('2026-09-26', now));
ok('a date before the epoch is not', !R.isPublishable('2026-09-01', now));
ok('the epoch itself is', R.isPublishable(R.GAUNTLET_EPOCH, now));
// The riskiest instant of all: one minute before ET midnight, when UTC has
// already ticked over to the next date.
const almostMidnight = at('2026-09-25T03:59:00Z'); // 11:59pm ET on the 24th
ok('at 23:59 ET, "today" is the 24th and it is not publishable',
   !R.isPublishable('2026-09-24', almostMidnight), R.etDateStr(almostMidnight));
ok('...and the 23rd still is', R.isPublishable('2026-09-23', almostMidnight));

const dates = R.publishableDates(now);
ok('the publishable list starts at the epoch', dates[0] === R.GAUNTLET_EPOCH, dates[0]);
ok('the publishable list ends at yesterday', dates[dates.length - 1] === '2026-09-24', dates[dates.length - 1]);
ok('the publishable list never contains today', !dates.includes('2026-09-25'));
ok('every date in the list passes isPublishable', dates.every((d) => R.isPublishable(d, now)));

// ---- 2. puzzle numbering -------------------------------------------------
ok('the epoch is Gauntlet #1', R.gauntletNumber(R.GAUNTLET_EPOCH) === 1, String(R.gauntletNumber(R.GAUNTLET_EPOCH)));
ok('numbering counts days, not rows', R.gauntletNumber('2026-09-24') === 23, String(R.gauntletNumber('2026-09-24')));
ok('a pre-epoch date has no number', R.gauntletNumber('2026-08-30') === null);
ok('numbering survives a DST change', R.gauntletNumber('2026-11-02') - R.gauntletNumber('2026-10-31') === 2,
   `${R.gauntletNumber('2026-10-31')} -> ${R.gauntletNumber('2026-11-02')}`);
ok('shiftDate crosses a DST boundary without drifting',
   R.shiftDate('2026-11-01', -1) === '2026-10-31' && R.shiftDate('2026-03-08', 1) === '2026-03-09');

// ---- 3. tiers reflect how pickDailyWords actually draws ------------------
const fnSrc = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const want = JSON.parse(fnSrc.match(/const want = (\[[^\]]*\]);/)[1]);
ok('tier sizes match pickDailyWords in the functions source',
   JSON.stringify(want) === JSON.stringify(R.TIER_SIZES), `${want} vs ${R.TIER_SIZES}`);
ok('positions 1-3 are Easy', [0, 1, 2].every((i) => R.tierOf(i) === 'Easy'));
ok('positions 4-7 are Medium', [3, 4, 5, 6].every((i) => R.tierOf(i) === 'Medium'));
ok('positions 8-10 are Hard', [7, 8, 9].every((i) => R.tierOf(i) === 'Hard'));

// ---- 4. per-word stats from real attempt shapes --------------------------
const WORDS = ['ARISE', 'HOUSE', 'MEDIA', 'GRAPE', 'TOKEN', 'FLINT', 'WRYLY', 'ABYSS', 'QUELL', 'NYMPH'];
// history entries are { guesses: [{guess, colors}], solved }; a word never
// reached has an empty guesses array. A miss ends the run.
const h = (spec) => WORDS.map((_, i) => {
  const s = spec[i];
  if (!s) return { guesses: [], solved: false };
  return { guesses: new Array(s[0]).fill({ guess: 'XXXXX', colors: [] }), solved: s[1] };
});
const attempts = [
  h([[2, true], [3, true], [1, true], [4, true], [3, true], [5, true], [2, true], [4, true], [3, true], [2, true]]), // 10/10
  h([[1, true], [2, true], [3, true], [2, true], [4, true], [5, false]]),                                            // out on 6
  h([[3, true], [4, true], [5, false]]),                                                                             // out on 3
  h([[2, true], [5, false]]),                                                                                        // out on 2
];
const ws = R.computeWordStats(WORDS, attempts);
ok('word 1 was reached by everyone', ws[0].reached === 4, String(ws[0].reached));
ok('word 3 was reached by three', ws[2].reached === 3, String(ws[2].reached));
ok('word 7 was reached by one', ws[6].reached === 1, String(ws[6].reached));
ok('only the perfect run reached word 10', ws[9].reached === 1 && ws[9].solved === 1, String(ws[9].reached));
// A word nobody got to at all: drop the perfect run and word 10 is untouched.
const short = R.computeWordStats(WORDS, attempts.slice(1));
ok('an untouched word reports nothing rather than zero',
   short[9].reached === 0 && short[9].solveRate === null && short[9].avgGuesses === null,
   `${short[9].reached}/${short[9].solveRate}`);
ok('a word that ended a run is counted', ws[5].endedRuns === 1 && ws[5].solved === 1, `${ws[5].endedRuns}/${ws[5].solved}`);
ok('word 3 ended exactly one run', ws[2].endedRuns === 1, String(ws[2].endedRuns));
ok('solve rate is solved over reached', Math.abs(ws[2].solveRate - 2 / 3) < 1e-9, String(ws[2].solveRate));
// Four players reached word 2; three solved it in 3, 2 and 4, and the
// fourth burned all five and went out. The average is over the SOLVERS,
// because a failure is always five and would just mirror the solve rate.
ok('average guesses covers only the players who solved it',
   Math.abs(ws[1].avgGuesses - (3 + 2 + 4) / 3) < 1e-9, String(ws[1].avgGuesses));
ok('...and the failure is still counted as reaching it', ws[1].reached === 4 && ws[1].endedRuns === 1,
   `${ws[1].reached}/${ws[1].endedRuns}`);
ok('a word nobody solved has no average', ws[5].solved === 1 ? true : ws[5].avgGuesses === null);
ok('tiers are attached to each word', ws[0].tier === 'Easy' && ws[9].tier === 'Hard');

// ---- 5. standings and distribution --------------------------------------
const runs = [
  { username: 'SLIZZY', score: 4250, wordsGuessed: 10 },
  { username: 'G_Angle', score: 3100, wordsGuessed: 8 },
  { username: 'MOSSY', score: 3100, wordsGuessed: 8 },
  { username: 'DRIFT', score: 900, wordsGuessed: 3 },
  { username: 'PENUMBRA', score: 400, wordsGuessed: 2 },
];
const st = R.computeStandings(runs);
ok('standings sort by score', st.map((r) => r.name).join(',') === 'SLIZZY,G_Angle,MOSSY,DRIFT,PENUMBRA', st.map((r) => r.name).join(','));
ok('a tie shares a place', st[1].place === 2 && st[2].place === 2, `${st[1].place},${st[2].place}`);
ok('the player after a tie takes the skipped place', st[3].place === 4, String(st[3].place));
ok('standings are capped at ten', R.computeStandings(new Array(40).fill({ username: 'X', score: 1 })).length === 10);
const dist = R.computeDistribution(runs);
ok('distribution counts perfect runs', dist[10] === 1, String(dist[10]));
ok('distribution buckets ties together', dist[8] === 2, String(dist[8]));
ok('distribution has a bucket per outcome', dist.length === R.WORD_COUNT + 1, String(dist.length));

// ---- 6. the rendered page ------------------------------------------------
const day = { date: '2026-09-24', words: WORDS, runs, attempts, prev: '2026-09-23', next: null };
const page = R.renderDayPage(day);
ok('the page is a complete document', page.startsWith('<!DOCTYPE html>') && page.trimEnd().endsWith('</html>'));
ok('the title carries the puzzle number and date', /<title>Lexathon Gauntlet #23 — 24 September 2026<\/title>/.test(page),
   (page.match(/<title>[^<]*<\/title>/) || [''])[0]);
ok('there is a meta description', /<meta name="description" content="[^"]{60,}"/.test(page));
ok('there is a canonical url', page.includes('<link rel="canonical" href="https://lexathon.gg/gauntlet/2026-09-24/">'));
for (const w of WORDS) ok(`${w} appears on the page`, page.includes(w));
ok('the standings name every player', runs.every((r) => page.includes(r.username)));
ok('the nemesis word is called out', /ended the most runs/.test(page));
ok('the previous day is linked', page.includes('href="/gauntlet/2026-09-23/"'));
ok('the newest day has no next link', !/gauntlet\/2026-09-25/.test(page) && page.includes('Newest'));
ok('the page links back to the game', page.includes('href="/"'));
ok('the page links to the hub', page.includes('href="/gauntlet/"'));
ok('the support note links to Ko-fi', page.includes('https://ko-fi.com/lexathon'));

// A handle is player-supplied text rendered into static HTML that then gets
// served from our own origin — the one place an injected tag would be worst.
const nasty = R.renderDayPage({ ...day, runs: [{ username: '<img src=x onerror=alert(1)>', score: 1, wordsGuessed: 1 }] });
ok('a handle cannot inject markup', !nasty.includes('<img src=x'), 'raw tag found');
ok('...and is still shown, escaped', nasty.includes('&lt;img src=x onerror=alert(1)&gt;'));

// ---- 7. a day nobody finished -------------------------------------------
const empty = R.renderDayPage({ date: '2026-09-10', words: WORDS, runs: [], attempts: [], prev: null, next: '2026-09-11' });
ok('an empty day still renders', empty.startsWith('<!DOCTYPE html>'));
ok('an empty day says so', empty.includes('Nobody finished this one'));
ok('an empty day still lists the words', WORDS.every((w) => empty.includes(w)));
ok('an empty day has no standings table', !empty.includes('Final Standings'));
ok('the first day has no previous link', empty.includes('Start of the archive'));

// ---- 8. the hub ----------------------------------------------------------
const days = [
  { date: '2026-09-24', players: 47, perfect: 3, topScore: 4250 },
  { date: '2026-09-23', players: 51, perfect: 1, topScore: 4600 },
];
const hub = R.renderHubPage(days);
ok('the hub lists every day', days.every((d) => hub.includes(`href="/gauntlet/${d.date}/"`)));
ok('the hub numbers the puzzles', hub.includes('#23') && hub.includes('#22'));
ok('the hub says today is not listed', /play it first/i.test(hub));
ok('the hub has a canonical url', hub.includes('<link rel="canonical" href="https://lexathon.gg/gauntlet/">'));

// ---- 9. the sitemap rewrite ---------------------------------------------
const existing = fs.readFileSync(REPO('sitemap.xml'), 'utf8');
// Count only the hand-written urls. This used to count every <url> and
// assert "old total + hub + days", which quietly encoded "sitemap.xml has
// no archive entries yet" — true when it was written, false the moment the
// first backfill landed. The real invariant is that a rewrite replaces the
// archive block and leaves everything else alone, whatever is in there now.
const beforeAll = (existing.match(/<url>/g) || []).length;
const before = [...existing.matchAll(/<url>[\s\S]*?<\/url>/g)]
  .filter((m) => !/\/gauntlet\//.test(m[0])).length;
const sm = R.renderSitemap(existing, days);
ok('hand-written urls survive', sm.includes('https://lexathon.gg/how-to-play.html') && sm.includes('https://lexathon.gg/strategy.html'));
ok('the hub is listed', sm.includes('<loc>https://lexathon.gg/gauntlet/</loc>'));
ok('every day is listed', days.every((d) => sm.includes(`<loc>https://lexathon.gg/gauntlet/${d.date}/</loc>`)));
ok('each day carries its own lastmod', sm.includes('<lastmod>2026-09-24</lastmod>'));
ok('the result is the hand-written urls plus hub plus days',
   (sm.match(/<url>/g) || []).length === before + 1 + days.length,
   `${before} hand-written (+${beforeAll - before} archive already there) -> ${(sm.match(/<url>/g) || []).length}`);
ok('an archive entry already in the file is replaced, not added to',
   (sm.match(/\/gauntlet\//g) || []).length === 1 + days.length,
   String((sm.match(/\/gauntlet\//g) || []).length));
// Re-running must not stack duplicates.
const twice = R.renderSitemap(sm, days);
ok('re-running the rewrite is idempotent',
   (twice.match(/<url>/g) || []).length === (sm.match(/<url>/g) || []).length,
   `${(sm.match(/<url>/g) || []).length} -> ${(twice.match(/<url>/g) || []).length}`);
ok('a day dropped from the set is dropped from the sitemap',
   !R.renderSitemap(sm, [days[0]]).includes('/gauntlet/2026-09-23/'));
ok('the sitemap is well-formed xml', sm.startsWith('<?xml') && sm.trimEnd().endsWith('</urlset>'));

// ---- 9b. which days get a page, and what a rebuild deletes --------------
ok('a day with players is published', R.shouldPublish(1) && R.shouldPublish(47));
ok('a day nobody finished is not', !R.shouldPublish(0));
ok('the default threshold is 1, not 0', R.shouldPublish(1) && !R.shouldPublish(0));
ok('the threshold is adjustable', R.shouldPublish(3, 3) && !R.shouldPublish(2, 3));
ok('a threshold of 0 publishes empty days', R.shouldPublish(0, 0));

const ex = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'];
let plan = R.planPrune(ex, ['2026-09-21', '2026-09-23']);
ok('a rebuild removes the days it did not produce',
   plan.remove.join(',') === '2026-09-20,2026-09-22', plan.remove.join(','));
ok('...and keeps the ones it did', !plan.refuse && !plan.remove.includes('2026-09-21'));
ok('a rebuild that produced everything removes nothing',
   R.planPrune(ex, ex).remove.length === 0);
ok('a rebuild of an empty archive is fine', !R.planPrune([], []).refuse);
ok('a rebuild that adds to an empty archive is fine',
   !R.planPrune([], ['2026-09-21']).refuse);
// The one that matters: a read failure returns no days, which is
// indistinguishable from "no day qualifies" and would delete everything.
plan = R.planPrune(ex, []);
ok('building nothing against a non-empty archive REFUSES', plan.refuse, JSON.stringify(plan));
ok('...and removes nothing when it refuses', plan.remove.length === 0, plan.remove.join(','));
ok('...and says why', /built none of the 4/.test(plan.reason), plan.reason);

// ---- 9c. the generator wires those decisions up -------------------------
const gen = fs.readFileSync(REPO('tools/build-gauntlet-archive.mjs'), 'utf8');
ok('the generator defaults to a threshold of 1',
   /val\("--min-players"\) === null \? 1 :/.test(gen));
ok('the generator filters through shouldPublish', gen.includes('R.shouldPublish(day.runs.length, MIN_PLAYERS)'));
ok('the generator prunes through planPrune', gen.includes('R.planPrune(existing'));
ok('it honours the refusal rather than deleting anyway',
   /plan\.refuse[\s\S]{0,220}process\.exit\(1\)/.test(gen));
ok('pruning only ever happens on a full rebuild',
   /if \(has\("--all"\) && fs\.existsSync\(OUT\)\)[\s\S]{0,900}?plan\.remove/.test(gen));
ok('a dry run deletes nothing', /DRY[\s\S]{0,60}would remove/.test(gen));

// ---- 9d. it has to survive a phone ---------------------------------------
// Every page here inherits a .container that is width:100% PLUS padding and
// a border, which on a 390px screen renders 404px wide inside a 350px slot
// and pushes the whole document sideways. The hand-written pages shipped
// that way for months; these must not.
const style = R.renderDayPage(day) + R.renderHubPage(days);
ok('the generated pages set box-sizing', /\*, \*::before, \*::after \{ box-sizing: border-box; \}/.test(style));
ok('a table too wide to fit scrolls inside itself', /table \{[^}]*overflow-x: auto/.test(style));
ok('there is a narrow-screen breakpoint', /@media \(max-width: 480px\)/.test(style));
ok('the stat row reflows instead of cramming four across', /@media[^}]*\{[\s\S]*?\.stat-row \{ flex-wrap: wrap; \}/.test(style));

// The base rule must come BEFORE the media query. At equal specificity the
// later rule wins, so declaring it after silently defeats the override —
// which is exactly what happened, and the short label never rendered.
const css = style.slice(style.indexOf('.only-sm'), style.indexOf('</style>'));
const basePos = style.indexOf('.only-sm { display: none; }');
const mediaPos = style.indexOf('@media (max-width: 480px)');
ok('.only-sm is declared before the breakpoint that overrides it',
   basePos !== -1 && mediaPos !== -1 && basePos < mediaPos, `base ${basePos}, media ${mediaPos}`);
ok('the wide header has a short alternative',
   /<span class="hide-sm">Avg guesses<\/span><span class="only-sm">Avg<\/span>/.test(style));
ok('one column per table is dropped on a phone',
   /<th class="hide-sm">Tier<\/th>/.test(style) && /<th class="n hide-sm">Perfect<\/th>/.test(style));

// Long dates wrapped the hub's date column onto three lines, which was most
// of why that table could not fit.
ok('the hub uses a short date', R.renderHubPage(days).includes('24 Sept 2026'), R.shortDate('2026-09-24'));
ok('the day page keeps the long one', R.renderDayPage(day).includes('24 September 2026'));
ok('the short date really is shorter',
   R.shortDate('2026-09-24').length < R.prettyDate('2026-09-24').length);

// The same fix had to go onto the hand-written pages, which had the bug first.
for (const f of ['about.html', 'faq.html', 'how-to-play.html', 'privacy.html', 'strategy.html', 'terms.html']) {
  const page = fs.readFileSync(REPO(f), 'utf8');
  ok(`${f}: sets box-sizing`, /box-sizing: border-box/.test(page));
  ok(`${f}: has the narrow-screen breakpoint`, /@media \(max-width: 480px\)/.test(page));
}

// ---- 10. the homepage actually points at the archive --------------------
// The reason this is pinned: a link inside a modal is behind an interaction,
// and content behind interaction is discounted by crawlers. The archive only
// gets found if there is a link in the always-rendered part of the page.
const home = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const intro = (home.match(/<section id="site-intro"[\s\S]*?<\/section>/) || [''])[0];
ok('site-intro exists and was extracted', intro.length > 500, `${intro.length} chars`);
ok('site-intro links to the archive, outside any modal', intro.includes('href="/gauntlet/"'));
ok('site-intro explains today is never listed', /never listed|spoil/i.test(intro));
ok('site-intro carries the support note', intro.includes('https://ko-fi.com/lexathon'));
ok('the support note says it is free', /entirely free|free to play/i.test(intro));
// The modal link is per-day, so it has to be pointed at the day being viewed
// rather than left on the hub href it ships with.
ok('the in-app archive has a per-day link', home.includes('id="gauntlet-archive-full"'));
ok('...and it is repointed when a day is opened',
   /gauntlet-archive-full"\)\.href = `\/gauntlet\/\$\{dateStr\}\/`/.test(home));
// Nothing on the site may link to a day that has not finished.
ok('no hardcoded link to a specific Gauntlet day', !/href="\/gauntlet\/\d{4}-\d{2}-\d{2}\//.test(home));
// site-intro is below the fold. The footer strip is always visible with no
// interaction at all, which is where "seems a bit hard to find" gets fixed.
const footer = (home.match(/Always-visible footer[\s\S]*?<\/div>/) || [''])[0];
ok('the always-visible footer links to the archive', footer.includes('href="/gauntlet/"'), `${footer.length} chars`);
ok('the archive modal browse view links to the hub too',
   /gauntlet-archive-more[\s\S]{0,400}?href="\/gauntlet\/"/.test(home));
ok('the archive is reachable from at least three places',
   (home.match(/href="\/gauntlet\/"/g) || []).length >= 3,
   String((home.match(/href="\/gauntlet\/"/g) || []).length));

let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
