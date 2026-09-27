/*
 * Which match documents get deleted.
 *
 * Match docs were never cleaned up. Only a host abandoning a lobby, and the
 * client clearing its own stale `waiting` rooms, ever removed one — so every
 * match that was actually PLAYED stayed in Firestore for good, with its chat
 * inside it, in a collection any signed-in account can read (matchmaking has to
 * query for open lobbies). This suite is the decision half of the fix.
 *
 * The dangerous direction is deleting a match someone is still playing, so the
 * cases below lean on that: age comes from `createdAt`, which is a server
 * timestamp pinned to request.time by the rules, and the client-written
 * `endTime` is only ever consulted for legacy documents with no createdAt —
 * and then only to confirm a match is long over.
 *
 * Pure; no emulator, no browser, no clock.
 */
import * as C from '../tools/match-cleanup.mjs';

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

const H = 3600000;
const NOW = new Date('2026-09-27T12:00:00Z');
const nowMs = NOW.getTime();
const ago = (hours) => new Date(nowMs - hours * H);

const plan = (matches, opts) => C.planMatchCleanup(matches, NOW, opts);
const verdict = (m, opts) => {
  const p = plan([{ id: 'x', ...m }], opts);
  return p.del.length ? 'delete' : 'keep';
};

// --- the ordinary path: age from the server timestamp ---------------------
ck(C.DEFAULT_RETENTION_HOURS === 24, 'the default retention is 24 hours', String(C.DEFAULT_RETENTION_HOURS));

ck(verdict({ status: 'finished', createdAt: ago(25) }) === 'delete', 'a finished match past retention goes');
ck(verdict({ status: 'finished', createdAt: ago(1) }) === 'keep', 'a finished match from an hour ago stays');
// The end modal and the rematch hop both read the finished doc, so "finished"
// alone must never be enough to delete it.
ck(verdict({ status: 'finished', createdAt: ago(0) }) === 'keep', 'a match that just finished stays');
ck(verdict({ status: 'waiting', createdAt: ago(25) }) === 'delete', 'an abandoned lobby past retention goes');
// A `playing` doc from yesterday is a closed tab, not a game. The server clock
// says so, which is exactly why age is not taken from the client's endTime.
ck(verdict({ status: 'playing', createdAt: ago(25), endTime: nowMs + 5 * H }) === 'delete',
   'a day-old "playing" match goes even with endTime in the future');
ck(verdict({ status: 'playing', createdAt: ago(0.1) }) === 'keep', 'a match in progress stays');

// The boundary, from both sides.
ck(verdict({ status: 'finished', createdAt: ago(24) }) === 'delete', 'exactly at the window, it goes');
ck(verdict({ status: 'finished', createdAt: new Date(nowMs - 24 * H + 1000) }) === 'keep',
   'a second under the window, it stays');

// A custom window.
ck(verdict({ status: 'finished', createdAt: ago(30) }, { retentionHours: 48 }) === 'keep',
   '--retention-hours=48 keeps a 30-hour-old match');
ck(verdict({ status: 'finished', createdAt: ago(50) }, { retentionHours: 48 }) === 'delete',
   'and drops a 50-hour-old one');
// Zero means "everything that exists is done", which is a legitimate ask for a
// one-off purge, so it must not be rejected as falsy.
ck(verdict({ status: 'playing', createdAt: ago(0) }, { retentionHours: 0 }) === 'delete',
   '--retention-hours=0 deletes everything');

// A clock that wrote the future is a broken write. The verdict is KEEP either
// way (a negative age is never past the window), so what the guard is actually
// for is the REASON: without it the plan reports "recent (-600m old)", and the
// reasons are what a person reads to decide whether the sweep is right.
const future = plan([{ id: 'x', status: 'playing', createdAt: new Date(nowMs + 10 * H) }]);
ck(future.counts.del === 0, 'a createdAt in the future is never a reason to delete');
ck(future.keep[0].reason === 'createdAt is in the future',
   'and is reported as the broken write it is', future.keep[0].reason);
ck(!/-\d/.test(future.keep[0].reason), 'never as a negative age', future.keep[0].reason);

// --- legacy documents, which have no createdAt ----------------------------
// The recurring job must never guess at a live match's age, so without --legacy
// these are all left alone.
for (const status of ['finished', 'waiting', 'playing']) {
  ck(verdict({ status }) === 'keep', `without --legacy, a timestampless "${status}" match stays`);
}
ck(plan([{ id: 'a', status: 'finished' }]).keep[0].reason.includes('--legacy'),
   'and the reason says what is missing', plan([{ id: 'a', status: 'finished' }]).keep[0].reason);

ck(verdict({ status: 'finished' }, { legacy: true }) === 'delete', 'with --legacy, a finished match goes');
ck(verdict({ status: 'waiting' }, { legacy: true }) === 'delete', 'and a never-started lobby goes');
// endTime is the host's own clock. Well past means the match cannot still be
// running even if that clock was hours out.
ck(verdict({ status: 'playing', endTime: nowMs - 25 * H }, { legacy: true }) === 'delete',
   'and a playing match whose deadline is long past goes');
ck(verdict({ status: 'playing', endTime: nowMs - 1 * H }, { legacy: true }) === 'keep',
   'but one whose deadline just passed is left for a later run');
ck(verdict({ status: 'playing', endTime: nowMs + H }, { legacy: true }) === 'keep',
   'and one still inside its deadline is never touched');
