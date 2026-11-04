/*
 * The Trifecta placement math behind the "you finished 12th of 47" callout.
 *
 * Why this is worth a test: placement is computed by COUNTING rather than by
 * reading a position off a list, so ties are the thing most likely to be
 * silently wrong. It is now two counts, not one — a better score, plus the same
 * score with more words solved — because the board breaks ties on words solved
 * and a placement that disagreed with the board it sits under is worse than no
 * placement at all. It also has to
 * count only the one Trifecta being asked about: a stray standard-mode run, or
 * a run from a different puzzle date, must not inflate the field size.
 *
 * Exactness here rests on a property of the data model: a finished Trifecta is
 * written to runs/daily_{uid}_{date}, a deterministic id, so one player can
 * hold at most one run per puzzle date. The all-time board can't do this — it
 * has to dedup several runs per player first — but a single Trifecta's board
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
// The counting is one function parameterised by the mode's own tiebreak now,
// so the table comes with it. Nothing in ARCHIVES runs at definition time —
// every Firestore call is inside an arrow body — so the formatting helpers it
// mentions but never reaches here do not need lifting.
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };
const src = [
  grab(/        function dailyRunId\(uid, dateStr\) \{ return [^\n]*\}/, 'dailyRunId'),
  grab(/        function runScore\(r\) \{[^\n]*\}/, 'runScore'),
  grab(/        function runClock\(r\) \{\n[\s\S]*?\n        \}/, 'runClock'),
  grab(/        const ARCHIVES = \{\n[\s\S]*?\n        \};/, 'ARCHIVES'),
  grab(/        async function fetchMyArchiveRun\([\s\S]*?\n        \}/, 'fetchMyArchiveRun'),
  grab(/        function fetchMyGauntletRun\(dateStr\) \{[^\n]*\}/, 'fetchMyGauntletRun'),
  grab(/        async function fetchArchiveStanding\([\s\S]*?\n        \}/, 'fetchArchiveStanding'),
  grab(/        function fetchGauntletStanding\(dateStr, myScore, mySolved\) \{\n[\s\S]*?\n        \}/, 'fetchGauntletStanding'),
].join('\n');
console.log('extracted from index.html:', src.length, 'chars');

const build = new Function(
  'db', 'collection', 'doc', 'getDoc', 'query', 'where', 'orderBy', 'getCountFromServer', 'currentUser',
  `${src}\nreturn { dailyRunId, fetchMyGauntletRun, fetchMyArchiveRun, fetchGauntletStanding, fetchArchiveStanding, ARCHIVES };`
);
const api = (uid) => build(db, collection, doc, getDoc, query, where, orderBy, getCountFromServer, uid ? { uid } : null);

// ---- Seed one Trifecta, plus noise that must not be counted ----
const DATE = '2026-09-15';
const OTHER_DATE = '2026-09-14';
// Scores chosen so every tie case is reachable: p2/p3 tie on score and split on
// words solved, p6/p7 tie on BOTH and must share a place.
const field = [
  { uid: 'p1', score: 5000, wordsGuessed: 10 },
  { uid: 'p2', score: 4000, wordsGuessed: 9 },
  { uid: 'p3', score: 4000, wordsGuessed: 7 },  // same score as p2, fewer words
  { uid: 'p4', score: 3000, wordsGuessed: 8 },
  { uid: 'p5', score: 0, wordsGuessed: 0 },     // played, scored nothing — still in the field
  { uid: 'p6', score: 2000, wordsGuessed: 6 },
  { uid: 'p7', score: 2000, wordsGuessed: 6 },  // identical to p6 on both fields
];
await env.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  for (const p of field) {
    await setDoc(doc(adb, 'runs', `daily_${p.uid}_${DATE}`),
      { uid: p.uid, username: p.uid.toUpperCase(), score: p.score, wordsGuessed: p.wordsGuessed, mode: 'daily', puzzleDate: DATE });
  }
  // Noise 1: a different Trifecta. Same players, much higher scores.
  await setDoc(doc(adb, 'runs', `daily_p1_${OTHER_DATE}`),
    { uid: 'p1', username: 'P1', score: 99999, mode: 'daily', puzzleDate: OTHER_DATE });
  // Noise 2: a standard-mode run tagged with the same date. Standard runs are
  // endless and routinely outscore a Trifecta, so if the mode filter were
  // dropped this would take first place and inflate the field.
  await setDoc(doc(adb, 'runs', 'standard_p9_x'),
    { uid: 'p9', username: 'P9', score: 99999, mode: 'standard', puzzleDate: DATE });
});

const t = [];
const eq = (name, got, want) => t.push([JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`]);

const { fetchGauntletStanding, fetchArchiveStanding, fetchMyArchiveRun, fetchMyGauntletRun, dailyRunId, ARCHIVES } = api('p1');

eq('deterministic run id', dailyRunId('p1', DATE), `daily_p1_${DATE}`);

// Placement. Order is p1(5000/10), p2(4000/9), p3(4000/7), p4(3000/8),
// p6(2000/6), p7(2000/6), p5(0/0).
const N = field.length;
eq('top score is 1st',               await fetchGauntletStanding(DATE, 5000, 10), { place: 1, total: N });
eq('equal score, more words, is 2nd', await fetchGauntletStanding(DATE, 4000, 9),  { place: 2, total: N });
eq('equal score, fewer words, is 3rd — not a shared 2nd',
                                      await fetchGauntletStanding(DATE, 4000, 7),  { place: 3, total: N });
eq('the next score down takes 4th, nothing skipped',
                                      await fetchGauntletStanding(DATE, 3000, 8),  { place: 4, total: N });
eq('equal on BOTH fields shares a place', await fetchGauntletStanding(DATE, 2000, 6), { place: 5, total: N });
eq('zero still places last',          await fetchGauntletStanding(DATE, 0, 0),     { place: 7, total: N });

// A run that beats everyone tied with it on words solved, without matching any
// stored row — the count has to come from the comparison, not from a lookup.
eq('more words than anyone on that score is ahead of all of them',
   await fetchGauntletStanding(DATE, 4000, 10), { place: 2, total: N });
eq('fewer words than everyone on that score is behind all of them',
   await fetchGauntletStanding(DATE, 4000, 0), { place: 4, total: N });

// Words solved must NOT leak across scores: a 3000 with ten words is still
// behind both 4000s, however many words they solved.
eq('words solved never beats a higher score',
   await fetchGauntletStanding(DATE, 3000, 10), { place: 4, total: N });

// A caller that forgets the third argument must not silently promote itself
// above everyone tied with it — zero words is the safe floor, not "ignore ties".
eq('omitting the solved count places you below every tie, not above',
   await fetchGauntletStanding(DATE, 4000), { place: 4, total: N });

// The field size must be this Trifecta's alone, despite the standard-mode run
// sharing the date and p1 having a second daily run.
eq('other dates and modes excluded', (await fetchGauntletStanding(DATE, 5000, 10)).total, N);
eq('the other Trifecta counts only itself', await fetchGauntletStanding(OTHER_DATE, 99999, 10), { place: 1, total: 1 });

// Your own run, by derivable id.
eq('own run found',        (await api('p1').fetchMyGauntletRun(DATE)).score, 5000);
eq('unplayed date is null', await api('p1').fetchMyGauntletRun('2026-09-10'), null);
eq('a player who never played is null', await api('p404').fetchMyGauntletRun(DATE), null);
eq('signed out is null',    await api(null).fetchMyGauntletRun(DATE), null);

// The callout composes these: read your run, then rank that exact score.
const mine = await api('p4').fetchMyGauntletRun(DATE);
eq('end-to-end placement for p4', await fetchGauntletStanding(DATE, mine.score, mine.wordsGuessed), { place: 4, total: N });

// Legacy rows: a Trifecta played before the tiebreak existed has no
// wordsGuessed on its run document. Firestore's range filter skips documents
// missing the field, so those rows can never be counted as "tied and ahead" —
// they must still be counted in the field size, and still beatable on score.
const LEGACY = '2026-09-13';
await env.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  for (const [uid, score] of [['q1', 3000], ['q2', 3000], ['q3', 1000]]) {
    await setDoc(doc(adb, 'runs', `daily_${uid}_${LEGACY}`),
      { uid, username: uid.toUpperCase(), score, mode: 'daily', puzzleDate: LEGACY });
  }
});
eq('a legacy day still counts everyone in the field',
   (await fetchGauntletStanding(LEGACY, 3000, 5)).total, 3);
eq('legacy rows with no wordsGuessed never count as tied-and-ahead',
   await fetchGauntletStanding(LEGACY, 3000, 5), { place: 1, total: 3 });
eq('and a lower score is still behind them',
   await fetchGauntletStanding(LEGACY, 1000, 10), { place: 3, total: 3 });

// ---- the same counting for Sprint, against a real Firestore -------------
// Sprint's tiebreak runs the other way: the clock, lowest first. Two failure
// modes are worth proving from this direction - a SLOWER clock on the same
// score must not share the faster player's place, and a run with no clock at
// all (an unsolved Sprint stores elapsedMs as null) must not be counted as
// the fastest on the board, which is what Number(null) === 0 would do.
const SDATE = '2026-11-03';
const sfield = [
  { uid: 's1', score: 500, elapsedMs: 9000 },
  { uid: 's2', score: 250, elapsedMs: 15000 },
  { uid: 's3', score: 250, elapsedMs: 15000 },   // identical to s2 on both
  { uid: 's4', score: 250, elapsedMs: 40000 },   // same score, slower clock
  { uid: 's5', score: 0, elapsedMs: null },      // played, never solved it
];
await env.withSecurityRulesDisabled(async (ctx) => {
  const adb = ctx.firestore();
  for (const p of sfield) {
    await setDoc(doc(adb, 'runs', `sprint_${p.uid}_${SDATE}`),
      { uid: p.uid, username: p.uid.toUpperCase(), score: p.score, wordsGuessed: p.score ? 1 : 0,
        elapsedMs: p.elapsedMs, mode: 'sprint', puzzleDate: SDATE });
  }
  // Noise: the same date's Trifecta. A Trifecta outscores a Sprint three to
  // one, so a dropped mode filter would put it first and inflate the field.
  await setDoc(doc(adb, 'runs', `daily_s9_${SDATE}`),
    { uid: 's9', username: 'S9', score: 1500, wordsGuessed: 3, mode: 'daily', puzzleDate: SDATE });
});

const SN = sfield.length;
const sp = (score, elapsedMs) => fetchArchiveStanding(ARCHIVES.sprint, SDATE, { score, elapsedMs });
eq('sprint: the best score is 1st',                 await sp(500, 9000),   { place: 1, total: SN });
eq('sprint: equal score, faster clock, is 2nd',     await sp(250, 15000),  { place: 2, total: SN });
eq('sprint: equal score, slower clock, is 4th — not a shared 2nd',
                                                    await sp(250, 40000),  { place: 4, total: SN });
eq('sprint: faster than everyone on that score is ahead of all of them',
                                                    await sp(250, 1),      { place: 2, total: SN });
eq('sprint: slower than everyone on that score is behind all of them',
                                                    await sp(250, 999999), { place: 5, total: SN });
eq('sprint: an unsolved run has no clock and still places last',
                                                    await sp(0, null),     { place: 5, total: SN });
// The mirror of the Trifecta's "words never beat a higher score": a clock of
// one millisecond is still behind a better score, however fast it is.
eq('sprint: the clock never beats a better score',  await sp(250, 1),      { place: 2, total: SN });
eq('sprint: the Trifecta on the same date is not in this field',
   (await sp(500, 9000)).total, SN);

eq('sprint: own run found by its derivable id',
   (await api('s1').fetchMyArchiveRun(ARCHIVES.sprint, SDATE)).score, 500);
eq('sprint: a player who never played it is null',
   await api('s404').fetchMyArchiveRun(ARCHIVES.sprint, SDATE), null);
eq('sprint: signed out is null',
   await api(null).fetchMyArchiveRun(ARCHIVES.sprint, SDATE), null);
// The two archives must not read each other's runs: the ids differ by prefix
// and nothing else, so a wrong prefix finds a real run for the wrong mode.
eq('sprint: the Trifecta lookup does not find a Sprint run',
   await api('s1').fetchMyGauntletRun(SDATE), null);

await env.cleanup();
let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
