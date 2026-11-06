/*
 * The Trifecta plays all ten words, and the board breaks ties on words solved.
 *
 * Three things with no other home:
 *
 *   1. The server rule. One expression decides whether a run is over, and it
 *      used to end on the first miss. It is extracted from functions/index.js
 *      and exercised, rather than grepped for, because "the string changed" and
 *      "a run plays all ten" are different claims.
 *   2. The board's shared places. A tie now means the same score AND the same
 *      words solved; keying on score alone would hand one place to two players
 *      the query has deliberately ordered one above the other.
 *   3. The composite indexes. This is the one that cannot be caught any other
 *      way: the Firestore emulator creates indexes on demand, so every emulator
 *      test passes whether or not firestore.indexes.json declares them — and in
 *      production a query with no serving index fails outright. So the queries
 *      are read out of index.html and matched against the declared indexes.
 *
 * Needs Playwright for (2); no emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fns = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const indexes = JSON.parse(fs.readFileSync(REPO('firestore.indexes.json'), 'utf8'));

const t = [];
const ck = (name, cond, detail = '') => t.push({ name, cond: !!cond, detail });

// Brace-counting, because an indentation anchor lifts half a function when the
// same shape recurs at another depth, and [\s\S]*?\} stops at the first inner
// closing brace.
function bodyAt(source, declaration, from = 0) {
  const start = source.indexOf(declaration, from);
  if (start < 0) return null;
  const open = source.indexOf('{', start + declaration.length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) return source.slice(start, j + 1); }
  }
  return null;
}

// ======================================================================= 1 ==
// The server rule, run rather than grepped.

const ruleSrc = (() => {
  const a = fns.indexOf('    const newScore = attempt.score + earned;');
  const b = fns.indexOf('\n', fns.indexOf('const gauntletFinished', a));
  return a < 0 || b < 0 ? null : fns.slice(a, b);
})();
ck('extracted the finish rule from functions/index.js', ruleSrc && ruleSrc.includes('gauntletFinished'),
   ruleSrc ? `${ruleSrc.length} chars` : 'MISSING');

// (attempt, earned, wordFinished, wordIndex) -> { gauntletFinished, newWordIndex, newScore }
const runRule = new Function('attempt', 'earned', 'wordFinished', 'wordIndex',
  `${ruleSrc}\nreturn { gauntletFinished, newWordIndex, newScore };`);
const WC = { score: 0, wordCount: 10 };

// A miss used to end the run here. It must not.
ck('missing word 1 does not end the run',
   runRule(WC, 0, true, 0).gauntletFinished === false);
ck('missing word 5 does not end the run',
   runRule(WC, 0, true, 4).gauntletFinished === false);
ck('missing word 9 does not end the run',
   runRule(WC, 0, true, 8).gauntletFinished === false);
// Solving does not end it early either.
ck('solving word 1 does not end the run',
   runRule(WC, 500, true, 0).gauntletFinished === false);
// Only running out of words does.
ck('finishing word 10 ends the run, solved',
   runRule(WC, 500, true, 9).gauntletFinished === true);
ck('finishing word 10 ends the run, missed',
   runRule(WC, 0, true, 9).gauntletFinished === true);
// Mid-word, nothing finishes.
ck('a guess that does not finish the word never ends the run',
   runRule(WC, 0, false, 9).gauntletFinished === false);
ck('and does not advance the word index',
   runRule(WC, 0, false, 4).newWordIndex === 4);
ck('a finished word advances the index', runRule(WC, 0, true, 4).newWordIndex === 5);
// A shorter puzzle still ends at its own length, not a hardcoded ten.
ck('the run ends at the puzzle length, not at a constant',
   runRule({ score: 0, wordCount: 3 }, 0, true, 2).gauntletFinished === true);
ck('...and not before it', runRule({ score: 0, wordCount: 3 }, 0, true, 1).gauntletFinished === false);
// A missed word earns nothing but must not cost anything either.
ck('a miss adds no points and takes none away', runRule({ score: 1200, wordCount: 10 }, 0, true, 3).newScore === 1200);

// The per-run tallies the run document is built from.
const foldSrc = (() => {
  const a = fns.indexOf('      let wordsGuessed = 0, g1 = 0');
  const b = fns.indexOf('});', fns.indexOf('newHistory.forEach', a));
  return a < 0 || b < 0 ? null : fns.slice(a, b + 3);
})();
ck('extracted the run-document tallies', foldSrc && foldSrc.includes('newHistory.forEach'),
   foldSrc ? `${foldSrc.length} chars` : 'MISSING');
const fold = new Function('newHistory',
  `${foldSrc}\nconst wordsPlayed = newHistory.filter((e) => e.guesses.length > 0).length;\nreturn { wordsGuessed, missed, bestStreak, wordsPlayed, g1, g2, g3, g4, g5 };`);
const W = (n, solved) => ({ guesses: Array(n).fill('X'), solved });

{
  // Three misses scattered through a full ten-word run. The streaks are 4, 1
  // and 2 — deliberately unequal, so "longest" is distinguishable from "last"
  // (2) and from "total solved" (7). An earlier fixture had every streak at 2
  // and could not tell those apart.
  const r = fold([W(2,true), W(3,true), W(1,true), W(4,true), W(5,false), W(2,true), W(5,false), W(3,true), W(2,true), W(5,false)]);
  ck('fails counts every missed word, not 0-or-1', r.missed === 3, String(r.missed));
  ck('words solved counts the rest', r.wordsGuessed === 7, String(r.wordsGuessed));
  ck('words played is the whole puzzle now', r.wordsPlayed === 10, String(r.wordsPlayed));
  // played - fails is what the Profile divides to get a win rate.
  ck('words played minus fails is words solved', r.wordsPlayed - r.missed === r.wordsGuessed);
  ck('best streak is the longest unbroken stretch, not the last one or the total',
     r.bestStreak === 4, `${r.bestStreak} (last streak 2, total solved 7)`);
  ck('guess-count buckets only count solved words', r.g1 + r.g2 + r.g3 + r.g4 + r.g5 === 7,
     `${r.g1},${r.g2},${r.g3},${r.g4},${r.g5}`);
  ck('a five-guess MISS is not booked as a five-guess solve', r.g5 === 0, String(r.g5));
}
{
  const r = fold(Array(10).fill(W(5, false)));
  ck('missing every word is ten fails', r.missed === 10 && r.wordsGuessed === 0, `${r.missed}/${r.wordsGuessed}`);
  ck('and no streak at all', r.bestStreak === 0, String(r.bestStreak));
}
{
  const r = fold(Array(10).fill(W(3, true)));
  ck('a perfect run has no fails', r.missed === 0 && r.wordsGuessed === 10, `${r.missed}/${r.wordsGuessed}`);
  ck('and a streak of ten', r.bestStreak === 10, String(r.bestStreak));
}
{
  // A legacy attempt that stopped early still folds correctly: untouched words
  // are not misses. Rows like this exist from before the change.
  const r = fold([W(3,true), W(2,true), W(5,false), ...Array(7).fill({ guesses: [], solved: false })]);
  ck('untouched words are not counted as misses', r.missed === 1, String(r.missed));
  ck('and not counted as played', r.wordsPlayed === 3, String(r.wordsPlayed));
}

// The old rule must be gone from the source, not merely unreachable.
ck('no sudden-death condition survives in the server',
   !/failedOut/.test(fns) && !/gauntletFinished\s*=\s*wordFinished\s*&&\s*\(/.test(fns));

// --- the top-10 career challenge, which names the board it reads -----------
// Its query now orders the way the board does, so "top 10" means the same thing
// in both places. The comparison is the part worth exercising: level with the
// cut row counts, because the board gives tied runs a SHARED place and only one
// of a tied pair can fit inside a limit(10).
const top10Src = (() => {
  const a = fns.indexOf('      const others = top10Snap.docs.filter');
  const b = fns.indexOf('\n', fns.indexOf('const madeTop10', a));
  return a < 0 || b < 0 ? null : fns.slice(a, b);
})();
ck('extracted the top-10 test', top10Src && top10Src.includes('madeTop10'),
   top10Src ? `${top10Src.length} chars` : 'MISSING');
const runTop10 = new Function('top10Snap', 'runRef', 'score', 'wordsGuessed',
  `${top10Src}\nreturn madeTop10;`);
// The board's order: score desc, then words solved desc. The cut is the last.
const snapOf = (rows) => ({ docs: rows.map((r, i) => ({ id: r.id || `other${i}`, data: () => r })) });
const ME = { id: 'mine' };
const board10 = Array.from({ length: 10 }, (_, i) => ({ score: 3000 - i * 100, wordsGuessed: 10 - i }));

ck('fewer than ten others means you are in it by definition',
   runTop10(snapOf(board10.slice(0, 9)), ME, 1, 1) === true);
ck('a score below the cut misses out',
   runTop10(snapOf(board10), ME, 500, 10) === false);
ck('a score above the cut makes it',
   runTop10(snapOf(board10), ME, 5000, 1) === true);
// The cut row here is score 2100, 1 word.
ck('level on score but more words beats the cut',
   runTop10(snapOf(board10), ME, 2100, 5) === true);
ck('level on score but fewer words does not',
   runTop10(snapOf(board10), ME, 2100, 0) === false);
ck('level on BOTH counts, because the board shows both as the same place',
   runTop10(snapOf(board10), ME, 2100, 1) === true);
// Words solved must never outrank score.
ck('ten words on a lower score still misses',
   runTop10(snapOf(board10), ME, 2000, 10) === false);
// Your own row is excluded before the cut is read; with it left in, a run that
// just squeaked into the ten would be compared against itself.
ck('your own row is not counted among the others',
   runTop10(snapOf([...board10.slice(0, 9), { id: 'mine', score: 2100, wordsGuessed: 1 }]), ME, 2100, 1) === true);

// ======================================================================= 3 ==
// The composite indexes. Read the real queries, match against the real file.

// Pull every runs query in index.html that filters mode=="daily". Paren-counted
// from each `query(` rather than regex-sliced: a board query spans four lines
// and ends in `limit(100)`, and a lazy [\s\S]*? stops at the first inner `)`,
// which silently drops the orderBy clauses and makes every query look like it
// needs no sort at all — which any index serves, so the whole check passes
// vacuously. That is exactly how this was wrong the first time.
function argsOf(source, at) {
  const open = source.indexOf('(', at);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '(') depth++;
    else if (source[j] === ')') { depth--; if (depth === 0) return source.slice(open + 1, j); }
  }
  return null;
}
// The standing queries build their equalities once, in the mode's own config,
// and spread them. The spread has to be resolved or mode and puzzleDate go
// missing from every one of them — and it has to be resolved PER MODE, since
// each block spreads a different list. So each block's `...scoped` is replaced
// with that block's own literal list before any query is read.
const archAt = html.indexOf('const ARCHIVES = {');
const blockAt = (k) => html.indexOf(`            ${k}: {`, archAt);
const scopedOf = (k) => {
  const seg = html.slice(blockAt(k));
  const m = seg.match(/scoped: \(d\) => \[([^\]]*)\]/);
  return m ? m[1] : null;
};
ck('resolved each mode\'s scoped list', !!scopedOf('daily') && !!scopedOf('sprint'),
   `${scopedOf('daily')} || ${scopedOf('sprint')}`);
// Rebuilt with each block's spread expanded in place, so a query's position
// still tells you which mode it belongs to.
let resolved = html;
for (const k of ['sprint', 'daily']) {           // later block first: indices shift
  const at = blockAt(k);
  const end = html.indexOf('\n            },', at);
  const block = html.slice(at, end).replaceAll('...scoped', scopedOf(k));
  resolved = resolved.slice(0, resolved.indexOf(html.slice(at, end))) + block
           + resolved.slice(resolved.indexOf(html.slice(at, end)) + (end - at));
}
const dailyQueries = [];
for (const m of resolved.matchAll(/\bquery\s*\(/g)) {
  let a = argsOf(resolved, m.index);
  if (a === null || !a.includes('"runs"')) continue;
  const eqs = [...a.matchAll(/where\("(\w+)", "==",/g)].map((x) => x[1]);
  // Both one-puzzle-a-day modes, not just the Trifecta: Sprint's archive runs
  // the same shapes against a different tiebreak, and a query this filter
  // skips is a query no index check below ever sees.
  const mode = (a.match(/where\("mode", "==", "(\w+)"\)/) || [])[1];
  if (!eqs.includes('mode') || (mode !== 'daily' && mode !== 'sprint')) continue;
  const ranges = [...a.matchAll(/where\("(\w+)", "[<>]=?",/g)].map((x) => x[1]);
  const orders = [...a.matchAll(/orderBy\("(\w+)", "(asc|desc)"\)/g)].map((x) => ({ f: x[1], d: x[2] }));
  dailyQueries.push({ mode, eqs, ranges, orders, src: a.replace(/\s+/g, ' ').slice(0, 110) });
}
ck('found the daily queries in index.html', dailyQueries.length >= 5, String(dailyQueries.length));
ck('...for both modes', new Set(dailyQueries.map((q) => q.mode)).size === 2,
   dailyQueries.map((q) => q.mode).join(','));
// Guard against the failure above recurring: if the orderBy clauses stop being
// captured, every query reads as sortless and the checks below mean nothing.
ck('and captured their sort clauses, not just their filters',
   dailyQueries.filter((q) => q.orders.length > 0).length >= 4,
   dailyQueries.map((q) => q.orders.length).join(','));
// A board render is a daily query that sorts without an inequality: there are
// exactly two (today's, and a past day's), and BOTH must carry the tiebreak.
// Checking that merely SOME query has it passes while one of the two has lost
// it, which is precisely the regression worth catching.
const boardQueries = dailyQueries.filter((q) => q.orders.length > 0 && q.ranges.length === 0);
// Each mode renders its day twice — today's live board and the archive's — and
// the two MUST sort the same way or a run changes place when the day ends.
// Checking that merely SOME query carries the tiebreak passes while one of the
// pair has lost it, which is precisely the regression worth catching.
const TIEBREAK = { daily: ['wordsGuessed', 'desc'], sprint: ['elapsedMs', 'asc'] };
for (const mode of ['daily', 'sprint']) {
  const mine = boardQueries.filter((q) => q.mode === mode);
  ck(`${mode}: there are two board renders`, mine.length === 2, String(mine.length));
  ck(`${mode}: and both order by score then ${TIEBREAK[mode][0]}`,
     mine.length > 0 && mine.every((q) =>
       q.orders.length === 2 && q.orders[0].f === 'score' && q.orders[0].d === 'desc'
       && q.orders[1].f === TIEBREAK[mode][0] && q.orders[1].d === TIEBREAK[mode][1]),
     mine.map((q) => q.orders.map((o) => o.f + ' ' + o.d).join(' > ')).join('  |  '));
  ck(`${mode}: and a tied-and-ahead query — score equality plus a range on ${TIEBREAK[mode][0]}`,
     dailyQueries.some((q) => q.mode === mode && q.eqs.includes('score') && q.ranges.includes(TIEBREAK[mode][0])),
     dailyQueries.filter((q) => q.mode === mode).map((q) => `${q.eqs.join('+')}/${q.ranges.join('+')}`).join(' | '));
}

const runsIndexes = indexes.indexes.filter((i) => i.collectionGroup === 'runs')
  .map((i) => i.fields.map((f) => ({ f: f.fieldPath, d: f.order === 'ASCENDING' ? 'asc' : 'desc' })));

/*
 * Does some declared index serve this query? Firestore's rule: the equality
 * fields must occupy a prefix of the index (their order and direction among
 * themselves does not matter), then the range/orderBy fields must follow in
 * exactly the query's order, with directions matching the index or all exactly
 * reversed.
 */
