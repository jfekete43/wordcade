/*
 * The Gauntlet plays all ten words, and the board breaks ties on words solved.
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
// fetchGauntletStanding builds its equalities once and spreads them, so the
// spread has to be resolved or mode/puzzleDate go missing from every one of
// its three queries.
const scopedDef = html.match(/const scoped = \[([^\]]*)\];/);
ck('resolved the shared equality list the standing queries spread in', !!scopedDef);
const dailyQueries = [];
for (const m of html.matchAll(/\bquery\s*\(/g)) {
  let a = argsOf(html, m.index);
  if (a === null || !a.includes('"runs"')) continue;
  if (a.includes('...scoped') && scopedDef) a = a.replace('...scoped', scopedDef[1]);
  const eqs = [...a.matchAll(/where\("(\w+)", "==",/g)].map((x) => x[1]);
  if (!eqs.includes('mode') || !/"daily"/.test(a)) continue;
  const ranges = [...a.matchAll(/where\("(\w+)", "[<>]=?",/g)].map((x) => x[1]);
  const orders = [...a.matchAll(/orderBy\("(\w+)", "(asc|desc)"\)/g)].map((x) => ({ f: x[1], d: x[2] }));
  dailyQueries.push({ eqs, ranges, orders, src: a.replace(/\s+/g, ' ').slice(0, 110) });
}
ck('found the daily queries in index.html', dailyQueries.length >= 5, String(dailyQueries.length));
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
ck('there are two board renders', boardQueries.length === 2, String(boardQueries.length));
ck('and every one of them orders by score then words solved',
   boardQueries.length > 0 && boardQueries.every((q) =>
     q.orders.length === 2 && q.orders[0].f === 'score' && q.orders[0].d === 'desc'
     && q.orders[1].f === 'wordsGuessed' && q.orders[1].d === 'desc'),
   boardQueries.map((q) => q.orders.map((o) => o.f + ' ' + o.d).join(' > ')).join('  |  '));
ck('and the tied-and-ahead query, which is an equality on score plus a range on wordsGuessed',
   dailyQueries.some((q) => q.eqs.includes('score') && q.ranges.includes('wordsGuessed')),
   dailyQueries.map((q) => `${q.eqs.join('+')}/${q.ranges.join('+')}`).join(' | '));

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
ck('the board index exists (score desc, then the tiebreak)',
   hasIx(['mode','asc'], ['puzzleDate','asc'], ['score','desc'], ['wordsGuessed','desc']));
ck('the tied-and-ahead index exists (score equality, wordsGuessed range)',
   hasIx(['mode','asc'], ['puzzleDate','asc'], ['score','asc'], ['wordsGuessed','desc']));

// ======================================================================= 2 ==
// The board's shared places, in a browser because it writes DOM.

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);

const boardSrc = bodyAt(html, 'function renderGauntletBoard(docs, listEl, emptyText)');
ck('extracted renderGauntletBoard verbatim', boardSrc && boardSrc.length > 800,
   boardSrc ? `${boardSrc.length} chars` : 'MISSING');

const places = await (async () => {
  const page = await browser.newPage();
  await page.setContent('<div id="list"></div>');
  const out = await page.evaluate(({ boardSrc, rows }) => {
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const safeCosmetic = (v, d) => (/^[a-z0-9_]+$/.test(String(v || '')) ? v : d);
    const currentUser = null;
    const fn = new Function('escapeHtml', 'safeCosmetic', 'currentUser',
      `${boardSrc}\nreturn renderGauntletBoard;`)(escapeHtml, safeCosmetic, currentUser);
    const el = document.getElementById('list');
    fn(rows.map((r) => ({ data: () => r })), el, 'empty');
    return [...el.querySelectorAll('.lb-rank')].map((n) => n.textContent);
  }, {
    boardSrc,
    // In the order the query returns them: score desc, then wordsGuessed desc.
    rows: [
      { uid: 'a', username: 'A', score: 4000, wordsGuessed: 10 },
      { uid: 'b', username: 'B', score: 3000, wordsGuessed: 9 },
      { uid: 'c', username: 'C', score: 3000, wordsGuessed: 9 },  // ties B on both
      { uid: 'd', username: 'D', score: 3000, wordsGuessed: 7 },  // same score, fewer words
      { uid: 'e', username: 'E', score: 3000, wordsGuessed: 7 },  // ties D on both
      { uid: 'f', username: 'F', score: 1000, wordsGuessed: 4 },
    ],
  });
  await page.close();
  return out;
})();

ck('the leader is #1', places[0] === '#1', String(places[0]));
ck('a tie on BOTH fields shares a place', places[1] === '#2' && places[2] === '#2', places.join(' '));
// This is the assertion that fails if the tie key is score alone: D and E would
// join B and C at #2, and the board would contradict its own ordering.
ck('the same score with fewer words takes its own place, not the shared one',
   places[3] === '#4', places.join(' '));
ck('and its own tie shares that place', places[4] === '#4', places.join(' '));
ck('the next entry skips to the right number', places[5] === '#6', places.join(' '));
ck('places never go backwards', places.every((p, i) => i === 0 || Number(p.slice(1)) >= Number(places[i - 1].slice(1))),
   places.join(' '));

await browser.close();
for (const c of t) console.log(c.cond ? 'ok  ' : 'FAIL', c.name, c.cond ? '' : '— ' + c.detail);
const bad = t.filter((c) => !c.cond).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
