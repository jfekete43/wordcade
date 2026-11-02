/*
 * Sprint: one word a day, the same word for everyone, fewest guesses wins,
 * fastest solve breaks the tie.
 *
 * Four things here are load-bearing and none of them fail loudly in
 * production if they break:
 *
 * THE CLOCK. It is the tiebreaker, so it is the thing worth cheating. Both
 * ends are stamped inside the Cloud Function and the start is written once
 * and never rewritten — a second write would let a player restart their own
 * clock by retrying a guess. It also cannot use FieldValue.serverTimestamp():
 * that sentinel resolves at commit and cannot be read back inside the
 * transaction that writes it, so two of them cannot be subtracted.
 *
 * THE ANSWER. One word shared by everybody is the most valuable secret in the
 * game — reading it once wins the whole day. It lives in a collection no
 * client may read, and publicSprintState must not hand it back while the
 * attempt is still live.
 *
 * THE COLLISION. Sprint's word is drawn first and excluded from the Daily's
 * seven. Without that a player who does both learns one answer from the
 * other, and the lazy-generate fallbacks mean the two can be created in
 * either order.
 *
 * THE SCALE. Sprint tops out at 500 against a Stakes run with no ceiling, so
 * it must stay off the shared "best run today" board or one word puts a
 * player on a leaderboard nothing else on it can be compared to.
 *
 * Pure; no emulator and no browser. The functions under test are lifted out
 * of functions/index.js by source and evaluated, the way word-difficulty
 * does, so this runs the shipped code rather than a restatement of it.
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

// ---- the pure helpers, lifted and run ------------------------------------
const WORD_DIFFICULTY = JSON.parse(fs.readFileSync(REPO('functions/word-difficulty.json'), 'utf8'));
const DAILY_TARGET_WORDS = JSON.parse(fs.readFileSync(REPO('functions/words.json'), 'utf8')).targetWords;

const helperSrc = [
  grab(/const WORD_STATS_PRIOR = \d+;/, 'WORD_STATS_PRIOR'),
  grab(/const DAILY_GAUNTLET_WORD_COUNT = \d+;/, 'DAILY_GAUNTLET_WORD_COUNT'),
  grab(/function effectiveDifficulty\(word, stats\) \{\n[\s\S]*?\n\}/, 'effectiveDifficulty'),
  grab(/function pickDailyWords\(stats, exclude\) \{\n[\s\S]*?\n\}/, 'pickDailyWords'),
  grab(/function pickSprintWord\(stats\) \{\n[\s\S]*?\n\}/, 'pickSprintWord'),
  grab(/function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n\}/, 'shiftDateStr'),
  grab(/function publicSprintState\(attempt, answer\) \{\n[\s\S]*?\n\}/, 'publicSprintState'),
].join('\n\n');
console.log('extracted from functions/index.js:', helperSrc.length, 'chars');

// eslint-disable-next-line no-new-func
const H = new Function('WORD_DIFFICULTY', 'DAILY_TARGET_WORDS',
  `${helperSrc}; return { pickDailyWords, pickSprintWord, shiftDateStr, publicSprintState };`)(
  WORD_DIFFICULTY, DAILY_TARGET_WORDS);

// ---- the word of the day --------------------------------------------------
{
  const seen = new Set();
  let tiers = new Set();
  for (let i = 0; i < 400; i++) {
    const s = H.pickSprintWord(null);
    seen.add(s.word);
    tiers.add(s.tier);
    if (!/^[A-Z]{5}$/.test(s.word)) { ck(false, 'every Sprint word is five uppercase letters', s.word); break; }
  }
  ck(seen.size > 100, 'the Sprint word is not pinned to a handful of words', String(seen.size));
  // Whole list, not a chosen tier. This was a product decision: some mornings
  // open gently and some open on the hardest word in the game.
  eq('and it is drawn from the whole list, so every tier can come up',
     [...tiers].sort(), ['easy', 'hard', 'medium']);
  const all = new Set(DAILY_TARGET_WORDS.map((w) => w.toUpperCase()));
  ck([...seen].every((w) => all.has(w)), 'and always from the real answer list');
}

// ---- the collision that must not happen -----------------------------------
{
  // The exclusion is what stops a player who does both modes learning one
  // answer from the other.
  // Deterministic, deliberately. Excluding ONE word and drawing seven from
  // 2,315 only catches a broken filter about one run in six, so that version
  // of this check passed with the exclusion deleted outright. Banning all but
  // a handful makes the draw's contents provable instead of probable.
  const survivors = DAILY_TARGET_WORDS.slice(0, 9).map((w) => w.toUpperCase());
  const banAllBut = new Set(DAILY_TARGET_WORDS.map((w) => w.toUpperCase()).filter((w) => !survivors.includes(w)));
  for (let i = 0; i < 5; i++) {
    const words = H.pickDailyWords(null, banAllBut).map((w) => w.toUpperCase());
    const strays = words.filter((w) => !survivors.includes(w));
    if (strays.length) { ck(false, 'the Daily draw contains only words the exclusion left', strays.join(',')); break; }
    if (i === 4) ck(true, 'the Daily draw contains only words the exclusion left');
  }
  // And in bulk, which is the shape the real caller uses.
  const bulk = new Set(DAILY_TARGET_WORDS.slice(0, 1200).map((w) => w.toUpperCase()));
  let leaked = 0;
  for (let i = 0; i < 40; i++) {
    for (const w of H.pickDailyWords(null, bulk)) if (bulk.has(w.toUpperCase())) leaked++;
  }
  eq('an excluded word never appears in the Daily draw, over 280 draws', leaked, 0);
  // Without an exclusion the Daily still works, which is what the scheduled
  // path relied on before Sprint existed.
  ck(H.pickDailyWords(null, new Set()).length === 7, 'and an empty exclusion still yields a full puzzle');
  ck(H.pickDailyWords(null).length === 7, 'as does no exclusion at all');
}

// ---- the streak -----------------------------------------------------------
eq('yesterday is yesterday', H.shiftDateStr('2026-11-01', -1), '2026-10-31');
eq('across a month boundary', H.shiftDateStr('2026-03-01', -1), '2026-02-28');
eq('across a year boundary', H.shiftDateStr('2027-01-01', -1), '2026-12-31');
// A leap year is the case a hand-rolled subtraction gets wrong.
eq('and across a leap day', H.shiftDateStr('2028-03-01', -1), '2028-02-29');
// DST: America/New_York springs forward on 2026-03-08. Parsed as UTC
// precisely so this is plain arithmetic rather than a 23-hour day.
eq('a DST transition does not eat a day', H.shiftDateStr('2026-03-09', -1), '2026-03-08');

// ---- what the client is allowed to see ------------------------------------
{
  const live = { date: '2026-11-01', guesses: [{ guess: 'CRANE', colors: [0, 1, 0, 0, 2] }], solved: false, score: 0, status: 'active', startedAtMs: 1000, elapsedMs: null };
  const outLive = H.publicSprintState(live, 'SOLVE');
  ck(!('answer' in outLive), 'a live attempt never carries the answer', JSON.stringify(outLive));
  ck(!JSON.stringify(outLive).includes('SOLVE'), 'and the word appears nowhere in it');
  eq('it does carry the guesses already made', outLive.guesses.length, 1);
  // Needed so a reload mid-word shows a clock that has been running.
  eq('and the start stamp, so a resumed board can show a running clock', outLive.startedAtMs, 1000);

  const done = { ...live, status: 'finished', solved: true, score: 150, elapsedMs: 64300 };
  const outDone = H.publicSprintState(done, 'SOLVE');
  eq('once finished the answer is allowed out', outDone.answer, 'SOLVE');
  eq('along with the settled time', outDone.elapsedMs, 64300);
}

// ---- the clock, at source --------------------------------------------------
const guessSrc = grab(/exports\.guessSprintWord = onCall\([\s\S]*?\n\}\)\);/, 'guessSprintWord');

ck(/const now = Date\.now\(\);/.test(guessSrc),
   'the clock reads the function\'s own wall clock, not the client\'s');
// The reason this is not serverTimestamp(): that sentinel cannot be read back
// inside the transaction that writes it, so a duration cannot be computed.
ck(!/startedAtMs: FieldValue\.serverTimestamp|solvedAtMs: FieldValue\.serverTimestamp/.test(guessSrc),
   'and not a server-timestamp sentinel, which cannot be subtracted');
ck(/attempt\.startedAtMs == null \? now : attempt\.startedAtMs/.test(guessSrc),
   'the start is written once and reused after, so a retry cannot restart it');
ck(/now - startedAtMs/.test(guessSrc),
   'elapsed is the difference between the two server stamps');
ck(!/request\.data[\s\S]{0,80}elapsed|data\.elapsedMs|data\.startedAt/.test(guessSrc),
   'and nothing about the timing is taken from the request');

// The guess budget and the scoring ladder are the Daily's, not a second copy.
ck(/prior\.length >= DAILY_GAUNTLET_MAX_GUESSES/.test(guessSrc),
   'the five-guess cap is the shared constant, not a literal');
ck(/SCORE_POINTS\[guessNumber - 1\]/.test(guessSrc),
   'and scoring reuses the shared ladder');
ck(/DAILY_ALL_VALID_WORDS\.has\(guess\)/.test(guessSrc),
   'a guess must be a real word, checked on the server');

// ---- score descending IS guesses ascending --------------------------------
// This is why the board can reuse the existing machinery instead of needing
// an ascending sort nothing else in the game does. If SCORE_POINTS ever stops
// being strictly decreasing, the board silently starts ranking by something
// other than guess count.
{
  const pts = JSON.parse(grab(/const SCORE_POINTS = \[[^\]]*\]/, 'SCORE_POINTS').replace('const SCORE_POINTS = ', ''));
  const strictlyDown = pts.every((v, i) => i === 0 || v < pts[i - 1]);
  ck(strictlyDown, 'the scoring ladder is strictly decreasing, so ordering by score IS ordering by guesses',
     JSON.stringify(pts));
  eq('and it still has one entry per guess', pts.length, 5);
}

// ---- the run document ------------------------------------------------------
ck(/db\.collection\("runs"\)\.doc\(`sprint_\$\{uid\}_\$\{today\}`\)/.test(guessSrc),
   'the run id is deterministic, so a second submission cannot double-count a day');
ck(/mode: "sprint", puzzleDate: today/.test(guessSrc),
   'the run is tagged with its mode and date, which is what the board filters on');
// Firestore drops documents missing a field the query orders by, so an
// unsolved run must carry an explicit null rather than omitting it.
ck(/\n\s*elapsedMs,/.test(guessSrc),
   'and always carries elapsedMs, because a document missing an ordered field falls out of the query');

// ---- scale: Sprint stays off the shared board ------------------------------
const dayGuard = (fn.match(/if \(run\.mode !== [^)]*\) \{/) || [''])[0];
ck(/run\.mode !== "sprint"/.test(dayGuard),
   'a Sprint never lands on the "best run today" board', dayGuard);
ck(/run\.mode !== "daily"/.test(dayGuard),
   'and the Daily Puzzle is still excluded alongside it', dayGuard);

// ---- career counters -------------------------------------------------------
const career = fn.slice(fn.indexOf('Sprint\'s career record'), fn.indexOf('The recurring board'));
ck(career.length > 200, 'the Sprint career block is findable', String(career.length));
for (const f of ['sprintPlayed', 'sprintSolved', 'sprintStreak', 'sprintBestStreak', 'sprintBestTimeMs']) {
  ck(career.includes(f), `onRunCreated maintains ${f}`);
}
// A miss has to end the streak, or the number means nothing.
ck(/update\.sprintStreak = 0;/.test(career), 'a missed word resets the streak');
// Replaying the same date must not count as a second day.
ck(/last === run\.puzzleDate/.test(career), 'and replaying one day cannot inflate it');
// Compared against the run's own date rather than "today", so a trigger that
// fires late cannot break a streak the player kept.
ck(/shiftDateStr\(run\.puzzleDate, -1\)/.test(career),
   'continuity is measured from the run\'s own puzzle date, not from whenever the trigger ran');
// Guesses only counted on a solve: a miss always costs the full five and
// would drag the average toward a number nobody played.
ck(/didSolve \? \(g1 \+ g2 \* 2/.test(career), 'the guess average counts solves only');

// ---- the answer is unreachable ---------------------------------------------
ck(/match \/sprintPuzzles\/\{date\} \{\s*\n\s*allow read, write: if false;/.test(rules),
   'no client can read the Sprint word, in any state');
ck(/match \/sprintAttempts\/\{userId\}\/days\/\{date\} \{\s*\n\s*allow read: if isOwner\(userId\);\s*\n\s*allow write: if false;/.test(rules),
   'a player can read their own attempt but write nothing — the clock lives there');
for (const f of ['sprintPlayed', 'sprintSolved', 'sprintBestTimeMs', 'sprintStreak', 'sprintBestStreak']) {
  ck(new RegExp(`!\\('${f}' in request\\.resource\\.data\\)`).test(rules),
     `a new account cannot arrive with ${f} already set`);
}

// ---- the board's index exists ----------------------------------------------
{
  const idx = JSON.parse(fs.readFileSync(REPO('firestore.indexes.json'), 'utf8'));
  const want = [['mode', 'ASCENDING'], ['puzzleDate', 'ASCENDING'], ['score', 'DESCENDING'], ['elapsedMs', 'ASCENDING']];
  const has = (idx.indexes || []).some((i) => i.collectionGroup === 'runs'
    && i.fields.length === want.length
    && i.fields.every((f, n) => f.fieldPath === want[n][0] && f.order === want[n][1]));
  ck(has, 'the Sprint board has the composite index it queries, or it is empty in production and green here');
}

// ---- the landing page ------------------------------------------------------
// Sprint is the mode a visitor arrives on, and arriving must not call a Cloud
// Function: that is the "second hesitation load" the Gauntlet pull-in was
// removed for. The gate paints from markup; the server is touched on the tap.
ck(/<button class="mode-nav-btn mode-sprint" id="btn-nav-1" data-mode="sprint" aria-current="true"/.test(html),
   'the shipped markup marks Sprint as the landing mode before any script runs');
ck(/id="sprint-gate"/.test(html), 'and ships a gate rather than a live board');
const bootBlock = html.slice(html.lastIndexOf('setTimeout(() => {'));
ck(/showSprintLanding\(\);/.test(bootBlock), 'boot lands on Sprint');
ck(!/callStartSprint\(\)/.test(bootBlock),
   'and boot does not call startSprint — arriving is not playing');
const landing = html.slice(html.indexOf('function showSprintLanding()'), html.indexOf('window.leaveSprint'));
ck(!/callStartSprint/.test(landing), 'nor does the landing view itself');
ck(/window\.goToMode\('sprint'\)/.test(html), 'the gate routes through goToMode like every other way into a mode');

// A restored Stakes run must survive a look at Sprint.
const leave = html.slice(html.indexOf('window.leaveSprint = function()'));
ck(/if \(!targetWord\) window\.startNewRun\(\);/.test(leave.slice(0, 1200)),
   'leaving Sprint does not discard a Stakes run that was already in progress');

// ---- the nav scales ---------------------------------------------------------
ck(/grid-template-columns: repeat\(var\(--mode-cols, 4\), minmax\(0, 1fr\)\)/.test(html),
   'the nav takes its column count from a variable rather than a hardcoded four');
// Presence only. The VALUE is checked against the mode table below, which is
// the assertion that cannot go stale — this one hardcoded 5 and broke the
// moment a sixth mode arrived, reporting a layout bug that did not exist.
ck(/<nav class="arcade-menu" aria-label="Game mode" style="--mode-cols: \d+;">/.test(html),
   'and the markup carries it, so the nav is laid out correctly before any script runs');
{
  const modes = (html.match(/const MODES = \{[\s\S]*?\n        \};/) || [''])[0];
  const count = (modes.match(/^\s{12}\w+:/gm) || []).length;
  const declared = Number((html.match(/style="--mode-cols: (\d+);"/) || [])[1]);
  eq('the markup\'s column count matches the number of modes in the table', declared, count);
  const buttons = ((html.match(/<nav class="arcade-menu"[\s\S]*?<\/nav>/) || [''])[0].match(/<button/g) || []).length;
  eq('and so does the number of buttons', buttons, count);
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
