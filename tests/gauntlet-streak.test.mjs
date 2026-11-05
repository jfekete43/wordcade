/*
 * The Trifecta's clean streak.
 *
 * A SWEEP keeps it: finishing with a word missed is a day played, not a day
 * kept. That is the whole point of having one — a streak you cannot break is
 * a counter, and the Trifecta already has two of those (gauntletPlayed,
 * gauntletPerfect).
 *
 * It exists TWICE, which is the risk worth testing. onRunCreated writes the
 * real numbers; reflectGauntletLocally guesses at them in the client, because
 * the end screen is up inside two seconds and a Firestore trigger is not. Two
 * implementations of one rule is exactly the shape that drifts, so both are
 * lifted here and run over the same days, and the answers must match.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const fn = read('functions/index.js');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };
// The client's own shiftDateStr, so the two sides are compared on the same
// date arithmetic rather than on a reimplementation of it in here.
const shift = new Function('dateStr', 'days',
  `${(html.match(/ {8}function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n {8}\}/) || [''])[0]}\nreturn shiftDateStr(dateStr, days);`);

// ---- the server's, lifted and run -----------------------------------------
const shiftSrc = grab(fn, /function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n\}/, 'shiftDateStr');
const streakSrc = grab(fn, / {4}if \(run\.mode === "daily" && run\.puzzleDate\) \{\n[\s\S]*?\n {4}\}/, 'the streak block');
ck(/isGauntletSweep/.test(streakSrc), 'the server streak turns on a sweep', streakSrc.slice(0, 90));
const server = new Function('user', 'run', 'isGauntletSweep',
  `${shiftSrc}\nconst update = {};\n${streakSrc}\nreturn update;`);
const srv = (user, date, swept) => server(user, { mode: 'daily', puzzleDate: date }, swept);

// ---- the client's, lifted and run -----------------------------------------
const reflectSrc = grab(html, / {8}function reflectGauntletLocally\(attempt\) \{\n[\s\S]*?\n {8}\}/, 'reflectGauntletLocally');
const playedSrc = grab(html, / {8}function dailyPlayedWords\(attempt\) \{\n[\s\S]*?\n {8}\}/, 'dailyPlayedWords');
const client = (profile, date, swept) => {
  const attempt = {
    date,
    // One guessed word per entry; `swept` decides whether they all landed.
    history: [0, 1, 2].map((i) => ({ guesses: ['CRANE'], solved: swept || i < 1 })),
  };
  const run = new Function('userProfileData', 'attempt', 'getTodayDateStr', 'shiftDateStr',
    `${playedSrc}\n${reflectSrc}\nreflectGauntletLocally(attempt);\nreturn userProfileData;`);
  return run(profile, attempt, () => date, shift);
};

// ---- the rule itself ------------------------------------------------------
{
  eq('a first sweep starts the streak at one',
     srv({}, '2026-11-05', true).gauntletStreak, 1);
  eq('and records the best', srv({}, '2026-11-05', true).gauntletBestStreak, 1);
  eq('yesterday swept, today swept, is two',
     srv({ gauntletStreak: 1, gauntletLastDate: '2026-11-04' }, '2026-11-05', true).gauntletStreak, 2);
  eq('a gap of a day starts again at one',
     srv({ gauntletStreak: 9, gauntletLastDate: '2026-11-03' }, '2026-11-05', true).gauntletStreak, 1);
  eq('a day played but not swept resets it',
     srv({ gauntletStreak: 9, gauntletLastDate: '2026-11-04' }, '2026-11-05', false).gauntletStreak, 0);
  // The thing that makes this a streak rather than a counter.
  ck(srv({ gauntletStreak: 9, gauntletLastDate: '2026-11-04' }, '2026-11-05', false).gauntletBestStreak === undefined,
     'and a reset never raises the best');
  eq('the best survives the reset that follows it',
     srv({ gauntletStreak: 3, gauntletBestStreak: 3, gauntletLastDate: '2026-11-04' }, '2026-11-05', false).gauntletBestStreak,
     undefined);
  eq('a worse streak does not lower the best',
     srv({ gauntletStreak: 0, gauntletBestStreak: 9, gauntletLastDate: '2026-11-04' }, '2026-11-05', true).gauntletBestStreak,
     undefined);
  eq('a better one raises it',
     srv({ gauntletStreak: 9, gauntletBestStreak: 9, gauntletLastDate: '2026-11-04' }, '2026-11-05', true).gauntletBestStreak,
     10);
  // Replaying the same day is not a second day. A retried trigger, or a run
  // written twice, must not inflate a streak.
  eq('replaying the same day holds the streak where it is',
     srv({ gauntletStreak: 4, gauntletLastDate: '2026-11-05' }, '2026-11-05', true).gauntletStreak, 4);
  eq('...and does not drop it to one either',
     srv({ gauntletStreak: 4, gauntletLastDate: '2026-11-05' }, '2026-11-05', true).gauntletStreak, 4);
  // Compared against the RUN's date, not today's, so a trigger delivered late
  // cannot break a streak the player kept.
  ck(/shiftDateStr\(run\.puzzleDate, -1\)/.test(streakSrc),
     'the comparison is against the run\'s own date, never the clock', streakSrc.slice(0, 120));
  ck(!/getTodayDateStr\(\)/.test(streakSrc), 'and the clock is not consulted at all');
  eq('every finish stamps the date, swept or not',
     [srv({}, '2026-11-05', true).gauntletLastDate, srv({}, '2026-11-05', false).gauntletLastDate],
     ['2026-11-05', '2026-11-05']);
}

// ---- the two implementations agree ----------------------------------------
// Walked day by day through the same history, one run each per day.
{
  const days = [
    ['2026-11-01', true], ['2026-11-02', true], ['2026-11-03', false],
    ['2026-11-04', true], ['2026-11-06', true], ['2026-11-07', true], ['2026-11-07', true],
  ];
  let s = {}, c = {};
  const seen = [];
  for (const [date, swept] of days) {
    s = { ...s, ...srv(s, date, swept) };
    c = client({ ...c }, date, swept);
    seen.push([date, swept, s.gauntletStreak, c.gauntletStreak]);
    eq(`${date}${swept ? ' swept' : ' missed one'}: client and server agree on the streak`,
       c.gauntletStreak, s.gauntletStreak);
  }
  eq('and on the best, after all of it', c.gauntletBestStreak, s.gauntletBestStreak);
  // Including the two cases a plain increment gets wrong: the day after a gap
  // (server says 1, an incrementing client says 2) and a replay of the same
  // day (server holds, an incrementing client climbs). Both were wrong here
  // until this suite ran them side by side.
  eq('across the whole history, every day agreed',
     seen.filter(([, , a, b]) => a !== b), []);
}

// ---- the client counts a sweep the same way the server does ---------------
{
  eq('three of three swept', client({}, '2026-11-05', true).gauntletPerfect, 1);
  eq('and a miss is not a sweep', client({}, '2026-11-05', false).gauntletPerfect, undefined);
  eq('every finish counts as a Trifecta played',
     [client({}, '2026-11-05', true).gauntletPlayed, client({}, '2026-11-05', false).gauntletPlayed], [1, 1]);
  ck(!/>= *\d/.test(reflectSrc) && !/length === \d/.test(reflectSrc),
     'and the client names no word count of its own either', reflectSrc.slice(0, 200));
}

// ---- the screen says what happened ----------------------------------------
{
  const renderSrc = grab(html, / {8}function renderGauntletStreak\(attempt, alreadyPlayed\) \{\n[\s\S]*?\n {8}\}/, 'renderGauntletStreak');
  const show = (profile, swept, alreadyPlayed) => {
    const el = { style: {}, innerHTML: '' };
    const attempt = { date: '2026-11-05', history: [0, 1, 2].map((i) => ({ guesses: ['X'], solved: swept || i < 1 })) };
    new Function('document', 'userProfileData', 'attempt', 'alreadyPlayed',
      `${playedSrc}\n${renderSrc}\nrenderGauntletStreak(attempt, alreadyPlayed);`)(
      { getElementById: () => el }, profile, attempt, alreadyPlayed);
    return el;
  };
  ck(show({ gauntletStreak: 3 }, true, false).innerHTML.includes('3 day'),
     'a swept run says how long the streak is', show({ gauntletStreak: 3 }, true, false).innerHTML);
  ck(/reset/i.test(show({ gauntletStreak: 0 }, false, false).innerHTML),
     'a missed word says the streak reset, rather than going quiet');
  eq('and a Trifecta reopened later announces nothing',
     show({ gauntletStreak: 3 }, true, true).style.display, 'none');
  eq('nor does a signed-out player get a streak line', show(null, true, false).style.display, 'none');
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