function served(q) {
  const tail = q.orders.length ? q.orders : q.ranges.map((f) => ({ f, d: 'asc' }));
  return runsIndexes.some((ix) => {
    const prefix = ix.slice(0, q.eqs.length).map((x) => x.f);
    if (prefix.length !== q.eqs.length) return false;
    if (!q.eqs.every((e) => prefix.includes(e))) return false;
    const rest = ix.slice(q.eqs.length);
    if (rest.length < tail.length) return false;
    const same = tail.every((o, i) => rest[i].f === o.f && rest[i].d === o.d);
    const flipped = tail.every((o, i) => rest[i].f === o.f && rest[i].d !== o.d);
    return same || flipped;
  });
}
for (const q of dailyQueries) {
  ck(`a declared index serves: ${q.eqs.join('+')}${q.ranges.length ? ' range ' + q.ranges.join(',') : ''}${q.orders.length ? ' order ' + q.orders.map((o) => o.f + ' ' + o.d).join(',') : ''}`,
     served(q), q.src);
}
// And the specific ones this change needs, named outright so a regression says
// which index went missing rather than only that something did.
const hasIx = (...spec) => runsIndexes.some((ix) =>
  ix.length === spec.length && spec.every((s, i) => ix[i].f === s[0] && ix[i].d === s[1]));
