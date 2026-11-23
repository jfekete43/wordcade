/*
 * Past Marathons: the third archive, and the only weekly one.
 *
 * The other two are one query away. A Trifecta and a Sprint write ONE run per
 * player per day, so their board IS the query — ordered by score, capped at a
 * hundred, one row per player by construction. A Marathon writes one run per
 * WORD, twenty of them, and those documents carry no `score` field at all; the
 * running total lives in `marathonScore`. There is nothing to order by that
 * yields one row per player, so the week has to be reduced.
 *
 * Four things are easy to get wrong here and every one of them is silent:
 *
 *   THE SOURCE. /users carries marathonKey and marathonScore, and a query
 *   there would be one read per player instead of one per word. It is also
 *   wrong: that field is the week a player is CURRENTLY on, and onRunCreated
 *   moves it the moment they start the next one. Reading a finished week there
 *   drops exactly the players who came back — the bug 6e62247 fixed in the
 *   Monday digest, which cost somebody a win.
 *
 *   THE REDUCTION. marathonScore is cumulative, so a player's row is their
 *   FURTHEST word. Taking the first, or the highest score, or the last
 *   document the query happened to return, all produce a plausible board.
 *
 *   THE UNIT. The list walks a WEEK at a time. A day-stepped walk over weekly
 *   keys produces six dead entries out of every seven, each of which loads an
 *   empty board.
 *
 *   THE COUNT. The other two archives get a placement from count queries over
 *   /runs. Over a Marathon those count WORDS: a five-player week reports
 *   "4th of 100".
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

// ---- the real shipped code, lifted verbatim -------------------------------
const src = [
  grab(/        function runScore\(r\) \{[^\n]*\}/),
  grab(/        function runClock\(r\) \{\n[\s\S]*?\n        \}/),
  grab(/        function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n        \}/),
  grab(/        function formatPuzzleDate\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        const MARATHON_EPOCH = "[^"]*";/),
  grab(/        function marathonNumber\(weekKey\) \{\n[\s\S]*?\n        \}/),
  grab(/        let marathonWeekCache = \{[^\n]*\};/),
  grab(/        async function marathonWeekRows\(weekKey\) \{\n[\s\S]*?\n        \}/),
  grab(/        const ARCHIVES = \{\n[\s\S]*?\n        \};/),
  grab(/        async function fetchArchiveStanding\(cfg, dateStr, run\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
ck(src.length > 2000, 'lifted the archive code out of index.html', String(src.length));

// Every Firestore name the lifted code mentions. Only getDocs does anything:
// the rest exist so the query builders have something to call, and the count
// helpers so the NON-weekly branch still parses.
function build(docs) {
  const calls = { getDocs: 0, counts: 0, filters: [] };
  const snap = { forEach: (f) => docs.forEach((d) => f({ data: () => d })) };
  const api = {
    getDocs: async () => { calls.getDocs++; return snap; },
    query: (...a) => a,
    collection: (_db, name) => ({ name }),
    where: (f, op, v) => { calls.filters.push(`${f}${op}${v}`); return { f, op, v }; },
    orderBy: (f, d) => ({ f, d }),
    limit: (n) => ({ limit: n }),
    getCountFromServer: async () => { calls.counts++; return { data: () => ({ count: 99 }) }; },
    db: {},
    marathonKeyFor: () => '2026-11-23',
    getTodayDateStr: () => '2026-11-23',
    console: { error: () => {} },
  };
  const keys = Object.keys(api);
  const made = new Function(...keys, `${src}
    return { marathonWeekRows, marathonNumber, ARCHIVES, fetchArchiveStanding,
             reset: () => { marathonWeekCache = { key: null, rows: null }; } };`)
    (...keys.map((k) => api[k]));
  return { ...made, calls };
}

// A week of real shape: one document per word, marathonScore cumulative.
const run = (uid, words, score, extra = {}) => Object.assign(
  { uid, username: uid.toUpperCase(), marathonWords: words, marathonScore: score,
    marathonKey: '2026-11-16' }, extra);

// ---- A. the numbering -----------------------------------------------------
{
  const { marathonNumber } = build([]);
  const epoch = html.match(/const MARATHON_EPOCH = "([^"]*)"/)[1];
  eq('Marathon #1 is the epoch week', marathonNumber(epoch), 1);
  ck(new Date(epoch + 'T00:00:00Z').getUTCDay() === 1,
     'and the epoch is a Monday, which is what periodKeyFor returns', epoch);
  eq('the next Monday is #2', marathonNumber('2026-11-16'), 2);
  eq('and the one after that is #3', marathonNumber('2026-11-23'), 3);
  eq('the week before #1 is not a Marathon', marathonNumber('2026-11-02'), null);
  // A day-stepped walk would hand this function Tuesdays. Returning a number
  // for one would put six dead rows between every pair of real ones.
  eq('a Tuesday is not a Marathon week', marathonNumber('2026-11-17'), null);
  eq('nor a Sunday', marathonNumber('2026-11-22'), null);
  eq('nonsense is not a Marathon week', marathonNumber('banana'), null);
  eq('and neither is nothing at all', marathonNumber(null), null);
}

// ---- B. the reduction -----------------------------------------------------
{
  const a = build([
    run('ann', 1, 500), run('ann', 2, 900), run('ann', 3, 1200),
    run('bob', 1, 400), run('bob', 2, 1500),
  ]);
  const rows = await a.marathonWeekRows('2026-11-16');
  eq('one row per player, not one per word', rows.length, 2);
  eq('each row is that player’s FURTHEST word', rows.map((r) => r.marathonWords), [2, 3]);
  // The furthest word carries the final score, so the leader is the player
  // with the bigger total even though they played fewer words.
  eq('and the score that word carries', rows.map((r) => r.score), [1500, 1200]);
  eq('ordered by score, highest first', rows.map((r) => r.uid), ['bob', 'ann']);
  eq('the row is shaped like a run, so the board can read .score',
     Object.keys(rows[0]).sort(), ['equipped', 'marathonWords', 'score', 'uid', 'username']);
  ck(a.calls.filters.includes('marathonKey==2026-11-16'),
     'filtered on the week the runs BELONG to', JSON.stringify(a.calls.filters));
  ck(!a.calls.filters.some((f) => f.startsWith('mode')),
     'no mode filter: only marathon runs carry marathonKey, so one equality is the whole query',
     JSON.stringify(a.calls.filters));

  // Documents do not arrive in order.
  const b = build([run('ann', 3, 1200), run('ann', 1, 500), run('ann', 2, 900)]);
  const shuffled = await b.marathonWeekRows('2026-11-16');
  eq('order of arrival does not decide the row', shuffled[0].marathonWords, 3);
  eq('...nor the score on it', shuffled[0].score, 1200);

  // A player who stopped at word 1 is still on the board.
  const c = build([run('ann', 20, 9000), run('zoe', 1, 50)]);
  const partial = await c.marathonWeekRows('2026-11-16');
  eq('somebody who played one word still appears', partial.map((r) => r.uid), ['ann', 'zoe']);

  // Ties: same score, further wins; dead level sorts by uid so the board does
  // not reshuffle between two viewers.
  const d = build([run('zoe', 5, 1000), run('ann', 9, 1000), run('mia', 9, 1000)]);
  const tied = await d.marathonWeekRows('2026-11-16');
  eq('a tie on score is broken by words solved', tied[0].uid, 'ann');
  eq('and a dead level tie is stable', tied.map((r) => r.uid), ['ann', 'mia', 'zoe']);

  // Junk in the collection cannot take the board down.
  const e = build([{ uid: null, marathonWords: 3 }, run('ann', 2, 100), { nothing: true }]);
  const clean = await e.marathonWeekRows('2026-11-16');
  eq('a document with no uid is skipped rather than thrown on', clean.length, 1);
  const f = build([run('ann', undefined, undefined)]);
  const missing = await f.marathonWeekRows('2026-11-16');
  eq('missing numbers read as zero, not NaN', [missing[0].score, missing[0].marathonWords], [0, 0]);

  // A finished week cannot change, so it is read once.
  const g = build([run('ann', 2, 100)]);
  await g.marathonWeekRows('2026-11-16');
  await g.marathonWeekRows('2026-11-16');
  eq('a week already fetched is not fetched again', g.calls.getDocs, 1);
  await g.marathonWeekRows('2026-11-09');
  eq('but a different week is', g.calls.getDocs, 2);
}

// ---- C. your placement ----------------------------------------------------
{
  const mk = () => build([
    run('ann', 20, 9000), run('bob', 20, 7000),
    run('cat', 18, 7000), run('dan', 4, 500),
  ]);
  const { ARCHIVES, fetchArchiveStanding } = mk();
  const cfg = ARCHIVES.marathon;
  const place = async (row) => fetchArchiveStanding(cfg, '2026-11-16', row);

  eq('the leader is 1st', (await place({ score: 9000, marathonWords: 20 })).place, 1);
  eq('and the field is PLAYERS, not words',
     (await place({ score: 9000, marathonWords: 20 })).total, 4);
  eq('second place', (await place({ score: 7000, marathonWords: 20 })).place, 2);
  // Same score, fewer words: the board puts them below, so the placement must
  // too. Keying a tie on score alone would call this 2nd as well.
  eq('same score but fewer words is third, as the board shows it',
     (await place({ score: 7000, marathonWords: 18 })).place, 3);
  eq('last', (await place({ score: 500, marathonWords: 4 })).place, 4);

  // Competition ranking: a genuine tie shares a place.
  const dead = build([run('ann', 9, 1000), run('bob', 9, 1000), run('zoe', 1, 10)]);
  const r2 = await dead.fetchArchiveStanding(dead.ARCHIVES.marathon, '2026-11-16',
    { score: 1000, marathonWords: 9 });
  eq('a dead-level tie shares first', r2.place, 1);
  eq('and the field still counts everybody', r2.total, 3);

  // The whole reason for the weekly branch: count queries over /runs count
  // WORDS. A four-player week must not report a field of 99.
  ck(mk().calls.counts === 0, 'no count query is made for a weekly archive');
  const sprintish = mk();
  await sprintish.fetchArchiveStanding(sprintish.ARCHIVES.sprint, '2026-11-16', { score: 1, elapsedMs: 1 });
  ck(sprintish.calls.counts > 0, 'while the daily archives still use them');
}

// ---- D. the config says weekly, and means it ------------------------------
{
  const { ARCHIVES } = build([]);
  const m = ARCHIVES.marathon;
  ck(m, 'there is a marathon archive at all');
  eq('it steps a week at a time', m.step, -7);
  eq('while Sprint steps a day', ARCHIVES.sprint.step, -1);
  eq('and so does the Trifecta', ARCHIVES.daily.step, -1);
  ck(m.weekly === true, 'it is flagged weekly, which is what the branches read');
  ck(!ARCHIVES.sprint.weekly && !ARCHIVES.daily.weekly, 'and the daily ones are not');
  // Null rather than absent: these are the hooks the weekly branches replace,
  // and leaving a working-looking one here would mean a count query over words.
  eq('it offers no run id — a week has twenty runs, not one', m.runId, null);
  eq('and no scoped filter for a count query', m.scoped, null);
  eq('and no tie counter', m.tied, null);
  eq('a week is labelled as a week', m.dateLabel('2026-11-16'), 'Week of Nov 16, 2026');
  eq('a day is still labelled as a day', ARCHIVES.sprint.dateLabel('2026-11-16'), 'Nov 16, 2026');
  eq('rows name the week number', m.name(2), 'Marathon #2');
  eq('and say how far the player got', m.detail({ marathonWords: 13 }), '13 of 20');
  eq('a tie key that matches the sort', m.tieKey({ score: 900, marathonWords: 9 }), '900:9');
  // The first key offered must be a FINISHED week, never the live one. RUN,
  // not matched: the same expression appears in the button's visibility test,
  // so a regex over the file passes with the config's copy deleted. With
  // marathonKeyFor pinned to a Monday, last week is exactly seven days back.
  eq('the list starts at last week', m.firstKey(), '2026-11-16');
  ck(m.firstKey() !== '2026-11-23', 'never at the week still being played', m.firstKey());
  eq('while Sprint starts at yesterday', ARCHIVES.sprint.firstKey(), '2026-11-22');
}

// ---- E. it agrees with the Monday post ------------------------------------
// Two implementations of one reduction. They have drifted before: the digest
// printed zeroes for a whole board when `score` and `marathonScore` came apart.
{
  const server = fn.slice(fn.indexOf('function marathonStandings'),
                          fn.indexOf('function marathonStandings') + 1400);
  ck(/words > prev\.marathonWords/.test(server),
     'the server reduces to the furthest word', (server.match(/[^\n]*prev\.marathonWords[^\n]*/) || [''])[0].trim());
  ck(/words > prev\.marathonWords/.test(html),
     'and so does the client', (html.match(/[^\n]*prev\.marathonWords[^\n]*/) || [''])[0].trim());
  ck(/b\.marathonScore - a\.marathonScore\s*\n\s*\|\| b\.marathonWords - a\.marathonWords/.test(server),
     'the server sorts score, then words');
  ck(/b\.score - a\.score\s*\n\s*\|\| b\.marathonWords - a\.marathonWords/.test(html),
     'the client sorts the same two keys in the same order');
  ck(/a\.uid\.localeCompare\(b\.uid\)/.test(server) && /localeCompare\(String\(b\.uid\)\)/.test(html),
     'and both fall back to uid so neither reshuffles');
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
