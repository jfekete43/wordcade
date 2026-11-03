/*
 * Marathon: fifty words a month, the same fifty for everyone, each player
 * walking them in their own order.
 *
 * The four things that carry this mode, all of them silent when broken:
 *
 * THE PER-PLAYER ORDER. Shuffled WITHIN difficulty bands, never across them.
 * A flat shuffle was the obvious version and it is wrong twice over: it
 * throws away the ramp (the hardest word of the month can land at position
 * three) while looking identical from the outside. The shuffle is also what
 * makes the month unspoilable, so it must actually permute — an order that
 * quietly came back sorted would still pass every "is it a permutation" check
 * written carelessly.
 *
 * IDEMPOTENCE OF THE STANDING. Each finished word writes its own run, so the
 * board fields on the user doc are written from totals the run carries rather
 * than incremented. An increment would climb on a retried trigger and look
 * like play nobody did.
 *
 * THE ANSWERS. Fifty words in one document is the biggest secret in the game;
 * one read would hand over a month.
 *
 * THE SCALE. A marathon run is ONE word's payout, so it must stay off the
 * shared "best run today" board like the Daily and Sprint before it.
 *
 * Pure; no emulator and no browser. The functions are lifted out of
 * functions/index.js by source and evaluated, so this runs shipped code.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const grab = (re, what) => {
  const m = fn.match(re);
  if (!m) throw new Error('could not extract ' + what + ' — the anchor moved');
  return m[0];
};

const WORD_DIFFICULTY = JSON.parse(fs.readFileSync(REPO('functions/word-difficulty.json'), 'utf8'));
const DAILY_TARGET_WORDS = JSON.parse(fs.readFileSync(REPO('functions/words.json'), 'utf8')).targetWords;

const src = [
  grab(/const WORD_STATS_PRIOR = \d+;/, 'WORD_STATS_PRIOR'),
  grab(/const MARATHON_WORD_COUNT = \d+;/, 'MARATHON_WORD_COUNT'),
  grab(/const MARATHON_TIER_SPLIT = \[[^\]]*\];/, 'MARATHON_TIER_SPLIT'),
  grab(/function effectiveDifficulty\(word, stats\) \{\n[\s\S]*?\n\}/, 'effectiveDifficulty'),
  grab(/function pickMarathonWords\(stats\) \{\n[\s\S]*?\n\}/, 'pickMarathonWords'),
  grab(/function mulberry32\(seed\) \{\n[\s\S]*?\n\}/, 'mulberry32'),
  grab(/function seedFrom\(str\) \{\n[\s\S]*?\n\}/, 'seedFrom'),
  grab(/function marathonOrderFor\(uid, month, wordCount\) \{\n[\s\S]*?\n\}/, 'marathonOrderFor'),
].join('\n\n');
console.log('extracted from functions/index.js:', src.length, 'chars');

// eslint-disable-next-line no-new-func
const M = new Function('WORD_DIFFICULTY', 'DAILY_TARGET_WORDS',
  `${src}; return { pickMarathonWords, marathonOrderFor, MARATHON_WORD_COUNT, MARATHON_TIER_SPLIT };`)(
  WORD_DIFFICULTY, DAILY_TARGET_WORDS);

const N = M.MARATHON_WORD_COUNT;
const SPLIT = M.MARATHON_TIER_SPLIT;

// ---- the month's words -----------------------------------------------------
eq('the split sums to the word count', SPLIT.reduce((a, b) => a + b, 0), N);
eq('and there are three bands, matching the difficulty thirds', SPLIT.length, 3);
{
  const words = M.pickMarathonWords(null);
  eq('a month draws exactly that many words', words.length, N);
  eq('with no duplicates', new Set(words).size, N);
  ck(words.every((w) => /^[A-Z]{5}$/.test(w)), 'all five uppercase letters', words.slice(0, 3).join(','));
  const all = new Set(DAILY_TARGET_WORDS.map((w) => w.toUpperCase()));
  ck(words.every((w) => all.has(w)), 'all from the real answer list');
  // Stored easy-to-hard: the canonical order IS the ramp, and the per-player
  // shuffle is defined as a permutation within bands of it.
  const d = words.map((w) => (typeof WORD_DIFFICULTY[w] === 'number' ? WORD_DIFFICULTY[w] : 0.5));
  ck(d.every((v, i) => i === 0 || v >= d[i - 1]),
     'and stored in difficulty order, which is what the bands are cut from',
     d.map((x) => x.toFixed(2)).join(' '));
}

// ---- the per-player order ---------------------------------------------------
const bandOf = (i) => (i < SPLIT[0] ? 0 : i < SPLIT[0] + SPLIT[1] ? 1 : 2);

{
  const order = M.marathonOrderFor('player-one', '2026-11', N);
  eq('an order covers every position exactly once', [...order].sort((a, b) => a - b), [...Array(N).keys()]);
  eq('and is as long as the month', order.length, N);

  // The load-bearing property. Position i must hold a word from band i's own
  // slice, or the ramp is gone.
  const crossings = order.map((w, i) => (bandOf(w) === bandOf(i) ? null : `${i}->${w}`)).filter(Boolean);
  eq('no word ever crosses a difficulty band, so the month still ramps', crossings, []);
}

{
  // ...and it must actually shuffle. An implementation that returned the
  // identity would satisfy every check above.
  const order = M.marathonOrderFor('player-one', '2026-11', N);
  const moved = order.filter((w, i) => w !== i).length;
  ck(moved > N / 2, 'and the order is genuinely shuffled, not the canonical one', `${moved} of ${N} moved`);
}

{
  // Different players, same month: different orders. This is the anti-spoiler
  // property — if two players shared an order, "word 12" would be spoilable.
  const a = M.marathonOrderFor('player-one', '2026-11', N);
  const b = M.marathonOrderFor('player-two', '2026-11', N);
  ck(JSON.stringify(a) !== JSON.stringify(b), 'two players get different orders');
  const samePos = a.filter((w, i) => w === b[i]).length;
  ck(samePos < N / 2, 'and they overlap at only a few positions', `${samePos} of ${N} shared`);
}

{
  // Same player, different months: different orders, or the second month is
  // the first one again.
  const a = M.marathonOrderFor('player-one', '2026-11', N);
  const b = M.marathonOrderFor('player-one', '2026-12', N);
  ck(JSON.stringify(a) !== JSON.stringify(b), 'the same player gets a different order next month');
}

{
  // Deterministic: the order is re-derivable from uid and month alone, which
  // is what lets anyone answer "why did I get these in this order".
  const a = M.marathonOrderFor('player-one', '2026-11', N);
  const b = M.marathonOrderFor('player-one', '2026-11', N);
  eq('the same uid and month always produce the same order', a, b);
}

{
  // A short list must not drop or invent positions.
  const short = M.marathonOrderFor('player-one', '2026-11', 12);
  eq('a shorter word list still yields a complete permutation',
     [...short].sort((a, b) => a - b), [...Array(12).keys()]);
}

// ---- the standing is written, not incremented -------------------------------
const guessSrc = grab(/exports\.guessMarathonWord = onCall\([\s\S]*?\n\}\)\);/, 'guessMarathonWord');
const career = fn.slice(fn.indexOf("Marathon's live standing"), fn.indexOf("Sprint's career record"));
ck(career.length > 200, 'the Marathon standing block is findable', String(career.length));

ck(/marathonScore: newScore, marathonWords: newWordIndex/.test(guessSrc),
   'the run carries the running totals, so the standing can be set rather than added to');
ck(!/marathonScore: FieldValue\.increment|marathonWords: FieldValue\.increment/.test(career),
   'the standing is never incremented — a retried trigger would climb on its own');
ck(/update\.marathonScore = incoming;/.test(career), 'it is set from the run\'s own total');
ck(/incoming > priorInMonth/.test(career),
   'and only ever moves forward, so a late-delivered earlier word cannot drag it back');
ck(/user\.marathonKey === run\.marathonKey[\s\S]{0,120}: -1;/.test(career),
   'a previous month does not count against this one, which is what resets the board');

// One run per WORD, keyed on the position, so a retry lands on the same doc.
ck(/doc\(`marathon_\$\{uid\}_\$\{month\}_\$\{wordIndex\}`\)/.test(guessSrc),
   'each finished word writes its own run, with an id that makes a retry a no-op');
ck(/score: earned,/.test(guessSrc),
   "and that run's score is the one word's payout, not the month's total");

// ---- scale: Marathon stays off the shared board ------------------------------
const dayGuard = (fn.match(/if \(run\.mode !== [^)]*\) \{/) || [''])[0];
ck(/run\.mode !== "marathon"/.test(dayGuard),
   'a Marathon word never lands on the "best run today" board', dayGuard);
for (const m of ['daily', 'sprint']) {
  ck(new RegExp(`run\\.mode !== "${m}"`).test(dayGuard), `and ${m} is still excluded alongside it`, dayGuard);
}

// ---- the month's words are unreachable ---------------------------------------
ck(/match \/marathonPuzzles\/\{month\} \{\s*\n\s*allow read, write: if false;/.test(rules),
   'no client can read the month\'s fifty words');
ck(/match \/marathonAttempts\/\{userId\}\/months\/\{month\} \{\s*\n\s*allow read: if isOwner\(userId\);\s*\n\s*allow write: if false;/.test(rules),
   'a player reads their own attempt and writes nothing — order and score live there');
for (const f of ['marathonScore', 'marathonWords', 'marathonKey']) {
  ck(new RegExp(`!\\('${f}' in request\\.resource\\.data\\)`).test(rules),
     `a new account cannot arrive with ${f} already set`);
}

// The attempt the client receives must never carry the words.
const pub = grab(/function publicMarathonState\(attempt, currentWord\) \{\n[\s\S]*?\n\}/, 'publicMarathonState');
ck(!/words/.test(pub.replace(/wordIndex|wordCount|wordsSolved|currentWord|revealedWord/g, '')),
   'the public attempt shape carries no word list', pub.slice(0, 200));
ck(/revealedWord: currentWord \|\| null/.test(pub),
   'only an already-finished word is ever revealed');

// ---- the board's index exists -------------------------------------------------
{
  const idx = JSON.parse(fs.readFileSync(REPO('firestore.indexes.json'), 'utf8'));
  const want = [['marathonKey', 'ASCENDING'], ['marathonScore', 'DESCENDING']];
  const has = (idx.indexes || []).some((i) => i.collectionGroup === 'users'
    && i.fields.length === want.length
    && i.fields.every((f, n) => f.fieldPath === want[n][0] && f.order === want[n][1]));
  ck(has, 'the standings have the composite index they query, or the board is empty in production and green here');
}

// ---- the month boundary ---------------------------------------------------------
ck(/onSchedule\(\{ schedule: "5 0 1 \* \*", timeZone: "America\/New_York" \}/.test(fn),
   'a new month of words is generated on the 1st, Eastern');
const gen = grab(/exports\.generateMarathonPuzzle = onSchedule\([\s\S]*?\n\}\);/, 'generateMarathonPuzzle');
ck(/if \(snap\.exists\) return;/.test(gen),
   'and a month already in progress is never overwritten, which would void everyone\'s score');

// ---- the client ------------------------------------------------------------------
ck(/marathon: \{ label: "MARATHON", cls: "mode-marathon", color: "var\(--c-marathon\)" \}/.test(html),
   'the mode table carries Marathon');
ck(/<button class="mode-nav-btn mode-marathon" id="btn-nav-6" data-mode="marathon"/.test(html),
   'and the nav ships a button for it');
ck(/if \(isMarathonMode\) \{ submitMarathonGuess\(\); \}/.test(html),
   'typing in Marathon reaches the Marathon handler, not checkGuess');
ck(/else if \(target === "marathon"\) await window\.openMarathon\(\);/.test(html),
   'and the only way in is through goToMode, like every other mode');
// The board reads the denormalised fields, which is what makes it live.
const board = html.slice(html.indexOf('async function loadMarathonBoard()'), html.indexOf('function monthKeyFor'));
ck(/where\("marathonKey", "==", month\)/.test(board) && /orderBy\("marathonScore", "desc"\)/.test(board),
   'the standings read the denormalised month fields off /users');
ck(/collection\(db, "users"\)/.test(board),
   'from /users rather than aggregating /runs, which is what lets it show players mid-month');
ck(/marathonWords/.test(board), 'and show how far through each player is');
// Leaving must not discard a Stakes run, the same way Sprint's leave does not
// — which is now literally the same way: both go through the one restore, so
// this follows it there rather than pinning the line to leaveMarathon's body.
{
  const leave = (html.match(/window\.leaveMarathon = function\(\) \{[\s\S]*?\n        \}/) || [''])[0];
  ck(/showStandardSurface\(\);/.test(leave), 'leaving Marathon goes back through the shared restore', leave.slice(-200));
  const restore = (html.match(/        function showStandardSurface\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(/if \(!targetWord\) window\.startNewRun\(\);/.test(restore),
     'leaving Marathon does not discard a Stakes run already in progress', restore);
  // The Marathon progress text is Marathon's own and is not in the shared
  // body, so the leave still has to put the play surface back itself.
  ck(/setMarathonPlaySurfaceVisible\(true\);/.test(leave),
     'and still hands back the board and keyboard on its way out', leave.slice(-240));
}

// ---- the nav still adds up ---------------------------------------------------------
{
  const modes = (html.match(/const MODES = \{[\s\S]*?\n        \};/) || [''])[0];
  const count = (modes.match(/^\s{12}\w+:/gm) || []).length;
  const declared = Number((html.match(/style="--mode-cols: (\d+);"/) || [])[1]);
  eq('the markup\'s column count still matches the mode table', declared, count);
  const buttons = ((html.match(/<nav class="arcade-menu"[\s\S]*?<\/nav>/) || [''])[0].match(/<button/g) || []).length;
  eq('and so does the number of buttons', buttons, count);
  eq('which is six now', count, 6);
}


const boardSrc = html.slice(html.indexOf('async function loadMarathonBoard()'),
  html.indexOf('async function loadMarathonBoard()') + 2500);

// ---- the board is not painted into a hidden container -----------------------
// openMarathon calls showStandardPanels(false) to clear the Stakes furniture,
// and that hides #daily-board-container outright — the very element this
// board's rows are written into. Without taking the container back, every row
// landed in a hidden element and the board simply never appeared while
// playing. It looked fine on the landing screen, which does not call
// showStandardPanels at all, which is exactly why it survived review.
{
  const open = html.slice(html.indexOf('window.openMarathon = async function'), html.indexOf('function startMarathonRound'));
  ck(/showStandardPanels\(false\)/.test(open), 'openMarathon clears the Stakes panels', open.slice(0, 80));
  ck(/document\.getElementById\("daily-board-container"\)\.style\.display = "block";/.test(boardSrc),
     'and the board takes the container back before writing into it');
  // The tab row switches between the three STAKES boards. Leaving it up over
  // a Marathon board shows "All Time" highlighted above today's standings.
  ck(/document\.getElementById\("home-board-tabs"\)\.style\.display = "none";/.test(boardSrc),
     'and hides the Stakes tab row, which does not apply to this board');
}
// ...and the tab row comes back on every route out, not just this mode's.
{
  const panels = html.slice(html.indexOf('function showStandardPanels(visible)'));
  ck(/if \(visible\) document\.getElementById\("home-board-tabs"\)\.style\.display = "";/.test(panels.slice(0, 900)),
     'showStandardPanels restores the tab row, so any way back to Stakes restores it');
}


// ---- days left in the month --------------------------------------------------
// A month-long mode with no visible deadline is just a long list; the clock on
// it is the only thing that makes it a marathon. The arithmetic is the part
// that fails quietly - an off-by-one reads as plausible all month and is only
// wrong on the day it matters, and a hardcoded month length is right eleven
// times a year.
{
  const daysSrc = (html.match(/function marathonDaysLeft\(monthKey, todayStr\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!daysSrc, 'marathonDaysLeft is findable', daysSrc.slice(0, 60));
  // eslint-disable-next-line no-new-func
  const daysLeft = new Function(`${daysSrc}; return marathonDaysLeft;`)();

  // Counting today: on the 2nd of a 30-day month there are 29 days to play.
  eq('the first of a 30-day month has the whole month', daysLeft('2026-11', '2026-11-01'), 30);
  eq('the second has one fewer', daysLeft('2026-11', '2026-11-02'), 29);
  eq('and the last day has one', daysLeft('2026-11', '2026-11-30'), 1);

  // Month length is read, not assumed.
  eq('a 31-day month is 31', daysLeft('2026-12', '2026-12-01'), 31);
  eq('February is 28 in a common year', daysLeft('2027-02', '2027-02-01'), 28);
  eq('and 29 in a leap year', daysLeft('2028-02', '2028-02-01'), 29);
  eq('the leap day itself is the last one', daysLeft('2028-02', '2028-02-29'), 1);
  // 2100 is not a leap year, which a naive divisible-by-four check gets wrong.
  eq('and a century that is not a leap year is still 28', daysLeft('2100-02', '2100-02-01'), 28);

  // A page left open across the boundary must not report a negative count or
  // a number from the wrong month.
  eq('a month that has already rolled over has nothing left', daysLeft('2026-11', '2026-12-01'), 0);
  eq('nor does a date before it somehow gain days', daysLeft('2026-11', '2026-10-31'), 0);

  eq('a malformed month yields nothing rather than a number', daysLeft('nonsense', '2026-11-02'), null);
  eq('and so does a malformed date', daysLeft('2026-11', ''), null);
}

// The wording, and the one case where a count is the wrong thing to show.
{
  const render = (html.match(/function renderMarathonDaysLeft\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(/"LAST DAY"/.test(render), 'the final day says so rather than counting to one', render.slice(0, 80));
  ck(/"DAYS LEFT: "/.test(render), 'and every other day carries the count');
  ck(/var\(--c-loss\)/.test(render), 'the last few days are marked, so the deadline is felt before it arrives');
  ck(/getTodayDateStr\(\)/.test(render), 'today comes from the Eastern date helper, like every other boundary');
  ck(/marathonAttempt && marathonAttempt\.month/.test(render),
     "and the month comes from the server-issued attempt rather than the browser's idea of it");
}


// ---- the board row reads detail, then score ----------------------------------
// Same shape as the Sprint row, and that is the point: the two boards share
// one slot on the home screen, so ending on different things would read worse
// than either choice alone. Both end on the number that decides the order.
{
  // Anchored on the DEFINITION of leaveMarathon - the bare name is also an
  // onclick in the end-modal markup thousands of lines earlier, which has
  // sliced checks in this repo backwards into an empty string repeatedly.
  const from = html.indexOf('async function loadMarathonBoard()');
  const to = html.indexOf('window.leaveMarathon = function');
  ck(from !== -1 && to > from, 'the Marathon board builder is findable', `${from}..${to}`);
  const board = html.slice(from, to);

  const paceAt = board.indexOf('w &middot; ${avg}/w');
  const scoreAt = board.indexOf('${Number(r.score || 0).toLocaleString()}</span>');
  ck(paceAt !== -1 && scoreAt !== -1, 'the row carries both a pace and a score', `${paceAt}/${scoreAt}`);
  ck(paceAt < scoreAt, 'and the pace comes first, with the score last', `pace@${paceAt} score@${scoreAt}`);

  const paceSpan = board.slice(board.lastIndexOf('<span', paceAt), paceAt);
  ck(/margin-right: var\(--s-\d+\)/.test(paceSpan),
     'separated by a margin rather than a space, as on the Sprint row', paceSpan);

  // Words completed is what stops the score meaning two things at once: 380
  // over ten words and 380 over twenty are a different player.
  ck(/\$\{words\}w/.test(board), 'and the row says how far through the month the player is');
}

// Both boards in the shared slot agree about where the score goes. A test per
// board would pass while they disagreed with each other.
{
  const builder = (name) => {
    const from = html.indexOf(`async function load${name}Board()`);
    const to = html.indexOf(`window.leave${name} = function`);
    return html.slice(from, to);
  };
  const endsOnScore = (src) => {
    const score = src.indexOf('Number(r.score || 0).toLocaleString()');
    const muted = src.indexOf('color:var(--c-ink-4); margin-right');
    return muted !== -1 && score !== -1 && muted < score;
  };
  ck(endsOnScore(builder('Sprint')), 'the Sprint row ends on its score');
  ck(endsOnScore(builder('Marathon')), 'and so does the Marathon row, in the same slot');
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