for (const [mode, [field, dir]] of Object.entries(TIEBREAK)) {
  ck(`${mode}: the board index exists (score desc, then ${field})`,
     hasIx(['mode','asc'], ['puzzleDate','asc'], ['score','desc'], [field, dir]));
  // Its mirror, for the query whose score is an EQUALITY and whose range is
  // the tiebreak. The live project carries both directions for the Trifecta's
  // pair, which is why Sprint's gets the same treatment rather than an
  // argument about whether the planner needs it.
  ck(`${mode}: the tied-and-ahead index exists (score equality, ${field} range)`,
     hasIx(['mode','asc'], ['puzzleDate','asc'], ['score','asc'], [field, dir]));
}

// ======================================================================= 2 ==
// The board's shared places, in a browser because it writes DOM.

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);

// The renderer is shared by both modes and by the live boards as well as the
// archives, so it is lifted WITH the table that parameterises it. Nothing in
// ARCHIVES is evaluated at definition time — every Firestore call sits inside
// an arrow body — so it lifts without a db.
const grabSrc = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };
const boardSrc = [
  grabSrc(/        function formatSprintTime\(ms\) \{\n[\s\S]*?\n        \}/, 'formatSprintTime'),
  grabSrc(/        function runScore\(r\) \{[^\n]*\}/, 'runScore'),
  grabSrc(/        function runClock\(r\) \{\n[\s\S]*?\n        \}/, 'runClock'),
  // The rows carry equipped titles, and titleText resolves one against the
  // real shop table rather than a stand-in — a stub would prove the lookup
  // works against ids the game does not sell. SHOP_ITEMS closes at indent 12.
  grabSrc(/        const SHOP_ITEMS = \{\n[\s\S]*?\n            \};/, 'SHOP_ITEMS'),
  grabSrc(/        function titleText\(equipped\) \{\n[\s\S]*?\n        \}/, 'titleText'),
  grabSrc(/        const ARCHIVES = \{\n[\s\S]*?\n        \};/, 'ARCHIVES'),
  grabSrc(/        function renderArchiveBoard\(docs, listEl, emptyText, cfg\) \{\n[\s\S]*?\n        \}/, 'renderArchiveBoard'),
].join('\n\n');
ck('extracted renderArchiveBoard and its table verbatim', boardSrc && boardSrc.length > 2000,
   boardSrc ? `${boardSrc.length} chars` : 'MISSING');

