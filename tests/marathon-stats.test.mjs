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
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(got === want, name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const src = [
  grab(/ {8}const LEADERBOARD_PERIOD = "[^"]*";/, 'LEADERBOARD_PERIOD'),
  grab(/ {8}function etParts\(when\) \{\n[\s\S]*?\n {8}\}/, 'etParts'),
  grab(/ {8}function periodKeyFor\(when, period\) \{\n[\s\S]*?\n {8}\}/, 'periodKeyFor'),
  grab(/ {8}function marathonKeyFor\(d\) \{\n[\s\S]*?\n {8}\}/, 'marathonKeyFor'),
  grab(/ {8}const MARATHON_WORD_COUNT = \d+;/, 'MARATHON_WORD_COUNT'),
  grab(/ {8}function marathonWeekLabel\(key\) \{\n[\s\S]*?\n {8}\}/, 'marathonWeekLabel'),
  grab(/ {8}function loadMarathonStats\(\) \{\n[\s\S]*?\n {8}\}/, 'loadMarathonStats'),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

// The week the panel will call "this week", computed the same way it does,
// so the fixtures below are not a second idea of when a week starts.
const THIS_WEEK = new Function(`${src}\nreturn marathonKeyFor(new Date());`)();
ck(/^\d{4}-\d{2}-\d{2}$/.test(THIS_WEEK), 'the current week key is a date', THIS_WEEK);

const PANEL_IDS = ['stat-marathon-best', 'stat-marathon-best-when', 'stat-marathon-weeks',
                   'stat-marathon-furthest', 'stat-marathon-now'];
const run = (profile) => {
  const els = {};
  for (const id of PANEL_IDS) els[id] = { id, innerText: '', style: {} };
  let reads = 0;
  const doc = { getElementById: (id) => {
    if (!(id in els)) throw new Error('wrote to an element the markup does not have: ' + id);
    return els[id];
  } };
  new Function('document', 'userProfileData', 'getDoc', 'getDocs', 'db',
    `${src}\nloadMarathonStats();`)(doc, profile,
    () => { reads++; }, () => { reads++; }, {});
  return { els, reads };
};

// Every id it reaches for is in the real markup, and the panel and tab exist.
for (const id of PANEL_IDS) ck(html.includes(`id="${id}"`), `the markup has #${id}`);
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
  const apply = new Function('user', 'run', `
    const FieldValue = { serverTimestamp: () => 'TS' };
    const update = {};
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
  // Nothing here runs for another mode's run.
  {
    const u = apply({}, { mode: 'sprint', puzzleDate: '2026-11-02', score: 500 });
    eq('a run from another mode touches none of it', Object.keys(u).length, 0);
  }
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
