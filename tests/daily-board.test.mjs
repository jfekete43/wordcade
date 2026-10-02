/*
 * Today's Standard board, and the history behind it.
 *
 * This replaced a three-line "Live Arcade Feed" of the most recent runs, which
 * at low traffic mostly announced how quiet it was. A board always has
 * something to read, and resetting nightly makes it the most winnable ladder in
 * the game — but only if it is cheap, and the obvious build is not: querying
 * /runs for the day on every page load is the same (opens x runs) shape that
 * made the old Monthly board quadratic.
 *
 * So there are two sources, and the split is the thing to get right:
 *   today — live off /users.dayBestScore, maintained by onRunCreated.
 *   past  — one dailyBoards/{date} document per finished day, because
 *           dayBestScore only ever holds TODAY and is overwritten when
 *           tomorrow's first run lands.
 *
 * A stored day and the live day must agree about what counts, or the same day
 * would look different depending on whether you saw it live or from history.
 * That is most of what this suite checks.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as B from '../tools/daily-board.mjs';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const run = (o) => ({ uid: 'u', username: 'P', score: 100, timestamp: 1000, ...o });

// --- what a day's board contains -----------------------------------------
// The best run is listed FIRST here on purpose. The map is keyed by uid either
// way, so "keep the best" and "keep the last seen" both yield one row per
// player — the only thing that separates them is whether a later, worse run
// overwrites a better one. A fixture with the best run last cannot tell.
let b = B.buildDayBoard('2026-09-29', [
  run({ uid: 'a', username: 'SODA', score: 5100, timestamp: 1000 }),
  run({ uid: 'a', username: 'SODA', score: 4200, timestamp: 2000 }),
  run({ uid: 'b', username: 'RIVAL', score: 3000, timestamp: 1500 }),
]);
ck(b.top.length === 2, 'one row per player, not one per run', JSON.stringify(b.top));
ck(b.top[0].score === 5100, 'and it is that player\'s BEST of the day, not their latest', String(b.top[0].score));
ck(b.top.map((r) => r.place).join() === '1,2', 'places are numbered from 1', JSON.stringify(b.top.map((r) => r.place)));
ck(b.date === '2026-09-29', 'the document names its own day', b.date);

// Gauntlet runs have their own board and a different scale — ten words against
// an endless run. Mixing them would make the number mean two things.
b = B.buildDayBoard('2026-09-29', [
  run({ uid: 'a', username: 'SODA', score: 500 }),
  run({ uid: 'g', username: 'GHOST', score: 99999, mode: 'daily' }),
]);
ck(b.top.length === 1 && b.top[0].name === 'SODA', 'Gauntlet runs are excluded', JSON.stringify(b.top));

// A wipeout scores 0, and onRunCreated only counts a score ABOVE the day's
// prior best — so a 0 never puts anyone on the live board. History has to
// agree or the same day would differ between live and stored.
b = B.buildDayBoard('2026-09-29', [run({ uid: 'z', username: 'ZERO', score: 0 })]);
ck(b.top.length === 0 && b.players === 0, 'a zero-score run puts nobody on the board', JSON.stringify(b));

// Ties: earlier run wins. Any rule would do, but a player can understand this one.
b = B.buildDayBoard('2026-09-29', [
  run({ uid: 'late', username: 'LATE', score: 5000, timestamp: 9000 }),
  run({ uid: 'early', username: 'EARLY', score: 5000, timestamp: 1000 }),
]);
ck(b.top[0].name === 'EARLY', 'a tie goes to whoever got there first', JSON.stringify(b.top));

// And re-hitting your own best later in the day must not move your timestamp
// forward — that would hand the tie-break to someone who got there after you.
// Only a strictly better run replaces the stored one.
b = B.buildDayBoard('2026-09-29', [
  run({ uid: 'a', username: 'FIRST', score: 5000, timestamp: 1000 }),
  run({ uid: 'b', username: 'SECOND', score: 5000, timestamp: 2000 }),
  run({ uid: 'a', username: 'FIRST', score: 5000, timestamp: 3000 }),
]);
ck(b.top[0].name === 'FIRST', 'matching your own best again does not cost you the tie-break', JSON.stringify(b.top));

// Size cap, and `players` counts everyone the board was drawn from rather than
// the rows shown — "3rd of 40" is a different claim to "3rd of 10".
const many = Array.from({ length: 25 }, (_, i) => run({ uid: 'u' + i, username: 'P' + i, score: 100 + i }));
b = B.buildDayBoard('2026-09-29', many);
ck(b.top.length === B.BOARD_SIZE, `the board is capped at ${B.BOARD_SIZE}`, String(b.top.length));
ck(b.players === 25, 'but players counts everyone who qualified', String(b.players));
ck(b.top[0].score === 124, 'and it is the top of the list, not the head of it', String(b.top[0].score));
ck(B.buildDayBoard('2026-09-29', many, 3).top.length === 3, 'the size is overridable');

// Cosmetics ride along so a past day renders like today does; without them
// history would look plainer than the live board and read as broken.
b = B.buildDayBoard('2026-09-29', [run({ uid: 'a', equipped: { banner: 'banner_nero', effect: 'effect_foil' } })]);
ck(b.top[0].equipped && b.top[0].equipped.banner === 'banner_nero', 'equipped is carried into a stored day', JSON.stringify(b.top[0]));
b = B.buildDayBoard('2026-09-29', [run({ uid: 'a' })]);
ck(!('equipped' in b.top[0]), 'and omitted entirely when there is none', JSON.stringify(b.top[0]));

// Junk must not crash a day's build — these documents are client-written.
b = B.buildDayBoard('2026-09-29', [null, undefined, {}, run({ uid: null }), run({ score: 'x' }), run({ uid: 'ok', score: 50 })]);
ck(b.top.length === 1 && b.top[0].uid === 'ok', 'malformed runs are skipped, not fatal', JSON.stringify(b.top));
ck(B.buildDayBoard('2026-09-29', []).top.length === 0, 'an empty day builds an empty board');
for (const bad of ['2026-9-29', 'yesterday', '', null]) {
  let threw = false;
  try { B.buildDayBoard(bad, []); } catch { threw = true; }
  ck(threw, `a malformed day key (${JSON.stringify(bad)}) throws rather than storing under it`);
}

// --- the day key ----------------------------------------------------------
// Eastern, matching getTodayDateStr() and the Gauntlet's rollover. A boundary
// that differed from the Gauntlet's would put "today" in two places at once.
ck(B.dayKeyET(new Date('2026-09-28T03:30:00Z')) === '2026-09-27',
   '03:30 UTC is still the previous day in Eastern', B.dayKeyET(new Date('2026-09-28T03:30:00Z')));
ck(B.dayKeyET(new Date('2026-09-28T04:30:00Z')) === '2026-09-28',
   'and 04:30 UTC has crossed midnight there', B.dayKeyET(new Date('2026-09-28T04:30:00Z')));
// Winter is UTC-5, so the boundary moves by an hour.
ck(B.dayKeyET(new Date('2026-01-15T04:30:00Z')) === '2026-01-14',
   'in winter the same instant is still the previous day', B.dayKeyET(new Date('2026-01-15T04:30:00Z')));

ck(B.shiftDay('2026-10-01', -1) === '2026-09-30', 'stepping back crosses a month', B.shiftDay('2026-10-01', -1));
ck(B.shiftDay('2026-01-01', -1) === '2025-12-31', 'and a year', B.shiftDay('2026-01-01', -1));
ck(B.shiftDay('2026-03-08', -1) === '2026-03-07', 'and a DST change', B.shiftDay('2026-03-08', -1));
ck(B.shiftDay('2026-09-30', 1) === '2026-10-01', 'and forwards');
const days = B.browsableDays('2026-09-30', 3);
ck(days.join() === '2026-09-29,2026-09-28,2026-09-27', 'browsable days are finished days, newest first', days.join());
ck(!days.includes('2026-09-30'), 'today is never in the list — the day is not over');

// Junk timestamps read as absent rather than epoch zero, which would make every
// malformed run look like the earliest of the day and win every tie.
for (const [label, v] of [['a string', '2026-09-01'], ['NaN', NaN], ['an empty object', {}], ['null', null]]) {
  ck(B.toMillis(v) === null, `${label} reads as no timestamp`, String(B.toMillis(v)));
}
ck(B.toMillis(0) === 0, 'but a genuine zero is a timestamp');
ck(B.toMillis({ seconds: 1700000000 }) === 1700000000000, 'a serialized Timestamp is understood');

// --- the client's key must agree with the tool's -------------------------
// Three implementations again: the tool builds the stored day, onRunCreated
// stamps the live one, and the client asks for both. A drift shows up as a
// permanently empty board.
const html = read('index.html');
const clientKey = new Function('today', 'offset', `
  function getTodayDateStr() { return today; }
  ${(html.match(/        function dailyBoardDateKey\(offset\) \{[\s\S]*?\n        \}/) || [''])[0]}
  return dailyBoardDateKey(offset);
`);
const drift = [];
for (const today of ['2026-01-01', '2026-03-08', '2026-09-30', '2026-11-01', '2026-12-31']) {
  for (let off = 0; off <= 7; off++) {
    const mine = off === 0 ? today : B.shiftDay(today, -off);
    if (clientKey(today, off) !== mine) drift.push(`${today}+${off}: client=${clientKey(today, off)} tool=${mine}`);
  }
}
ck(drift.length === 0, 'the client and the tool step through days identically', drift.slice(0, 3).join(' | '));

// --- where the board sits on the Standard screen --------------------------
// Two panels share the space under the keyboard, and which comes first is the
// whole point of each: this screen IS Standard, so the board for the mode you
// are playing leads, and the Gauntlet card below it is a cross-sell to a
// different one. They were the other way round, which put a prompt for
// somewhere else above the thing you had just done.
const boardAt = html.indexOf('<div id="daily-board-container"');
const cardAt = html.indexOf('<div id="gauntlet-card"');
const gFeedAt = html.indexOf('<div id="gauntlet-feed-container"');
ck(boardAt > 0 && cardAt > 0, 'both panels are in the markup', `${boardAt}/${cardAt}`);
ck(boardAt < cardAt, "today's Standard board comes before the Gauntlet card", `board@${boardAt} card@${cardAt}`);
// The Gauntlet board replaces the Standard one in Gauntlet mode, so it belongs
// after both rather than between them.
ck(cardAt < gFeedAt, 'and the Gauntlet board stays after both', `card@${cardAt} feed@${gFeedAt}`);
// Only one of the two boards is ever up; both start hidden and are shown by
// mode. If the Standard board ever shipped hidden by default the home screen
// would just be missing it.
ck(/<div id="gauntlet-feed-container" style="display:none;">/.test(html),
   "the Gauntlet board starts hidden, since Standard is the front door");
ck(/<div id="daily-board-container">\s/.test(html),
   "today's Standard board is not hidden by default");

// --- the write path -------------------------------------------------------
const fn = read('functions/index.js');
const onRun = (fn.match(/exports\.onRunCreated = onDocumentCreated\([\s\S]*?\n\}\);/) || [''])[0];
ck(/update\.dayBestScore = score;/.test(onRun), 'onRunCreated maintains the day field');
ck(/update\.dayBestKey = dayKey;/.test(onRun), 'and stamps which day it belongs to');
ck(/if \(run\.mode !== "daily"\)/.test(onRun), 'Gauntlet runs do not reach it, same as the stored board');
// The reset. Without the key check a player who scored 9,000 yesterday would
// need to beat 9,000 to appear on today's board at all.
ck(/user\.dayBestKey === dayKey[\s\S]{0,120}: 0;/.test(onRun),
   'yesterday\'s best does not count against today', (onRun.match(/const priorToday[\s\S]*?;/) || [''])[0]);
ck(/getTodayDateStr\(\)/.test(onRun), 'and the day is the server\'s Eastern day, not a client clock');

// --- the read path --------------------------------------------------------
const boardQuery = (html.match(/query\(collection\(db, "users"\), where\("dayBestKey"[\s\S]*?limit\(DAILY_BOARD_SIZE\)\)/) || [''])[0];
ck(boardQuery.length > 0, 'today reads /users, not /runs', boardQuery.slice(0, 80));
ck(/orderBy\("dayBestScore", "desc"\)/.test(boardQuery), 'ordered by the denormalised field', boardQuery);
ck(/onSnapshot\(/.test(html.slice(html.indexOf('async function loadDailyBoard'))), 'and listens live, so it still does the feed\'s job');
ck(/getDoc\(doc\(db, "dailyBoards", key\)\)/.test(html), 'a past day is one document read');
// The bug this whole shape avoids.
ck(!/collection\(db, "runs"\), orderBy\("timestamp", "desc"\), limit\(3\)\)/.test(html), 'the old three-run feed query is gone');
ck(!/live-feed/.test(html), 'and every trace of it');
// Player-supplied strings, from a user doc or a stored board.
const rowFn = (html.match(/        function dailyBoardRow\([\s\S]*?\n        \}/) || [''])[0];
ck(/escapeHtml\(/.test(rowFn) && /safeCosmetic\(/.test(rowFn), 'names and cosmetics are sanitised on render', rowFn.slice(0, 60));

// --- the indexes ----------------------------------------------------------
const idx = JSON.parse(read('firestore.indexes.json'));
const on = (dir) => idx.indexes.some((i) => i.collectionGroup === 'users' && i.fields.length === 2
  && i.fields[0].fieldPath === 'dayBestKey' && i.fields[0].order === 'ASCENDING'
  && i.fields[1].fieldPath === 'dayBestScore' && i.fields[1].order === dir);
ck(on('DESCENDING'), 'there is an index for the board query (key asc, score desc)');
// Firestore serves an index and its exact REVERSE; the reverse of (asc, desc)
// is (desc, asc), which is not the range query the your-rank count runs.
ck(on('ASCENDING'), 'and a second for the your-rank range query (key asc, score asc)');

// --- the snapshot job -----------------------------------------------------
const wf = read('.github/workflows/gauntlet-archive.yml');
ck(/node tools\/build-daily-boards\.mjs/.test(wf), 'the daily job snapshots yesterday');
ck(/if: always\(\)/.test(wf.slice(wf.indexOf('Snapshot'))), 'even when the archive build fails');
const builder = read('tools/build-daily-boards.mjs');
ck(/refusing \$\{one\}: that day is not over yet/.test(builder), 'and it refuses to build a day that is not over');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
