/*
 * The denormalised per-player bests, and the boards now built on them.
 *
 * All Time and the Trifecta tab used to scan /runs and then collapse rows by
 * display name down to one per player. That is what produced the "SODA three
 * times" bug, and it also made an exact rank impossible — counting the runs
 * above you overcounts anyone holding several good runs. Both boards now read
 * /users ordered by a stored best, so one row per player is a property of the
 * query rather than something patched up afterwards.
 *
 * Two halves:
 *   1. onRunCreated's maintenance of bestRunScore / bestGauntletScore, run as
 *      the real extracted source against fake run/user pairs.
 *   2. The boards and the exact rank count, against the emulator.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDocs, query, orderBy, limit, where, getCountFromServer } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ===== 1. the trigger's bookkeeping, straight out of functions/index.js =====
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const bestsSrc = fn.match(/    if \(isStakesRun\(run\) && score > Math\.max\(0, Number\(user\.bestRunScore\)[\s\S]*?bestGauntletDate = run\.puzzleDate;\n    \}/)[0];
// The predicate comes along, not a stub of it: which modes belong on a
// Stakes board is the thing under test below, and a stub would only prove
// this file can spell its own answer.
const stakesSrc = fn.match(/function isStakesRun\(run\) \{\n[\s\S]*?\n\}/)[0];
console.log('extracted from functions/index.js:', bestsSrc.length + stakesSrc.length, 'chars');
const SENTINEL = '<serverTimestamp>';
const applyBests = new Function('score', 'user', 'run', 'FieldValue',
  `${stakesSrc}\nconst update = {};\n${bestsSrc}\nreturn update;`);
const bests = (score, user, run) => applyBests(score, user, run, { serverTimestamp: () => SENTINEL });

const TS = { seconds: 1 };
eq('a first run sets the all-time best',
   bests(500, {}, { mode: 'standard', timestamp: TS }), { bestRunScore: 500, bestRunAt: TS });
eq('a worse run leaves it alone',
   bests(400, { bestRunScore: 500 }, { mode: 'standard', timestamp: TS }), {});
eq('an equal run leaves it alone (no pointless write)',
   bests(500, { bestRunScore: 500 }, { mode: 'standard', timestamp: TS }), {});
eq('a better run replaces it',
   bests(900, { bestRunScore: 500 }, { mode: 'standard', timestamp: TS }), { bestRunScore: 900, bestRunAt: TS });
eq('a run with no timestamp falls back to the server clock',
   bests(900, {}, { mode: 'standard' }), { bestRunScore: 900, bestRunAt: SENTINEL });

eq('a Trifecta run sets its OWN best and records its puzzle, not the Stakes one',
   bests(3000, {}, { mode: 'daily', puzzleDate: '2026-09-15', timestamp: TS }),
   { bestGauntletScore: 3000, bestGauntletDate: '2026-09-15' });
eq('a standard run never touches the Trifecta best',
   bests(9000, { bestGauntletScore: 3000 }, { mode: 'standard', timestamp: TS }),
   { bestRunScore: 9000, bestRunAt: TS });
// A Trifecta is capped well below what an endless run can reach, so this is
// the ordinary case once a player has any standard run at all.
eq('a Trifecta best can advance while the all-time best does not',
   bests(3500, { bestRunScore: 9000, bestGauntletScore: 3000 }, { mode: 'daily', puzzleDate: '2026-09-16', timestamp: TS }),
   { bestGauntletScore: 3500, bestGauntletDate: '2026-09-16' });
eq('a daily run with no puzzleDate counts as neither',
   bests(3000, {}, { mode: 'daily', timestamp: TS }), {});
eq('a corrupt stored best is treated as zero, not NaN',
   bests(100, { bestRunScore: 'nonsense' }, { mode: 'standard', timestamp: TS }), { bestRunScore: 100, bestRunAt: TS });
eq('a negative stored best cannot block a real score',
   bests(100, { bestRunScore: -5 }, { mode: 'standard', timestamp: TS }), { bestRunScore: 100, bestRunAt: TS });

// ===== 2. the boards, against the emulator =================================
const env = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: { rules: fs.readFileSync(REPO('firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const db = env.authenticatedContext('me').firestore();

await env.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.firestore();
  const seed = [
    ['u1', 'VORTEX', 18400, 4250, '2026-09-10'],
    ['u2', 'TWIN',   15100, 3900, '2026-09-11'],
    // A DIFFERENT player who happens to display the same handle. On the old
    // dedup-by-name pipeline exactly one of these two vanished.
    ['u3', 'TWIN',   12750, 3900, '2026-09-12'],
    ['me', 'JFEKETE', 9000, 3250, '2026-09-13'],
    ['u5', 'PIXEL',    500,  400, '2026-09-14'],
  ];
  for (const [uid, username, best, gBest, gDate] of seed) {
    await setDoc(doc(s, 'users', uid), {
      username, equipped: { banner: 'banner_default', effect: 'effect_none' },
      bestRunScore: best, bestGauntletScore: gBest, bestGauntletDate: gDate, mmr: 1000,
    });
  }
  // A player who has never finished a run. An unset best must keep them off
  // the board entirely rather than seating them at zero.
  await setDoc(doc(s, 'users', 'u6'), { username: 'NEWBIE', mmr: 1000 });
});

const board = async (field) => {
  const snap = await getDocs(query(collection(db, 'users'), orderBy(field, 'desc'), limit(100)));
  const rows = [];
  snap.forEach((d) => rows.push({ uid: d.id, name: d.data().username, score: d.data()[field] }));
  return rows;
};

const allTime = await board('bestRunScore');
eq('All Time is ordered by each player\'s best run',
   allTime.map((r) => r.name), ['VORTEX', 'TWIN', 'TWIN', 'JFEKETE', 'PIXEL']);
ck(allTime.filter((r) => r.name === 'TWIN').length === 2,
   'two different players sharing a handle BOTH appear (the old dedup dropped one)');
ck(new Set(allTime.map((r) => r.uid)).size === allTime.length,
   'every row is a distinct player, with no dedup pass at all');
ck(!allTime.some((r) => r.uid === 'u6'),
   'a player with no runs is absent rather than seated at zero');

const gauntlet = await board('bestGauntletScore');
eq('the Trifecta tab is each player\'s best Trifecta ever',
   gauntlet.map((r) => r.score), [4250, 3900, 3900, 3250, 400]);

// Exact rank: count the players above you, add one. Ties share a place.
const rankIn = async (field, mine) => {
  const ahead = await getCountFromServer(query(collection(db, 'users'), where(field, '>', mine)));
  return ahead.data().count + 1;
};
eq('rank on All Time is exact', await rankIn('bestRunScore', 9000), 4);
eq('the top score ranks 1st', await rankIn('bestRunScore', 18400), 1);
eq('a score below everyone ranks last', await rankIn('bestRunScore', 1), 6);
eq('tied Trifecta scores share a place', await rankIn('bestGauntletScore', 3900), 2);
eq('and the next score down skips one', await rankIn('bestGauntletScore', 3250), 4);
// The rank a player sees must be the row they see on the board above it.
const meRow = allTime.findIndex((r) => r.uid === 'me') + 1;
eq('the counted rank matches the rendered row', await rankIn('bestRunScore', 9000), meRow);

await env.cleanup();
let bad = 0;
// ---- which runs belong on a Stakes board -----------------------------------
// Stakes is the endless run, the only mode with no ceiling on a score - and
// the only one that writes a run with no `mode` field at all. The other three
// each have their own board on their own scale, and were feeding this one:
// a Sprint caps at 500, and a Marathon document is a SINGLE WORD's payout.
//
// dayBestScore had excluded them since it was written. bestRunScore and
// periodBestScore never did, so the Stakes all-time board quietly carried
// Sprint-sized rows, and the weekly board - whose floor drops back to zero
// every Monday - was topped by them.
{
  const TS2 = { seconds: 2 };
  // A real Stakes run: saveRunToCloud writes no mode at all.
  eq('a Stakes run has no mode, and counts',
     bests(900, {}, { timestamp: TS2 }), { bestRunScore: 900, bestRunAt: TS2 });
  for (const mode of ['sprint', 'marathon', 'daily']) {
    const got = bests(900, {}, { mode, timestamp: TS2 });
    ck(got.bestRunScore === undefined,
       `a ${mode} run does not become a Stakes all-time best`, JSON.stringify(got));
  }
  // The one that actually showed: a Sprint tops out at 500, which is nothing
  // against a real Stakes run but wins a week in which nobody played Stakes.
  ck(bests(250, {}, { mode: 'sprint', timestamp: TS2 }).bestRunScore === undefined,
     'and a 250 Sprint cannot take the Stakes board from an empty week',
     JSON.stringify(bests(250, {}, { mode: 'sprint', timestamp: TS2 })));
  // The Daily Puzzle keeps its OWN best, which is a separate field and must
  // not have been collateral.
  eq('a daily run still sets its own best, which was never the problem',
     bests(900, {}, { mode: 'daily', puzzleDate: '2026-11-16', timestamp: TS2 }),
     { bestGauntletScore: 900, bestGauntletDate: '2026-11-16' });

  // The three fields ask one question, so they cannot drift apart again.
const stakesSites = [
  [/if \(isStakesRun\(run\) && score > Math\.max\(0, Number\(user\.bestRunScore\)/, 'the all-time best'],
  [/if \(isStakesRun\(run\) && score > priorInWindow\)/, "the week's best"],
  [/if \(isStakesRun\(run\)\) \{\n      const dayKey/, "today's best"],
];
for (const [re, what] of stakesSites) {
  ck(re.test(fn), `${what} is guarded by isStakesRun`, String(re));
}
}

for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
