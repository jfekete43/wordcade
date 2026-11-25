/*
 * The report that answers "which day was that, and who else played it".
 *
 * void-sprint-run.mjs has always stamped voidedAt and voidedReason on the run
 * it zeroes. Nothing read them back, so finding the day a void happened on
 * meant already knowing it.
 *
 * What is pinned here is the ORDER and the two readings a moderation call
 * would rest on, because a tool that sorts wrongly is worse than no tool:
 * it answers confidently.
 *
 * The trap this file exists for: elapsedMs is 0 for a first-guess solve,
 * because the clock starts ON the first guess. 0 is falsy, so `|| Infinity`
 * sends the fastest possible run to the back of the tie it just won. The
 * Sprint board shipped that exact mistake once already, in a different
 * spelling - it tested elapsedMs for truthiness and rendered every 500 with
 * no clock at all.
 *
 * Pure; no emulator, no browser, no Firestore. The tool's Firestore half is
 * behind an import.meta.url guard, so importing it runs nothing.
 */
import { when, secs, guesses, sortRuns, parseArgs } from '../tools/voided-runs.mjs';

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ---- the clock ------------------------------------------------------------
eq('a first-guess solve reads 0.0s, not a dash', secs(0), '0.0s');
eq('a normal solve reads its seconds', secs(8400), '8.4s');
eq('an unsolved run has no clock', secs(null), '—');
eq('and neither does a missing one', secs(undefined), '—');

// ---- the guess count ------------------------------------------------------
eq('one guess', guesses({ guess1: 1 }), '1');
eq('four guesses', guesses({ guess4: 1 }), '4');
eq('a voided run has an empty histogram', guesses({ guess1: 0, guess2: 0 }), '—');
eq('and so does an unsolved one', guesses({ fails: 1 }), '—');

// ---- the order, which is the whole point ----------------------------------
{
  // Two 500s. Both solved on the first guess, so both clocks read 0 - the
  // tie-break has nothing to separate them and must not invent an order by
  // treating 0 as absent.
  const rows = [
    { username: 'SLOW',    score: 420, elapsedMs: 31000, guess3: 1 },
    { username: 'PERFECT', score: 500, elapsedMs: 0,     guess1: 1 },
    { username: 'QUICK',   score: 480, elapsedMs: 4200,  guess2: 1 },
    { username: 'VOIDED',  score: 0,   elapsedMs: null,  voidedAt: {} },
    { username: 'FAILED',  score: 0,   elapsedMs: null,  fails: 1 },
  ];
  eq('best score first, voided and failed at the bottom',
     sortRuns(rows).map((r) => r.username),
     ['PERFECT', 'QUICK', 'SLOW', 'VOIDED', 'FAILED']);
  // The mutation this is really guarding: `|| Infinity` instead of `??`.
  const tie = [
    { username: 'ZERO',   score: 500, elapsedMs: 0 },
    { username: 'SECOND', score: 500, elapsedMs: 2500 },
  ];
  eq('a 0.0s solve outranks a 2.5s one on the same score',
     sortRuns(tie).map((r) => r.username), ['ZERO', 'SECOND']);
  // Reversed input, same answer - otherwise the check above passes on a
  // comparator that does nothing at all.
  eq('and the same from the other starting order',
     sortRuns([...tie].reverse()).map((r) => r.username), ['ZERO', 'SECOND']);
}
{
  // A null clock must not beat a real one when the scores are equal.
  const rows = [
    { username: 'NOCLOCK', score: 300, elapsedMs: null },
    { username: 'CLOCKED', score: 300, elapsedMs: 19000 },
  ];
  eq('a run with no clock sorts behind one that has a time',
     sortRuns(rows).map((r) => r.username), ['CLOCKED', 'NOCLOCK']);
}
{
  const rows = [{ username: 'A', score: 1 }, { username: 'B', score: 2 }];
  const before = rows.map((r) => r.username);
  sortRuns(rows);
  eq('sorting does not reorder the caller’s array', rows.map((r) => r.username), before);
}

// ---- arguments ------------------------------------------------------------
eq('no arguments means "list the voided runs"', parseArgs([]), { date: null, mode: 'sprint' });
eq('a date is taken', parseArgs(['--date=2026-11-17']), { date: '2026-11-17', mode: 'sprint' });
eq('the mode can be changed', parseArgs(['--date=2026-11-17', '--mode=daily']),
   { date: '2026-11-17', mode: 'daily' });
ck(parseArgs(['--date=17/11/2026']).error, 'a date in the wrong shape is refused',
   JSON.stringify(parseArgs(['--date=17/11/2026'])));
ck(parseArgs(['--reclaim']).error, 'an unknown flag is refused rather than ignored',
   JSON.stringify(parseArgs(['--reclaim'])));
// --reclaim belongs to void-sprint-run and WRITES. A read-only tool silently
// accepting it would be the worst kind of near-miss.
ck(/unknown/.test(parseArgs(['--reclaim']).error || ''), 'and says so');

// ---- timestamps -----------------------------------------------------------
eq('a Firestore timestamp reads as a date and time',
   when({ toDate: () => new Date('2026-11-17T18:57:31Z') }), '2026-11-17 18:57');
eq('a missing timestamp does not crash the row', when(null), '?');
eq('and neither does a plain value that is not one', when(1763405851), '?');

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