ck(verdict({ status: 'playing', endTime: null }, { legacy: true }) === 'keep',
   'a playing match with no deadline at all is left alone rather than guessed at');
ck(verdict({ status: 'playing' }, { legacy: true }) === 'keep', 'same when endTime is missing entirely');
// An unrecognised status is not an invitation to delete.
ck(verdict({ status: 'sudden-death' }, { legacy: true }) === 'keep', 'an unknown status is kept');
ck(verdict({}, { legacy: true }) === 'keep', 'and so is a doc with no status at all');
// createdAt wins over legacy handling when both could apply.
ck(verdict({ status: 'playing', createdAt: ago(1), endTime: nowMs - 99 * H }, { legacy: true }) === 'keep',
   'a recent createdAt beats a stale endTime', 'the server clock is the one to trust');

// --- timestamp shapes ------------------------------------------------------
// Firestore hands back a Timestamp; fixtures and older docs may hold anything.
const shapes = {
  'a Date': ago(25),
  'a millisecond number': nowMs - 25 * H,
  'a Firestore Timestamp': { toMillis: () => nowMs - 25 * H },
  'a serialized {seconds}': { seconds: Math.floor((nowMs - 25 * H) / 1000) },
  'a serialized {_seconds}': { _seconds: Math.floor((nowMs - 25 * H) / 1000) },
};
for (const [label, v] of Object.entries(shapes)) {
  ck(verdict({ status: 'finished', createdAt: v }) === 'delete', `createdAt as ${label} is understood`);
}
// Junk must read as ABSENT, not as epoch zero — coercing to 0 would make every
// malformed doc look infinitely old and delete it.
for (const [label, v] of [['a string', '2026-09-01'], ['NaN', NaN], ['true', true],
                          ['an empty object', {}], ['null', null], ['Infinity', Infinity]]) {
  ck(C.toMillis(v) === null, `${label} reads as no timestamp`, String(C.toMillis(v)));
  ck(verdict({ status: 'playing', createdAt: v }) === 'keep', `and a match with ${label} as createdAt is kept`);
}
ck(C.toMillis(0) === 0, 'but a genuine zero is still a timestamp', String(C.toMillis(0)));

// --- the plan as a whole ---------------------------------------------------
const mixed = [
  { id: 'old1', status: 'finished', createdAt: ago(48) },
  { id: 'old2', status: 'waiting', createdAt: ago(30) },
  { id: 'live', status: 'playing', createdAt: ago(0.05) },
  { id: 'justdone', status: 'finished', createdAt: ago(2) },
  { id: 'legacy', status: 'finished' },
];
let p = plan(mixed);
ck(p.counts.total === 5 && p.counts.del === 2 && p.counts.keep === 3, 'the counts add up', JSON.stringify(p.counts));
ck(p.del.map((r) => r.id).sort().join(',') === 'old1,old2', 'only the aged-out ones are listed', JSON.stringify(p.del.map((r) => r.id)));
ck(p.counts.del + p.counts.keep === p.counts.total, 'every match lands in exactly one bucket');
ck(p.del.every((r) => r.reason && r.status !== undefined), 'each deletion carries a reason and a status', JSON.stringify(p.del));
p = plan(mixed, { legacy: true });
ck(p.counts.del === 3 && p.del.some((r) => r.id === 'legacy'), '--legacy adds the timestampless finished one', JSON.stringify(p.counts));
ck(plan([]).counts.total === 0, 'an empty collection plans nothing');
ck(p.retentionHours === C.DEFAULT_RETENTION_HOURS, 'the plan reports the window it used', String(p.retentionHours));

// Bad arguments must throw rather than quietly delete on a wrong window.
for (const [label, opts] of [['a negative window', { retentionHours: -1 }],
                             ['a NaN window', { retentionHours: NaN }],
                             ['a non-numeric window', { retentionHours: 'soon' }]]) {
  let threw = false;
  try { plan([{ id: 'a', status: 'finished', createdAt: ago(99) }], opts); } catch { threw = true; }
  ck(threw, `${label} throws instead of running`);
}
let threw = false;
try { C.planMatchCleanup([], 'not a time'); } catch { threw = true; }
ck(threw, 'an unusable "now" throws instead of treating everything as ancient');

// --- batching --------------------------------------------------------------
// Firestore caps a write batch at 500 operations, so a big first sweep has to
// be split or it fails wholesale.
ck(C.MAX_BATCH === 500, 'the batch cap is Firestore\'s 500', String(C.MAX_BATCH));
const rows = Array.from({ length: 1201 }, (_, i) => i);
const b = C.batches(rows);
ck(b.length === 3, '1201 items become 3 batches', String(b.length));
ck(b.every((x) => x.length <= 500), 'none of them exceeds the cap', b.map((x) => x.length).join(','));
ck(b.flat().length === 1201 && new Set(b.flat()).size === 1201, 'and nothing is dropped or duplicated');
ck(C.batches([]).length === 0, 'nothing to delete means no batches');
ck(C.batches(rows, 1).length === 1201, 'a batch size of 1 is allowed');
for (const bad of [0, -5, 501, 1.5, '100']) {
  let t2 = false;
  try { C.batches(rows, bad); } catch { t2 = true; }
  ck(t2, `a batch size of ${JSON.stringify(bad)} is rejected`);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
