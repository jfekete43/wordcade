/*
 * Marathon's Profile tab, and the Hall of Fame board beside it.
 *
 * Marathon came back from being closed with no career side at all: it stored
 * the week you were on and nothing else, so there was nothing all-time to
 * rank and nothing for a career challenge to count. onRunCreated keeps four
 * fields now — bestMarathonScore, bestMarathonWords, bestMarathonWeek and
 * marathonWeeks — and this is everything that reads them.
 *
 * The one that needs watching is THIS WEEK. marathonScore and marathonWords
 * are the live standings fields, and they are only this week's while
 * marathonKey says so. A week that has rolled over leaves last week's totals
 * sitting on the document — the board stops counting them the moment the key
 * changes, and so must the panel, or a player opens Monday's Profile and is
 * told they are seven words into a week they have not started.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(got === want, name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const deq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const src = [
  grab(/ {8}const LEADERBOARD_PERIOD = "[^"]*";/, 'LEADERBOARD_PERIOD'),
  grab(/ {8}function etParts\(when\) \{\n[\s\S]*?\n {8}\}/, 'etParts'),
  grab(/ {8}function periodKeyFor\(when, period\) \{\n[\s\S]*?\n {8}\}/, 'periodKeyFor'),
  grab(/ {8}function marathonKeyFor\(d\) \{\n[\s\S]*?\n {8}\}/, 'marathonKeyFor'),
  grab(/ {8}const MARATHON_WORD_COUNT = \d+;/, 'MARATHON_WORD_COUNT'),
  grab(/ {8}function marathonWeekLabel\(key\) \{\n[\s\S]*?\n {8}\}/, 'marathonWeekLabel'),
  grab(/ {8}function renderGuessDistribution\(counts, wrap, dist, lit, accent\) \{\n[\s\S]*?\n {8}\}/, 'renderGuessDistribution'),
  grab(/ {8}function loadMarathonStats\(\) \{\n[\s\S]*?\n {8}\}/, 'loadMarathonStats'),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

// The week the panel will call "this week", computed the same way it does,
// so the fixtures below are not a second idea of when a week starts.
const THIS_WEEK = new Function(`${src}\nreturn marathonKeyFor(new Date());`)();
ck(/^\d{4}-\d{2}-\d{2}$/.test(THIS_WEEK), 'the current week key is a date', THIS_WEEK);

// Scraped out of the panel rather than written down here. A list kept by
// hand goes stale in the direction that hides the bug: a new element nobody
// added to it is simply never checked, and the fake below would still happily
// hand the loader an object to write into.
const PANEL = html.slice(html.indexOf('<div id="profile-marathon"'),
                         html.indexOf('<div id="profile-sprint"'));
// From past the panel div's own tag: the container is shown and hidden by
// the tab switcher, not written to by the loader.
const PANEL_IDS = [...PANEL.slice(PANEL.indexOf('>')).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
ck(PANEL_IDS.length >= 7, 'the Marathon panel is findable and has its elements',
   PANEL_IDS.join(','));
const run = (profile) => {
  const els = {};
  const touched = new Set();
  for (const id of PANEL_IDS) els[id] = { id, innerText: '', innerHTML: '', style: {} };
  let reads = 0;
  const doc = { getElementById: (id) => {
    if (!(id in els)) throw new Error('wrote to an element the markup does not have: ' + id);
    touched.add(id);
    return els[id];
  } };
  new Function('document', 'userProfileData', 'getDoc', 'getDocs', 'db',
    `${src}\nloadMarathonStats();`)(doc, profile,
    () => { reads++; }, () => { reads++; }, {});
  return { els, reads, touched };
};

ck(/id="profile-marathon"/.test(html), 'and a panel to put them in');
ck(/id="tab-prof-marathon"/.test(html), 'and a Profile tab to reach it by');
ck(/id="tab-marathon"/.test(html), 'and a Hall of Fame tab of its own');

// ---- the client's word count is the server's -----------------------------
// "7 of 20" on a week that is no longer twenty words long is a lie on the one
// screen a player checks their progress on.
{
  const client = Number(/ {8}const MARATHON_WORD_COUNT = (\d+);/.exec(html)[1]);
  const server = Number(/const MARATHON_WORD_COUNT = (\d+);/.exec(fn)[1]);
  eq('the screen counts to the same twenty the server deals', client, server);
}

// ---- the week label ------------------------------------------------------
{
  const label = new Function(`${src}\nreturn marathonWeekLabel;`)();
  const got = label('2026-11-02');
  ck(got.length > 0 && !/Invalid/.test(got), 'a week key becomes a readable date', got);
  // Parsed as UTC: the key is already an Eastern calendar date, and
  // re-anchoring it to the viewer's zone would slide it a day west of the
  // Monday it names.
  ck(/2/.test(got), 'and it is the Monday the key names, not the day before', got);
  for (const bad of ['', null, undefined, '2026-11', 'Monday', '2026-11-2']) {
    eq(`${JSON.stringify(bad)}: nothing rather than a broken date`, label(bad), '');
  }
}

// ---- the headline --------------------------------------------------------
{
  const { els, reads } = run({ bestMarathonScore: 7480, bestMarathonWeek: '2026-11-02',
                               bestMarathonWords: 20, marathonWeeks: 6 });
  eq('the best week is the headline', els['stat-marathon-best'].innerText, '7,480');
  ck(/^Week of /.test(els['stat-marathon-best-when'].innerText),
     'with the week it happened underneath', els['stat-marathon-best-when'].innerText);
  eq('weeks played is its own number', els['stat-marathon-weeks'].innerText, '6');
  eq('and the furthest you have got reads as a fraction of a week',
     els['stat-marathon-furthest'].innerText, '20 of 20');
  eq('and the tab costs no reads at all', reads, 0);
}
{
  const { els } = run({});
  eq('a player who has never played gets a dash, not a zero', els['stat-marathon-best'].innerText, '—');
  eq('and no week under it', els['stat-marathon-best-when'].innerText, ' ');
  eq('weeks played is honestly zero', els['stat-marathon-weeks'].innerText, '0');
  eq('and furthest is a dash rather than "0 of 20"', els['stat-marathon-furthest'].innerText, '—');
}
{
  // A best score with no stored week: the claim stands, it just cannot say when.
  const { els } = run({ bestMarathonScore: 300 });
  eq('a best with no week still shows', els['stat-marathon-best'].innerText, '300');
  eq('...with a blank line rather than "Week of undefined"',
     els['stat-marathon-best-when'].innerText, ' ');
}

// ---- this week -----------------------------------------------------------
{
  const { els } = run({ marathonKey: THIS_WEEK, marathonScore: 2430, marathonWords: 7 });
  eq('a week in progress reads as points and position',
     els['stat-marathon-now'].innerText, '2,430 pts · 7 of 20 words done');
}
{
  // The one that matters. Last week's totals are still on the document until
  // the first run of the new week overwrites them.
  const { els } = run({ marathonKey: '2020-01-06', marathonScore: 9000, marathonWords: 20 });
  ck(/Not started yet/.test(els['stat-marathon-now'].innerText),
     'a key from a week that is over reads as not started, not as this week’s progress',
     els['stat-marathon-now'].innerText);
  ck(!/9,000/.test(els['stat-marathon-now'].innerText),
     '...and last week’s score is nowhere on the line', els['stat-marathon-now'].innerText);
}
{
  const { els } = run({ marathonKey: THIS_WEEK, marathonScore: 0, marathonWords: 0 });
  ck(/Not started yet/.test(els['stat-marathon-now'].innerText),
     'a started-but-empty week reads as not started', els['stat-marathon-now'].innerText);
  const none = run({}).els;
  eq('and so does no key at all', none['stat-marathon-now'].innerText,
     els['stat-marathon-now'].innerText);
}

// ---- the average, and the perfect weeks ----------------------------------
// Per week PLAYED. Dividing career points by the weeks that have existed
// would make the number a measure of attendance, and a weekly mode you are
// allowed to miss would punish you for missing one.
{
  const { els } = run({ marathonWeeks: 4, marathonScoreTotal: 24000, marathonPerfect: 2 });
  eq('the average is the career points over the weeks played',
     els['stat-marathon-avg'].innerText, '6,000');
  eq('and perfect weeks are their own count', els['stat-marathon-perfect'].innerText, '2');
}
{
  // 20000/3 is 6666.67: rounded it is 6,667, truncated it is 6,666. Picked
  // so the two cannot both pass.
  const { els } = run({ marathonWeeks: 3, marathonScoreTotal: 20000 });
  eq('a rounded average, because a score is a whole number',
     els['stat-marathon-avg'].innerText, '6,667');
}
{
  const { els } = run({ marathonScoreTotal: 5000 });
  eq('no weeks played is a dash, never a division by zero',
     els['stat-marathon-avg'].innerText, '\u2014');
  eq('and no perfect weeks is an honest zero', els['stat-marathon-perfect'].innerText, '0');
}
{
  // The one that would read as a lie: points banked under a week counter
  // that never moved. The average still has to come out of weeks PLAYED.
  const { els } = run({ marathonWeeks: 1, marathonScoreTotal: 9120, marathonPerfect: 1 });
  eq('one week played is the whole of that week', els['stat-marathon-avg'].innerText, '9,120');
}

// ---- the guess distribution ----------------------------------------------
// Six rows: one to five guesses, then the misses. The misses are DERIVED as
// every word played minus the five solve counters, which is only sound
// because exactly one of those five moves per solved word and none on a
// miss. A sixth stored counter would be a number that can disagree.
const chartOf = (els) => [...String(els['marathon-prof-dist'].innerHTML)
  .matchAll(/<div class="stat-label">([^<]*)<\/div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width: (\d+)%[^"]*">([^<]*)</g)]
  .map((m) => [m[1], Number(m[2]), m[3]]);
{
  const { els } = run({ marathonG1: 1, marathonG2: 6, marathonG3: 9, marathonG4: 3, marathonG5: 1,
                        marathonWordsTotal: 24 });
  const rows = chartOf(els);
  deq('the chart draws six rows', rows.map((r) => r[0]), ['1', '2', '3', '4', '5', 'X']);
  deq('each carrying its own count', rows.map((r) => r[2]), ['1', '6', '9', '3', '1', '4']);
  eq('the misses are what is left over', rows[5][2], String(24 - (1 + 6 + 9 + 3 + 1)));
  eq('the tallest row fills the bar', rows[2][1], 100);
  eq('and the rest are drawn against it', rows[1][1], Math.round((6 / 9) * 100));
  ck(els['marathon-prof-dist-wrap'].style.display === 'block',
     'and the section is shown', els['marathon-prof-dist-wrap'].style.display);
}
{
  // Marathon has no "today" to pick out - a week is twenty words, not one -
  // so nothing is lit and every solve row is the same colour.
  const { els } = run({ marathonG1: 2, marathonG3: 2, marathonWordsTotal: 4 });
  const fills = [...String(els['marathon-prof-dist'].innerHTML).matchAll(/background: ([^;]+);/g)]
    .map((m) => m[1]);
  eq('no row is picked out in the mode colour',
     fills.filter((c) => c.includes('--c-marathon')).length, 0);
  eq('the five solve rows are all the one colour',
     new Set(fills.slice(0, 5)).size, 1);
  eq('and the miss row is the loss colour', fills[5], 'var(--c-loss)');
}
{
  const { els } = run({});
  ck(els['marathon-prof-dist-wrap'].style.display === 'none',
     'a player with no Marathon words gets no chart rather than six empty bars',
     els['marathon-prof-dist-wrap'].style.display);
}
{
  // A miss-only history still has something to say.
  const { els } = run({ marathonWordsTotal: 3 });
  ck(els['marathon-prof-dist-wrap'].style.display === 'block',
     'three missed words is still a distribution');
  eq('all of them in the X row', chartOf(els)[5][2], '3');
}

// ---- nothing in the panel is drawn by nobody -----------------------------
// The other direction of the id check above: an element the markup carries
// and the loader never writes to is a number frozen at whatever the HTML
// says, which on this panel is a zero or a dash that never moves.
{
  const { touched } = run({ marathonWeeks: 2, marathonScoreTotal: 100, marathonG1: 1,
                            marathonWordsTotal: 1, bestMarathonScore: 100,
                            bestMarathonWeek: '2026-11-02', bestMarathonWords: 20 });
  deq('every element on the panel is written by the loader',
     PANEL_IDS.filter((id) => !touched.has(id)), []);
}

// ---- nothing on the panel can be seeded at sign-up -----------------------
// Every number here comes off the user document, and the user document is
// created by the CLIENT. A field the rules do not pin is a field a fresh
// account can simply arrive holding: forty perfect weeks, a nine-thousand
// average, a chart of nothing but one-guess solves. None of these gate a
// reward, which is exactly why they are easy to forget.
//
// Scraped out of the loader rather than listed here, so a field added to the
// panel is covered the day it lands rather than the day someone remembers.
{
  const loader = grab(/ {8}function loadMarathonStats\(\) \{\n[\s\S]*?\n {8}\}/, 'loadMarathonStats');
  const seen = new Set([...loader.matchAll(/\bp\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  // The five chart counters are reached by a built name, so they appear
  // nowhere as p.something.
  ck(/p\["marathonG" \+ i\]/.test(loader), 'the chart counters are read by a built name');
  for (const i of [1, 2, 3, 4, 5]) seen.add('marathonG' + i);
  const fields = [...seen].filter((f) => /^(marathon|bestMarathon)/.test(f)).sort();
  ck(fields.length >= 11, 'the panel reads its numbers off the profile', fields.join(','));
  const pinned = (f) => new RegExp(
    `!\\('${f}' in request\\.resource\\.data\\)|request\\.resource\\.data\\.${f} == 0`).test(rules);
  deq('and the rules pin every one of them', fields.filter((f) => !pinned(f)), []);
}

// ---- the Hall of Fame board ----------------------------------------------
// Best WEEK, not a career total: a lifetime total ranks whoever has been here
// longest, which is the one thing a leaderboard should never reward.
{
  const loader = html.slice(html.indexOf('window.loadLeaderboardData = async function'),
                            html.indexOf('GAME LOGIC (STANDARD & VERSUS)'));
  ck(/currentLbTime === 'marathon'/.test(loader), 'the board has a Marathon branch');
  ck(/orderBy\("bestMarathonScore", "desc"\)/.test(loader),
     'ranked on the best single week', (loader.match(/[^\n]*bestMarathonScore[^\n]*/) || [''])[0].trim());
  ck(!/orderBy\("marathonScore"/.test(loader),
     'never on the live week, which would be a board that empties every Monday');
  // The rank line under the board reads the same field as the board above it.
  const boards = html.slice(html.indexOf('const USERS_BOARD = {'), html.indexOf('const board = USERS_BOARD[mode]'));
  ck(/marathon: \{ field: "bestMarathonScore"/.test(boards),
     'and your own position is counted against that same field', boards);
}

// ---- the standing block, lifted and run ----------------------------------
// Marathon writes one run per finished WORD, and the triggers for two words
// finished close together can arrive out of order. Everything in this block
// exists for that: the carried running total rather than an increment, the
// only-move-forward guard, and the week counted on the KEY changing rather
// than per run. All three are invisible in the source text and silent when
// wrong - the numbers just drift upward over weeks.
{
  const blockSrc = (fn.match(/ {4}if \(run\.mode === "marathon" && run\.marathonKey\) \{\n[\s\S]*?\n {4}\}/) || [''])[0];
  ck(blockSrc.length > 400, 'the standing block is findable', String(blockSrc.length));
  // The block reads score/wordsPlayed/g1..g5 off names onRunCreated computes
  // above it. Lifted rather than recomputed here: a local copy of those
  // coercions is a second opinion about what a run doc means, and the two
  // would drift the first time one of them learns to clamp something.
  const preamble = (fn.match(/ {4}const score = Math\.max\(0, Number\(run\.score\)[\s\S]*?\n {4}const g5 = [^\n]*\n/) || [''])[0];
  ck(preamble.length > 200, 'and the run-field coercions above it are too', String(preamble.length));
  const apply = new Function('user', 'run', `
    const FieldValue = { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }) };
    const update = {};
    ${preamble}
    ${blockSrc}
    return update;`);
  const W1 = '2026-11-02', W2 = '2026-11-09';
  const word = (week, score, words) => ({ mode: 'marathon', marathonKey: week, marathonScore: score, marathonWords: words });

  // A first word, from nothing.
  {
    const u = apply({}, word(W1, 250, 1));
    eq('a first word starts the week', u.marathonScore, 250);
    eq('and counts the week', u.marathonWeeks, 1);
    eq('and sets the best, because there was none', u.bestMarathonScore, 250);
    eq('and records which week it was', u.bestMarathonWeek, W1);
    eq('and how far in', u.bestMarathonWords, 1);
  }
  // Later words in the SAME week do not count a second week.
  {
    const after1 = { marathonKey: W1, marathonScore: 250, marathonWords: 1, marathonWeeks: 1,
                     bestMarathonScore: 250, bestMarathonWeek: W1, bestMarathonWords: 1 };
    const u = apply(after1, word(W1, 700, 2));
    eq('a second word in the same week moves the score', u.marathonScore, 700);
    eq('and does NOT count another week', u.marathonWeeks, undefined);
    eq('but does move the best', u.bestMarathonScore, 700);
  }
  // A new week does.
  {
    const after1 = { marathonKey: W1, marathonScore: 4000, marathonWords: 12, marathonWeeks: 1,
                     bestMarathonScore: 4000, bestMarathonWeek: W1, bestMarathonWords: 12 };
    const u = apply(after1, word(W2, 250, 1));
    eq('the first word of a new week counts the week', u.marathonWeeks, 2);
    eq('and the standing starts over at that week\'s total', u.marathonScore, 250);
    eq('while the best is left where it was', u.bestMarathonScore, undefined);
    eq('and the best week with it', u.bestMarathonWeek, undefined);
    eq('and the furthest-in too', u.bestMarathonWords, undefined);
  }
  // THE ORDERING HAZARD. An earlier word of the week, delivered late, carries
  // a SMALLER running total than the one already stored.
  {
    const ahead = { marathonKey: W1, marathonScore: 1800, marathonWords: 6, marathonWeeks: 1,
                    bestMarathonScore: 1800, bestMarathonWeek: W1, bestMarathonWords: 6 };
    const u = apply(ahead, word(W1, 900, 3));
    eq('a late-arriving earlier word does not drag the standing back', u.marathonScore, undefined);
    eq('nor the words done', u.marathonWords, undefined);
    eq('nor the best', u.bestMarathonScore, undefined);
    eq('nor the furthest-in', u.bestMarathonWords, undefined);
    eq('and certainly does not count the week twice', u.marathonWeeks, undefined);
  }
  // A worse week leaves the career bests alone, which is what makes them
  // career bests rather than "the last week you played".
  {
    const veteran = { marathonKey: W1, marathonScore: 0, marathonWeeks: 5,
                      bestMarathonScore: 9000, bestMarathonWeek: '2026-01-05', bestMarathonWords: 20 };
    const u = apply(veteran, word(W2, 300, 1));
    eq('a quiet week does not overwrite the best score', u.bestMarathonScore, undefined);
    eq('nor the week it was set in', u.bestMarathonWeek, undefined);
    eq('nor the furthest you have ever got', u.bestMarathonWords, undefined);
    eq('though it still counts as a week played', u.marathonWeeks, 6);
  }
  // Beating only one of the two moves only that one: a long slow week can
  // take `furthest` without taking `best score`.
  {
    const u = apply({ marathonKey: W1, marathonScore: 0, bestMarathonScore: 9000, bestMarathonWords: 10 },
                    word(W2, 4000, 15));
    eq('a longer but lower-scoring week takes the furthest', u.bestMarathonWords, 15);
    eq('and leaves the best score alone', u.bestMarathonScore, undefined);
  }
  // ---- the career counters, run rather than grepped --------------------
  // These are increments where everything above them is a compare-and-set,
  // and the difference is easy to get wrong in the direction that only shows
  // up as numbers drifting upward over weeks. The source SAYS
  // "update.marathonScoreTotal =" whether it increments by this word's earn
  // or by the week's running total; only running it says which.
  const inc = (v) => (v && typeof v === 'object' && 'inc' in v ? v.inc : v);
  {
    // A third word, worth 450, leaving the week on 700 after two earlier ones.
    const u = apply({ marathonKey: W1, marathonScore: 250, marathonWords: 1 },
                    { ...word(W1, 700, 2), score: 450, wordsPlayed: 1, guess3: 1 });
    eq('career points move by what THIS word earned', inc(u.marathonScoreTotal), 450);
    ck(inc(u.marathonScoreTotal) !== 700,
       '...not by the week total it leaves the player on, which would re-count every earlier word');
    eq('and the words-played denominator by one word', inc(u.marathonWordsTotal), 1);
    eq('a three-guess solve lands in the three-guess bar', inc(u.marathonG3), 1);
    deq('and nowhere else', [1, 2, 4, 5].map((i) => inc(u['marathonG' + i])), [0, 0, 0, 0]);
  }
  {
    const u = apply({}, { ...word(W1, 0, 1), score: 0, wordsPlayed: 1 });
    eq('a missed word still counts against the denominator', inc(u.marathonWordsTotal), 1);
    deq('but lands in none of the five solve bars',
        [1, 2, 3, 4, 5].map((i) => inc(u['marathonG' + i])), [0, 0, 0, 0, 0]);
  }

  // ---- the perfect week ------------------------------------------------
  // Solves can never outrun words played, so solved == total holds on the
  // last word of a clean week and on no other document in that week. That is
  // what makes a plain increment safe here.
  {
    const done = { ...word(W1, 9120, 20), marathonSolved: 20, marathonTotal: 20 };
    eq('twenty of twenty solved is a perfect week', inc(apply({}, done).marathonPerfect), 1);
  }
  {
    const missed = { ...word(W1, 7480, 20), marathonSolved: 18, marathonTotal: 20 };
    eq('finishing a week with two missed words is not',
       apply({}, missed).marathonPerfect, undefined);
  }
  {
    const midweek = { ...word(W1, 3000, 8), marathonSolved: 8, marathonTotal: 20 };
    eq('and eight for eight at the halfway point is not one yet',
       apply({}, midweek).marathonPerfect, undefined);
  }
  {
    // A run doc written before the field existed carries no total at all.
    const old = { ...word(W1, 9120, 20), marathonSolved: 20 };
    eq('a run doc with no week size counts no perfect week',
       apply({}, old).marathonPerfect, undefined);
  }

  // Nothing here runs for another mode's run.
  {
    const u = apply({}, { mode: 'sprint', puzzleDate: '2026-11-02', score: 500 });
    eq('a run from another mode touches none of it', Object.keys(u).length, 0);
  }
}

// ---- what the Marathon run document actually carries ---------------------
// The two fields the perfect-week counter reads are written here, and a
// field bound to the wrong local is invisible in the source: marathonSolved
// and marathonWords sit one line apart and are both numbers out of twenty.
// The literal is evaluated against sentinel values that cannot be confused.
{
  const write = (fn.match(/const runRef = db\.collection\("runs"\)\.doc\(`marathon_[\s\S]*?\n {6}\}\);/) || [''])[0];
  ck(write.length > 300, "the marathon run write is findable", String(write.length));
  const lit = write.slice(write.indexOf('tx.set(runRef, ') + 'tx.set(runRef, '.length, write.lastIndexOf(');'));
  const doc = new Function('uid', 'username', 'equipped', 'solved', 'guessNumber', 'g', 'target',
    'buildWordLog', 'week', 'newScore', 'newWordIndex', 'newSolved', 'attempt', 'earned', 'FieldValue',
    `return ${lit};`)('u1', 'ME', {}, true, 2, [0, 1, 0, 0, 0], 'CRANE', () => 'LOG',
    '2026-11-02', 5500, 13, 11, { wordCount: 17 }, 300, { serverTimestamp: () => 'TS' });
  eq('the doc reports the words SOLVED so far', doc.marathonSolved, 11);
  eq('separately from the words finished', doc.marathonWords, 13);
  eq('and the size of the week it belongs to', doc.marathonTotal, 17);
  ck(doc.marathonSolved !== doc.marathonWords,
     '...which is three distinct numbers, not the same one written twice');
}

// ---- the attempt lives under weeks ---------------------------------------
// The rules match marathonAttempts/{uid}/weeks/{week}; a ref still building
// the old months/ path would be a mode where nothing can resume, and the
// rules assertion in marathon.test.mjs would still pass.
{
  const refSrc = (fn.match(/function marathonAttemptRef\(uid, week\) \{\n[\s\S]*?\n\}/) || [''])[0];
  ck(!!refSrc, 'marathonAttemptRef is findable', refSrc.slice(0, 60));
  const path = [];
  const db = { collection: (c) => { path.push(c); return { doc: (d) => { path.push(d); return { collection: db.collection }; } }; } };
  new Function('db', `${refSrc}\nreturn marathonAttemptRef('p1', '2026-11-02');`)(db);
  eq('the attempt path is the one the rules match',
     path.join('/'), 'marathonAttempts/p1/weeks/2026-11-02');
}

// ---- the server actually maintains all four ------------------------------
for (const [field, why] of [
  ['bestMarathonScore', 'the headline and the board'],
  ['bestMarathonWords', 'the furthest-in-a-week line and the finish-a-week challenge'],
  ['bestMarathonWeek', 'the date under the headline'],
  ['marathonWeeks', 'weeks played, and two career challenges'],
  ['marathonWordsTotal', 'the denominator the miss row is derived from'],
  ['marathonScoreTotal', 'the average per week'],
  ['marathonPerfect', 'perfect weeks'],
  ['marathonG1', 'the first bar of the chart'],
  ['marathonG5', 'the last solve bar of the chart'],
]) {
  ck(new RegExp(`update\\.${field} =`).test(fn), `onRunCreated maintains ${field}, for ${why}`,
     (fn.match(new RegExp(`[^\\n]*${field}[^\\n]*`)) || [''])[0].trim());
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
