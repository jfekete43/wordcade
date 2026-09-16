/*
 * The Gauntlet placement math behind the "you finished 12th of 47" callout.
 *
 * Why this is worth a test: placement is computed as "count the runs that beat
 * my score, add one" rather than by reading a position off a list, so ties are
 * the thing most likely to be silently wrong — two players on the same score
 * must share a place, and the next player down must skip one. It also has to
 * count only the one Gauntlet being asked about: a stray standard-mode run, or
 * a run from a different puzzle date, must not inflate the field size.
 *
 * Exactness here rests on a property of the data model: a finished Gauntlet is
 * written to runs/daily_{uid}_{date}, a deterministic id, so one player can
 * hold at most one run per puzzle date. The all-time board can't do this — it
 * has to dedup several runs per player first — but a single Gauntlet's board
 * is one row per player by construction.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDoc, query, orderBy, where, getCountFromServer } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const env = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: { rules: fs.readFileSync(REPO('firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const db = env.authenticatedContext('p1').firestore();

// ---- Pull the REAL shipped code out of index.html, don't paraphrase it ----
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const idSrc = html.match(/        function dailyRunId\(uid, dateStr\) \{ return [^\n]*\}/)[0];
const runSrc = html.match(/        async function fetchMyGauntletRun\([\s\S]*?\n        \}/)[0];
const standingSrc = html.match(/        async function fetchGauntletStanding\([\s\S]*?\n        \}/)[0];
console.log('extracted from index.html:', idSrc.length + runSrc.length + standingSrc.length, 'chars');

const build = new Function(
  'db', 'collection', 'doc', 'getDoc', 'query', 'where', 'orderBy', 'getCountFromServer', 'currentUser',
  `${idSrc}\n${runSrc}\n${standingSrc}\nreturn { dailyRunId, fetchMyGauntletRun, fetchGauntletStanding };`
);
const api = (uid) => build(db, collection, doc, getDoc, query, where, orderBy, getCountFromServer, uid ? { uid } : null);

// ---- Seed one Gauntlet, plus noise that must not be counted ----
const DATE = '2026-09-15';
const OTHER_DATE = '2026-09-14';
const field = [
  { uid: 'p1', score: 5000 },
  { uid: 'p2', score: 4000 },
  { uid: 'p3', score: 4000 }, // ties p2
  { uid: 'p4', score: 3000 },
  { uid: 'p5', score: 0 },    // played, scored nothing — still in the field
];
await env.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  for (const p of field) {
    await setDoc(doc(adb, 'runs', `daily_${p.uid}_${DATE}`),
      { uid: p.uid, username: p.uid.toUpperCase(), score: p.score, mode: 'daily', puzzleDate: DATE });
  }
  // Noise 1: a different Gauntlet. Same players, much higher scores.
  await setDoc(doc(adb, 'runs', `daily_p1_${OTHER_DATE}`),
    { uid: 'p1', username: 'P1', score: 99999, mode: 'daily', puzzleDate: OTHER_DATE });
  // Noise 2: a standard-mode run tagged with the same date. Standard runs are
  // endless and routinely outscore a Gauntlet, so if the mode filter were
  // dropped this would take first place and inflate the field.
  await setDoc(doc(adb, 'runs', 'standard_p9_x'),
    { uid: 'p9', username: 'P9', score: 99999, mode: 'standard', puzzleDate: DATE });
});

const t = [];
const eq = (name, got, want) => t.push([JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`]);

const { fetchGauntletStanding, fetchMyGauntletRun, dailyRunId } = api('p1');

eq('deterministic run id', dailyRunId('p1', DATE), `daily_p1_${DATE}`);

// Placement, including the tie.
eq('top score is 1st',            await fetchGauntletStanding(DATE, 5000), { place: 1, total: 5 });
eq('tied score shares 2nd',       await fetchGauntletStanding(DATE, 4000), { place: 2, total: 5 });
eq('after a 2-way tie comes 4th', await fetchGauntletStanding(DATE, 3000), { place: 4, total: 5 });
eq('zero still places last',      await fetchGauntletStanding(DATE, 0),    { place: 5, total: 5 });

// The field size must be this Gauntlet's alone — five players, despite the
// standard-mode run sharing the date and p1 having a second daily run.
eq('other dates and modes excluded', (await fetchGauntletStanding(DATE, 5000)).total, 5);
eq('the other Gauntlet counts only itself', await fetchGauntletStanding(OTHER_DATE, 99999), { place: 1, total: 1 });

// Your own run, by derivable id.
eq('own run found',        (await api('p1').fetchMyGauntletRun(DATE)).score, 5000);
eq('unplayed date is null', await api('p1').fetchMyGauntletRun('2026-09-10'), null);
eq('a player who never played is null', await api('p404').fetchMyGauntletRun(DATE), null);
eq('signed out is null',    await api(null).fetchMyGauntletRun(DATE), null);

// The callout composes these: read your run, then rank that exact score.
const mine = await api('p4').fetchMyGauntletRun(DATE);
eq('end-to-end placement for p4', await fetchGauntletStanding(DATE, mine.score), { place: 4, total: 5 });

await env.cleanup();
let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