// Each mode's rows in the order its own query returns them, and each with the
// same shape of tie: two level on both keys, then two more level with each
// other but behind on the tiebreak alone.
const ROWS = {
  daily: [
    { uid: 'a', username: 'A', score: 4000, wordsGuessed: 3 },
    { uid: 'b', username: 'B', score: 3000, wordsGuessed: 2 },
    { uid: 'c', username: 'C', score: 3000, wordsGuessed: 2 },  // ties B on both
    { uid: 'd', username: 'D', score: 3000, wordsGuessed: 1 },  // same score, fewer words
    { uid: 'e', username: 'E', score: 3000, wordsGuessed: 1 },  // ties D on both
    { uid: 'f', username: 'F', score: 1000, wordsGuessed: 1 },
  ],
  sprint: [
    { uid: 'a', username: 'A', score: 500, wordsGuessed: 1, guess1: 1, elapsedMs: 11000 },
    { uid: 'b', username: 'B', score: 250, wordsGuessed: 1, guess2: 1, elapsedMs: 20000 },
    { uid: 'c', username: 'C', score: 250, wordsGuessed: 1, guess2: 1, elapsedMs: 20000 }, // ties B on both
    { uid: 'd', username: 'D', score: 250, wordsGuessed: 1, guess2: 1, elapsedMs: 31000 }, // same score, slower
    { uid: 'e', username: 'E', score: 250, wordsGuessed: 1, guess2: 1, elapsedMs: 31000 }, // ties D on both
    { uid: 'f', username: 'F', score: 0, wordsGuessed: 0, elapsedMs: null },               // never solved it
  ],
};

