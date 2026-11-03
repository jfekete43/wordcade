/*
 * What the Sprint distribution backfill decides.
 *
 * onRunCreated counts a Sprint into sprintG1..sprintG5 when the run document
 * is created, and only then. Every Sprint played before those counters existed
 * is therefore missing from its player's chart permanently unless something
 * goes back for it — the trigger fires once, and there is no second chance.
 *
 * Two properties carry this, and both are the sort that look fine in a single
 * run and are wrong on the second:
 *
 *   IT IS A TOTAL, NOT AN ADJUSTMENT. The value is recomputed from every run
 *   the player has, so running the backfill twice writes the same numbers, and
 *   running it after the trigger has already counted some of the same runs
 *   still lands on the truth. An incrementing version would be correct exactly
 *   once and wrong every time after — and it would LOOK correct the first
 *   time, which is what makes it worth pinning.
 *
 *   MISSES ARE NOT COUNTED HERE. The chart's X row is derived as played minus
 *   solved. Counting a miss into a guess row as well would put the same miss
 *   on the chart twice.
 *
 * Pure; no emulator, no browser, no Firestore.
 */
import * as D from '../tools/sprint-dist.mjs';

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// A Sprint run carries exactly one 1 across guess1..guess5 on a solve, and all
// zeros on a miss — the shape guessSprintWord writes.
const solve = (uid, n) => ({
  uid, mode: 'sprint',
  guess1: n === 1 ? 1 : 0, guess2: n === 2 ? 1 : 0, guess3: n === 3 ? 1 : 0,
  guess4: n === 4 ? 1 : 0, guess5: n === 5 ? 1 : 0,
});
const miss = (uid) => ({ uid, mode: 'sprint', guess1: 0, guess2: 0, guess3: 0, guess4: 0, guess5: 0 });
const row = (map, uid) => map.get(uid);

// ---- the fold -----------------------------------------------------------------
{
  const m = D.foldSprintRuns([solve('a', 3), solve('a', 3), solve('a', 5), solve('b', 1)]);
  eq('one player\'s solves land on their own rows', row(m, 'a'), [0, 0, 2, 0, 1]);
  eq('and another player is counted separately', row(m, 'b'), [1, 0, 0, 0, 0]);
  eq('with no one else invented', [...m.keys()].sort(), ['a', 'b']);
}
{
  // The X row is played minus solved, computed from counters this never
  // touches. Counting a miss here too would show it twice.
  const m = D.foldSprintRuns([solve('a', 2), miss('a'), miss('a')]);
  eq('a miss contributes to no guess row', row(m, 'a'), [0, 1, 0, 0, 0]);
}
{
  const m = D.foldSprintRuns([miss('a')]);
  eq('a player with nothing but misses folds to an empty row', row(m, 'a'), [0, 0, 0, 0, 0]);
}
{
  eq('no runs is no players', [...D.foldSprintRuns([]).keys()], []);
  eq('and neither is nothing at all', [...D.foldSprintRuns(null).keys()], []);
}
{
  // The uid lives on the run document, so a run without one is malformed
  // rather than belonging to a departed player — there is nobody to credit.
  const m = D.foldSprintRuns([solve(null, 2), solve(undefined, 3), { mode: 'sprint' }, solve('a', 1)]);
  eq('a run with no uid is dropped rather than collected under a blank key',
     [...m.keys()], ['a']);
}
{
  // These come off a client-written document. A fractional or negative value
  // would otherwise be written straight into a career counter.
  const m = D.foldSprintRuns([{ uid: 'a', guess1: 2.7, guess2: -5, guess3: 'x', guess4: NaN, guess5: 1 }]);
  eq('junk in the run document does not become junk in the counter', row(m, 'a'), [2, 0, 0, 0, 1]);
}

// ---- it is a total, not an adjustment -----------------------------------------
{
  const runs = [solve('a', 4), solve('a', 2)];
  const first = D.foldSprintRuns(runs);
  const second = D.foldSprintRuns(runs);
  eq('folding the same runs twice gives the same answer', row(second, 'a'), row(first, 'a'));
  // The stored value is irrelevant to what gets computed — that is what makes
  // a second run, or a run after the trigger has counted the same runs, safe.
  ck(D.sprintRowMatches({ sprintG2: 1, sprintG4: 1 }, row(first, 'a')),
     'and a player already holding that total is recognised as needing no write');
  ck(!D.sprintRowMatches({ sprintG2: 2, sprintG4: 1 }, row(first, 'a')),
     'while a different stored total does need one');
  ck(!D.sprintRowMatches({}, row(first, 'a')),
     'as does a player with no counters at all, which is the whole backfill');
  ck(D.sprintRowMatches({}, [0, 0, 0, 0, 0]),
     'but an empty row against no counters is already correct and is left alone');
}

// ---- the payload ---------------------------------------------------------------
{
  const update = D.sprintRowUpdate([1, 0, 3, 0, 2]);
  eq('the update names every row, including the zeros',
     update, { sprintG1: 1, sprintG2: 0, sprintG3: 3, sprintG4: 0, sprintG5: 2 });
  // Writing only the non-zero rows would leave a stale count behind on a row
  // that has since gone to zero, which can happen if a run is deleted.
  eq('so a row that should now be zero is actually set to zero',
     Object.keys(update).length, 5);
  ck(!Object.keys(update).some((k) => !/^sprintG[1-5]$/.test(k)),
     'and nothing else on the user document is touched', Object.keys(update).join(','));
}

// ---- the script wires it up rather than reimplementing it ----------------------
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const script = fs.readFileSync(REPO('tools/backfill-sprint-dist.mjs'), 'utf8');
ck(/from "\.\/sprint-dist\.mjs"/.test(script), 'the backfill imports the decision module');
ck(/foldSprintRuns\(/.test(script), 'and folds with it rather than looping itself');
ck(/where\("mode", "==", "sprint"\)/.test(script), 'reading only Sprint runs');
ck(/--dry-run/.test(script) && /if \(DRY\)|DRY \?|!DRY/.test(script),
   'with a dry run, like every other tool here that writes');
// An increment would be correct once and wrong on every later run.
ck(!/FieldValue\.increment/.test(script), 'and it sets rather than increments');
// sprintPlayed/sprintSolved are already right; recomputing them from /runs
// could only lower a genuine career total if a run were ever deleted.
ck(!/sprintPlayed|sprintSolved/.test(script.replace(/^[\s\S]*?\*\//, '')),
   'it does not touch the counters that are already correct');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
