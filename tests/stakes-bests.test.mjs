/*
 * The one thing allowed to LOWER a player's all-time best.
 *
 * Every other path that writes bestRunScore or periodBestScore is monotonic -
 * onRunCreated, the refreshProfile backfill and backfill-period-best.mjs all
 * compare with > or max() and only ever raise. They were built that way so
 * two of them could run over the same account without clobbering each other,
 * and the consequence is that a value which is too HIGH is permanent.
 *
 * Which it was. Sprint, Marathon and Trifecta runs fed both fields until
 * a2bcfaf, whose own message records what it could not fix: "bestRunScore is
 * an all-time max and does not heal". Worse, refreshProfile's backfill is
 * one-shot behind a bestsBackfilled flag, so an account backfilled before
 * that commit carries a best-of-any-mode score AND a flag saying it has
 * already been repaired - it can never fix itself.
 *
 * So this is the repair, and it is the only code in the project permitted to
 * write a smaller number into those fields. That makes it exactly the thing
 * to test against fixtures rather than against the database: a bug here does
 * not fail loudly, it silently rewrites every player's best score.
 *
 * Four ways it can be wrong:
 *   1. NOT LOWERING a contaminated value - the bug it exists to fix.
 *   2. LOWERING ONE IT SHOULD NOT. A legitimate Stakes best must survive,
 *      and so must a player who has never been contaminated at all.
 *   3. FILING A RUN IN THE WRONG WINDOW. The run's own timestamp decides,
 *      not today - reading "now" instead puts last week's run in this week,
 *      which is the same mistake the Marathon digest made with marathonKey.
 *   4. CHURNING. A second pass over a repaired account must find nothing, or
 *      the tool cannot safely be re-run and cannot be scheduled.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bestsFromRuns, repairFor } from '../tools/stakes-bests.mjs';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// The real rules, lifted the same way the tool lifts them - so this suite
// fails too if the predicate is renamed or its meaning drifts.
const FN = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const lift = (name) => {
  const m = FN.match(new RegExp(`function ${name}\\([^)]*\\) \\{\n[\\s\\S]*?\n\\}`));
  if (!m) throw new Error(`could not lift ${name}() from functions/index.js`);
  return m[0];
};
const PERIOD = (FN.match(/const LEADERBOARD_PERIOD = "(\w+)"/) || [])[1];
ck(!!PERIOD, 'read LEADERBOARD_PERIOD out of functions/index.js', String(PERIOD));
const { isStakesRun, periodKeyFor } = new Function(
  `const LEADERBOARD_PERIOD = ${JSON.stringify(PERIOD)};
   ${lift('etParts')}\n${lift('periodKeyFor')}\n${lift('isStakesRun')}
   return { isStakesRun, periodKeyFor };`)();

const DEL = Symbol('delete');
const ts = (iso) => ({ toDate: () => new Date(iso) });
// 2026-11-18 is a Wednesday; its week opened on Monday the 16th.
const WINDOW = periodKeyFor(new Date('2026-11-18T17:00:00Z'));
ck(WINDOW === (PERIOD === 'monthly' ? '2026-11' : '2026-11-16'),
   'the window under test is the one the game would be in', WINDOW);

const reduce = (runs) => bestsFromRuns(runs, { isStakes: isStakesRun, periodKey: periodKeyFor, window: WINDOW });
const repair = (user, runs) => repairFor(user, reduce(runs), { window: WINDOW, del: DEL });

// A Stakes run is the one with no `mode` at all.
const stakes = (score, iso) => ({ score, timestamp: ts(iso) });
const sprint = (score, iso) => ({ mode: 'sprint', score, timestamp: ts(iso) });
const marathon = (score, iso) => ({ mode: 'marathon', score, timestamp: ts(iso) });
const trifecta = (score, iso) => ({ mode: 'daily', score, timestamp: ts(iso) });

// ---- 1. the contamination it exists to fix -------------------------------
{
  // The shape a pre-a2bcfaf backfill left behind: a Sprint score standing as
  // an all-time Stakes best, with the flag saying it is already repaired.
  const runs = [sprint(500, '2026-11-10T12:00:00Z'), stakes(180, '2026-11-11T12:00:00Z')];
  const r = repair({ bestRunScore: 500, bestsBackfilled: true }, runs);
  ck(!!r, 'a Sprint-seeded all-time best is corrected');
  ck(r && r.change.bestRunScore === 180, 'down to the best real Stakes run', String(r && r.change.bestRunScore));
}
{
  const r = repair({ bestRunScore: 9000 }, [marathon(9000, '2026-11-10T12:00:00Z'), stakes(240, '2026-11-10T13:00:00Z')]);
  ck(r && r.change.bestRunScore === 240, 'a Marathon word is corrected the same way', String(r && r.change.bestRunScore));
}
{
  const r = repair({ bestRunScore: 700 }, [trifecta(700, '2026-11-10T12:00:00Z'), stakes(95, '2026-11-10T13:00:00Z')]);
  ck(r && r.change.bestRunScore === 95, 'and so is a Trifecta', String(r && r.change.bestRunScore));
}
{
  // Nothing but other modes: the fields go away rather than to zero, because
  // the all-time board is an orderBy and excludes documents without them.
  const r = repair({ bestRunScore: 500, bestRunAt: ts('2026-11-10T12:00:00Z') },
                   [sprint(500, '2026-11-10T12:00:00Z'), marathon(300, '2026-11-11T12:00:00Z')]);
  ck(r && r.change.bestRunScore === DEL, 'a player with no Stakes runs has the field removed');
  ck(r && r.change.bestRunAt === DEL, 'and the timestamp with it');
}

// ---- 2. what it must NOT touch -------------------------------------------
{
  const runs = [stakes(1200, '2026-11-10T12:00:00Z'), sprint(500, '2026-11-11T12:00:00Z')];
  ck(repair({ bestRunScore: 1200 }, runs) === null,
     'a legitimate Stakes best is left alone, even with Sprint runs beside it');
}
{
  // Too LOW is not this tool's bug, but it is still a disagreement with the
  // runs, and leaving it would mean the tool cannot report itself clean.
  const r = repair({ bestRunScore: 100 }, [stakes(900, '2026-11-10T12:00:00Z')]);
  ck(r && r.change.bestRunScore === 900, 'a best that is too low is raised to the truth', String(r && r.change.bestRunScore));
}
{
  ck(repair({}, []) === null, 'a player with no runs and no stored best is not touched');
  ck(repair({}, [sprint(500, '2026-11-10T12:00:00Z')]) === null,
     'and nor is a Sprint-only player who never had the field set');
}
{
  // Asked of the KEYS, not of whether there was a change at all: this
  // fixture legitimately has a weekly best to record, and asserting "no
  // change" passed for the wrong reason until it did not.
  const r = repair({ bestRunScore: 300, dayBestScore: 500, dayBestKey: '2026-11-18' },
                   [stakes(300, '2026-11-18T12:00:00Z')]);
  const touched = r ? Object.keys(r.change) : [];
  ck(!touched.some((k) => k.startsWith('dayBest')),
     'dayBestScore is never touched - it was guarded from the start', touched.join(', '));
  ck(!touched.includes('bestRunScore'), 'and a correct all-time best is left alone', touched.join(', '));
}

// ---- 3. which window a run belongs to ------------------------------------
{
  const runs = [stakes(400, '2026-11-10T12:00:00Z'),  // last week
                stakes(150, '2026-11-17T12:00:00Z')]; // this week
  const red = reduce(runs);
  ck(red.best.score === 400, 'the all-time best is the best of all weeks', String(red.best.score));
  ck(red.period.score === 150, "and the window's best is only from this one", String(red.period.score));
}
{
  // The failure this guards: filing by "now" rather than by the run's own
  // timestamp puts a 400 from last week on this week's board.
  const r = repair({ periodBestKey: WINDOW, periodBestScore: 400 },
                   [stakes(400, '2026-11-10T12:00:00Z'), stakes(150, '2026-11-17T12:00:00Z')]);
  ck(r && r.change.periodBestScore === 150, "last week's run does not count in this week", String(r && r.change.periodBestScore));
}
{
  // A stored best from a PREVIOUS window is spent, not wrong: the board
  // filters on periodBestKey so it is already invisible, and rewriting it
  // would be churn on every account that has not played this week.
  ck(repair({ periodBestKey: '2026-11-09', periodBestScore: 800 }, []) === null,
     "a spent window's score is left where it is rather than churned");
}
{
  // The spent-window rule has to IGNORE the old score, not merely decline to
  // rewrite it. Comparing against it instead of against zero looks identical
  // in every case except this one: the scores happen to match, so the tool
  // concludes there is nothing to do and the player's key is never moved
  // into the open window - leaving them invisible on a board they have
  // earned a place on.
  const r = repair({ periodBestKey: '2026-11-09', periodBestScore: 200 },
                   [stakes(200, '2026-11-17T12:00:00Z')]);
  ck(r && r.change.periodBestKey === WINDOW,
     'a new window is opened even when its best happens to equal the last one',
     r ? JSON.stringify(r.change) : '(no change)');
  ck(r && r.change.periodBestScore === 200, 'with the score carried into it', String(r && r.change.periodBestScore));
}
{
  const r = repair({ periodBestKey: WINDOW, periodBestScore: 500 },
                   [sprint(500, '2026-11-17T12:00:00Z')]);
  ck(r && r.change.periodBestScore === DEL, "a Sprint-seeded weekly best is removed from this window");
  ck(r && r.change.periodBestKey === DEL, 'along with its key');
}
{
  const r = repair({}, [stakes(260, '2026-11-17T12:00:00Z')]);
  ck(r && r.change.periodBestScore === 260 && r.change.periodBestKey === WINDOW,
     'a window best that was never recorded gets written', String(r && r.change.periodBestScore));
}
{
  // A run with no timestamp can be ranked all-time but cannot be filed in a
  // window, and must not silently land in the current one.
  const red = reduce([{ score: 700 }]);
  ck(red.best && red.best.score === 700, 'a run with no timestamp still counts all-time');
  ck(red.period === null, 'but is not filed into any window');
}

// ---- 4. idempotence ------------------------------------------------------
{
  const runs = [sprint(500, '2026-11-17T10:00:00Z'), stakes(180, '2026-11-17T12:00:00Z')];
  const before = { bestRunScore: 500, periodBestKey: WINDOW, periodBestScore: 500 };
  const first = repair(before, runs);
  ck(!!first, 'the first pass finds something to do');
  // Defaulted, not reached into: when the first pass finds nothing the check
  // above has already reported it, and dereferencing null here would replace
  // that report with a stack trace and take the rest of the file with it.
  const after = { ...before };
  for (const [k, v] of Object.entries((first && first.change) || {})) {
    if (v === DEL) delete after[k]; else after[k] = v;
  }
  ck(!!first && repair(after, runs) === null, 'and a second pass over the same account finds nothing');
  ck(after.bestRunScore === 180 && after.periodBestScore === 180,
     'with both fields landing on the real Stakes run', JSON.stringify(after));
}

// ---- the tool that uses it -----------------------------------------------
const TOOL = fs.readFileSync(REPO('tools/repair-stakes-bests.mjs'), 'utf8');
ck(/from "\.\/stakes-bests\.mjs"/.test(TOOL), 'the repair tool imports the decision rather than restating it');
ck(/--dry-run/.test(TOOL), 'and offers a dry run');
ck(/\{ merge: true \}/.test(TOOL), 'it writes with set+merge, so a deleted account cannot fail the batch');
// The lift is the whole reason this repair is trustworthy: a third copy of
// the mode rule is what it exists to undo.
ck(!/function isStakesRun/.test(TOOL) && !/mode !== "sprint"/.test(TOOL),
   'and keeps no copy of the mode rule of its own');
const PURE = fs.readFileSync(REPO('tools/stakes-bests.mjs'), 'utf8');
ck(!/mode !== "sprint"/.test(PURE), 'nor does the decision module');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
