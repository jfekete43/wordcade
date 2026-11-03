/*
 * The decision half of the Sprint distribution backfill: given Sprint run
 * documents, what should each player's sprintG1..sprintG5 be?
 *
 * Pure, and separate from the script that does the writing, for the same
 * reason gauntlet-archive-render is separate from build-gauntlet-archive: the
 * interesting half is what the numbers should be, and that is worth testing
 * without a Firestore anywhere near it.
 *
 * The answer is always an absolute total recomputed from every run, never an
 * adjustment. That is what makes the backfill safe to run twice, and safe to
 * run after onRunCreated has already counted some of the same runs itself — it
 * lands on the truth either way. An incrementing version would be correct
 * exactly once and wrong every time after.
 */

/*
 * runs: [{ uid, guess1..guess5 }] — Sprint /runs documents, in any order.
 * Returns Map<uid, [g1, g2, g3, g4, g5]>.
 *
 * A Sprint run carries exactly one 1 across guess1..guess5 when the word was
 * solved and all zeros when it was missed, which is the same shape the stored
 * counters hold. Misses deliberately contribute nothing: the X row on the
 * chart is derived as played minus solved, so counting them here as well would
 * be the same miss in two places.
 */
export function foldSprintRuns(runs) {
  const byUid = new Map();
  for (const r of runs || []) {
    // A run with no uid is malformed rather than orphaned — the uid is written
    // on the document itself — so there is no account to credit it to.
    if (!r || typeof r.uid !== "string" || !r.uid) continue;
    const row = byUid.get(r.uid) || [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
      const n = Number(r["guess" + (i + 1)]);
      // Guarded rather than trusted: these come off a client-written document,
      // and a fractional or negative value would otherwise be written straight
      // into a career counter.
      if (Number.isFinite(n) && n > 0) row[i] += Math.floor(n);
    }
    byUid.set(r.uid, row);
  }
  return byUid;
}

/*
 * Whether a stored row already matches what the runs say, so an unchanged
 * player can be left alone rather than written to.
 */
export function sprintRowMatches(stored, row) {
  const d = stored || {};
  return row.every((n, k) => (Number(d["sprintG" + (k + 1)]) || 0) === n);
}

/* The update payload for one player. */
export function sprintRowUpdate(row) {
  const update = {};
  row.forEach((n, k) => { update["sprintG" + (k + 1)] = n; });
  return update;
}