const render = async (kind) => {
  const page = await browser.newPage();
  await page.setContent('<div id="list"></div>');
  const out = await page.evaluate(({ boardSrc, rows, kind }) => {
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeCosmetic = (v, d) => (/^[a-z0-9_]+$/.test(String(v || '')) ? v : d);
    const currentUser = null;
    const api = new Function('escapeHtml', 'safeCosmetic', 'currentUser',
      `${boardSrc}\nreturn { ARCHIVES, render: renderArchiveBoard };`)(escapeHtml, safeCosmetic, currentUser);
    const el = document.getElementById('list');
    api.render(rows.map((r) => ({ data: () => r })), el, 'empty', api.ARCHIVES[kind]);
    return {
      places: [...el.querySelectorAll('.lb-rank')].map((n) => n.textContent),
      details: [...el.querySelectorAll('.lb-date')].map((n) => n.textContent),
      scores: [...el.querySelectorAll('.lb-score')].map((n) => n.textContent.trim()),
      html: el.innerHTML,
    };
  }, { boardSrc, rows: ROWS[kind], kind });
  await page.close();
  return out;
};

for (const kind of ['daily', 'sprint']) {
  const { places, details, scores } = await render(kind);
  const M = (s) => `${kind}: ${s}`;
  ck(M('the leader is #1'), places[0] === '#1', String(places[0]));
  ck(M('a tie on BOTH keys shares a place'), places[1] === '#2' && places[2] === '#2', places.join(' '));
  // This is the assertion that fails if the tie key is score alone: D and E
  // would join B and C at #2, and the board would contradict its own order.
  ck(M('level on score but behind on the tiebreak takes its own place'),
     places[3] === '#4', places.join(' '));
  ck(M('and its own tie shares that place'), places[4] === '#4', places.join(' '));
  ck(M('the next entry skips to the right number'), places[5] === '#6', places.join(' '));
  ck(M('places never go backwards'),
     places.every((p, i) => i === 0 || Number(p.slice(1)) >= Number(places[i - 1].slice(1))), places.join(' '));
  ck(M('no row is left with an empty line under the name'),
     details.every((d) => d.trim().length > 0), JSON.stringify(details));
}

