/*
 * The recurring leaderboard's window.
 *
 * This board used to be built by downloading EVERY run in the window on every
 * open — no limit, no pagination. Cost is (opens x runs-so-far), so it grows
 * quadratically with the playerbase: fine at 200 players, roughly 250M reads a
 * day at 5,000. It is a denormalised field on the user doc now, like
 * bestRunScore, so it reads 100 documents flat.
 *
 * It also windowed on `new Date()` in the BROWSER, so two players in different
 * timezones were looking at different boards, and neither matched the Gauntlet.
 * The key is Eastern and server-assigned now.
 *
 * The key function exists in three places — functions/index.js writes it,
 * index.html asks for it, tools/backfill-period-best.mjs seeds it — because
 * functions/ is CommonJS and deployed separately. They cannot be imported into
 * one another, so this suite runs all three over the same dates and fails if
 * any disagrees. A drift here shows up as a permanently empty board, which is
 * exactly the kind of thing nobody notices for a week.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// Lift each copy out of its own file and give it the same harness.
//
// Brace-counted, not regex-matched. These three files nest the same function at
// three different depths, so any indentation-based anchor lifts half a function
// from at least one of them — a lazy match stops at the first closing brace that
// happens to be alone on a line, which inside periodKeyFor is the `monthly`
// early return. The functions contain no braces outside balanced template
// literals, so counting is exact here.
const extractFn = (src, name, label) => {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(`${label}: no function ${name}`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`${label}: unbalanced braces in ${name}`);
};

const lift = (src, label) => {
  const body = [extractFn(src, 'etParts', label), extractFn(src, 'periodKeyFor', label)].join('\n');
  // Both functions, whole: a truncated lift would throw at Function() and look
  // like a syntax error rather than a coverage gap.
  if (!/return utc\.toISOString\(\)\.slice\(0, 10\);/.test(body)) throw new Error(`${label}: lift is missing the weekly branch`);
  return new Function('when', 'period', `${body}\nreturn periodKeyFor(when, period);`);
};

const fromFunctions = lift(read('functions/index.js'), 'functions/index.js');
const fromClient = lift(read('index.html'), 'index.html');
const fromBackfill = lift(read('tools/backfill-period-best.mjs'), 'tools/backfill-period-best.mjs');
console.log('lifted periodKeyFor from all three copies');

// --- the three copies must agree -----------------------------------------
// A year of dates at several times of day, including both sides of each DST
// change, so a copy that used a fixed offset instead of the IANA zone fails.
const dates = [];
for (let i = 0; i < 400; i++) {
  for (const hour of [0, 4, 5, 12, 23]) {
    dates.push(new Date(Date.UTC(2026, 0, 1 + i, hour, 30)));
  }
}
for (const period of ['weekly', 'monthly']) {
  const bad = dates.filter((d) => {
    const a = fromFunctions(d, period), b = fromClient(d, period), c = fromBackfill(d, period);
    return !(a === b && b === c);
  });
  ck(bad.length === 0, `all three copies agree on every ${period} key across ${dates.length} timestamps`,
     bad.slice(0, 3).map((d) => `${d.toISOString()}: fn=${fromFunctions(d, period)} client=${fromClient(d, period)} backfill=${fromBackfill(d, period)}`).join(' | '));
}

// --- and all three name the same period ----------------------------------
const period = (src, re) => (src.match(re) || [])[1];
const fnPeriod = period(read('functions/index.js'), /const LEADERBOARD_PERIOD = "([a-z]+)";/);
const clientPeriod = period(read('index.html'), /const LEADERBOARD_PERIOD = "([a-z]+)";/);
ck(fnPeriod === clientPeriod, 'the server and the client agree which period the board uses',
   `functions=${fnPeriod} client=${clientPeriod}`);
ck(['weekly', 'monthly'].includes(fnPeriod), 'and it is a period the key function handles', String(fnPeriod));

// --- weekly behaviour -----------------------------------------------------
const k = (iso, p = 'weekly') => fromFunctions(new Date(iso), p);

ck(k('2026-09-21T12:00:00Z') === '2026-09-21', 'a Monday keys to itself', k('2026-09-21T12:00:00Z'));
ck(k('2026-09-27T12:00:00Z') === '2026-09-21', 'the Sunday after keys to that Monday', k('2026-09-27T12:00:00Z'));
ck(k('2026-09-28T12:00:00Z') === '2026-09-28', 'the next Monday starts a new week', k('2026-09-28T12:00:00Z'));
// The whole point of keying in Eastern: 03:30 UTC Monday is still Sunday night
// in New York, so it belongs to the week that is ending, not the one starting.
ck(k('2026-09-28T03:30:00Z') === '2026-09-21', 'Monday 03:30 UTC is still Sunday in Eastern', k('2026-09-28T03:30:00Z'));
ck(k('2026-09-28T04:30:00Z') === '2026-09-28', 'and 04:30 UTC has crossed midnight there', k('2026-09-28T04:30:00Z'));
// Year boundaries are why this is a Monday's DATE and not an ISO week number:
// week numbering has 53-week years and a week 1 that can start in December.
ck(k('2026-01-01T12:00:00Z') === '2025-12-29', 'a week spanning New Year keys to its December Monday', k('2026-01-01T12:00:00Z'));
ck(k('2027-01-01T12:00:00Z') === '2026-12-28', 'and the same the following year', k('2027-01-01T12:00:00Z'));
ck(!dates.some((d) => /W|week/i.test(k(d.toISOString()))), 'no key is an ISO week number');
// Keys must sort chronologically as plain strings, since that is how they are
// compared and indexed.
const keys = dates.map((d) => k(d.toISOString()));
ck(keys.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)), 'every weekly key is a plain ISO date', keys.find((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x)));
const sorted = [...new Set(keys)].sort();
ck(sorted.every((x, i) => i === 0 || new Date(x) > new Date(sorted[i - 1])), 'and string order is chronological order');
// Exactly 7 days per key, never 6 or 8 — an off-by-one in the Monday maths.
const counts = {};
for (let i = 0; i < 364; i++) {
  const day = k(new Date(Date.UTC(2026, 0, 5 + i, 12, 0)).toISOString());
  counts[day] = (counts[day] || 0) + 1;
}
const sizes = [...new Set(Object.values(counts))];
ck(sizes.length === 1 && sizes[0] === 7, 'every week holds exactly 7 days', JSON.stringify(counts).slice(0, 120));

// --- monthly behaviour, since the constant can be flipped ----------------
ck(k('2026-09-27T12:00:00Z', 'monthly') === '2026-09', 'a monthly key is year-month', k('2026-09-27T12:00:00Z', 'monthly'));
ck(k('2026-10-01T03:30:00Z', 'monthly') === '2026-09', 'and rolls over on Eastern midnight, not UTC', k('2026-10-01T03:30:00Z', 'monthly'));
ck(k('2026-10-01T05:30:00Z', 'monthly') === '2026-10', 'just after which it is the new month', k('2026-10-01T05:30:00Z', 'monthly'));

// --- the write path -------------------------------------------------------
const fn = read('functions/index.js');
const onRun = (fn.match(/exports\.onRunCreated = onDocumentCreated\([\s\S]*?\n\}\);/) || [''])[0];
ck(/update\.periodBestScore = score;/.test(onRun), 'onRunCreated maintains the board field');
ck(/update\.periodBestKey = periodKey;/.test(onRun), 'and stamps which window it belongs to');
// The reset: a best from an EARLIER window must not block this window's first
// score. Without the key check, a player who scored 9,000 last week would need
// to beat 9,000 to appear on this week's board at all.
ck(/user\.periodBestKey === periodKey[\s\S]{0,120}: 0;/.test(onRun),
   'a previous window\'s best does not count against this one', onRun.match(/const priorInWindow[\s\S]*?;/)?.[0]);
ck(/if \(score > priorInWindow\)/.test(onRun), 'and a score only counts if it beats this window\'s');

// --- the read path --------------------------------------------------------
const html = read('index.html');
// Scoped to the BOARD query. Asserting against the whole file passes on the
// identical filter inside renderYourRank, so dropping it here went unnoticed.
const boardQuery = (html.match(/const snapshot = await getDocs\(query\(collection\(db, "users"\),\n[\s\S]*?periodBestScore[\s\S]*?\)\);/) || [''])[0];
ck(boardQuery.length > 0, 'the board query is where it is expected to be', boardQuery.slice(0, 80));
ck(/where\("periodBestKey", "==", periodKeyFor\(new Date\(\)\)\)/.test(boardQuery),
   'the board queries this window', boardQuery);
ck(/orderBy\("periodBestScore", "desc"\), limit\(100\)\)/.test(boardQuery), 'ordered and limited to 100', boardQuery);
// The bug this whole change exists to remove.
ck(!/collection\(db, "runs"\), where\("timestamp", ">=", start\)/.test(html),
   'and no longer downloads every run in the window');
// The definition and the call, not the word: a comment explaining why it went
// away is worth keeping and should not fail this.
ck(!/function fetchUsersByIds/.test(html) && !/await fetchUsersByIds/.test(html),
   'the name-resolution pass is gone with it');
ck(!/seenNames/.test(html), 'and so is the dedup-by-name pass');
ck(!/documentId/.test(html), 'and its now-unused import');
// One row per player is structural now, not patched up afterwards.
ck(/finalData = rawData\.slice\(0, maxLimit\);/.test(html), 'every board slices the same way');
ck(!/maxLimit = \(currentLbTime/.test(html), 'with no per-board row cap', '');

// --- the indexes the queries need ----------------------------------------
const idx = JSON.parse(read('firestore.indexes.json'));
const on = (dir) => idx.indexes.some((i) => i.collectionGroup === 'users'
  && i.fields.length === 2
  && i.fields[0].fieldPath === 'periodBestKey' && i.fields[0].order === 'ASCENDING'
  && i.fields[1].fieldPath === 'periodBestScore' && i.fields[1].order === dir);
ck(on('DESCENDING'), 'there is an index for the board query (key asc, score desc)');
// Firestore serves an index and its exact REVERSE; the reverse of (asc, desc)
// is (desc, asc), which is not the range query "your rank" runs. It needs its own.
ck(on('ASCENDING'), 'and a second for the your-rank range query (key asc, score asc)');

// --- your-rank must not claim a position on a window you are not in ------
const yourRank = (html.match(/async function renderYourRank\([\s\S]*?\n        \}/) || [''])[0];
ck(/weekly: \{ field: "periodBestScore"/.test(yourRank), 'the recurring board has a your-rank entry');
// The comparison itself, not the variable name: `const staleWindow = false;`
// keeps the name and drops the check.
ck(/live\.periodBestKey !== periodKeyFor\(new Date\(\)\)/.test(yourRank),
   'which checks the stored key is this window',
   (yourRank.match(/const staleWindow[^;]*;/) || ['(not found)'])[0]);
ck(/staleWindow\) \{ paint\("#–"/.test(yourRank.replace(/\s+/g, ' ')) || /\|\| staleWindow\)/.test(yourRank),
   'and acts on it rather than computing it and moving on');
ck(/where\("periodBestKey", "==", periodKeyFor\(new Date\(\)\)\), where\(board\.field, ">", mine\)/.test(yourRank),
   'and counts only players inside it');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