// The two modes say DIFFERENT things in those two cells, which is the only
// reason the table exists. Asserted across modes so a config that quietly
// fell back to the other mode's formatting cannot pass.
{
  const d = await render('daily');
  const s = await render('sprint');
  ck('the Trifecta counts words solved under every name',
     d.details.length === 6 && d.details.every((x) => /solved$/.test(x.trim())), JSON.stringify(d.details));
  // Sprint has no sub-line at all. One word means the score IS the guess
  // count — 500/250/150/50/10 is first guess through fifth — so a "3/5" under
  // a 150 restates the number beside it.
  ck('Sprint has no sub-line, because its score already says the guess count',
     s.details.length === 0, JSON.stringify(s.details));
  // Omitted, not emptied: an empty div still takes its own margin-top, which
  // leaves the name sitting above the middle of the row.
  ck('...and leaves no empty element behind to take the space',
     !/lb-date/.test(s.html), (s.html.match(/lb-date[^>]*>/) || [''])[0]);
  // The cell ends on the score either way; Sprint puts its clock in front of
  // it. Checked as "more than the score" rather than against a time format,
  // which is formatSprintTime's business and not this file's.
  ck('Sprint puts the clock in front of the score', s.scores[0] !== '500' && s.scores[0].endsWith('500'), s.scores[0]);
  ck('...and leaves it out when there is no clock to show', s.scores[5] === '0', s.scores[5]);
  ck('the Trifecta score cell is the score alone', d.scores.every((x) => /^[\d,]+$/.test(x)), JSON.stringify(d.scores));
}

await browser.close();
for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
