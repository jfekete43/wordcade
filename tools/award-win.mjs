/*
 * Paying out a board win, once.
 *
 * The Node-tool twin of awardBoardWin() in functions/index.js, and it keeps
 * that function's two rules because they are the ones that matter:
 *
 *   The claim and the counters move in ONE transaction. A claim written
 *   beside an increment rather than with it leaves a window where a retry
 *   pays twice, and a career counter that climbs on its own is worse than no
 *   counter at all.
 *
 *   set+merge rather than update. A player can delete their account and
 *   leave their runs behind, and update() on a missing document would fail
 *   the whole transaction - costing the other winners their win because one
 *   of them left.
 *
 * It lives here rather than being imported from the functions bundle because
 * these are two separate programs with two separate Firestore SDKs; the
 * claim collection and its document shape are the contract between them.
 *
 * Idempotent by construction, which is what lets the callers be dumb: the
 * daily and weekly tools can be re-run over any range, by a backfill or by a
 * retried workflow, and a period already settled is simply skipped. That is
 * also why they do not bother to work out whether today is a Monday.
 */
export async function awardWin(db, FieldValue, { claim, field, uids }) {
  const winners = [...new Set((uids || []).filter(Boolean))];
  if (!winners.length) return { awarded: false, reason: "nobody played" };

  const ref = db.collection("boardAwards").doc(claim);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { awarded: false, reason: "already settled" };
    for (const uid of winners) {
      tx.set(db.collection("users").doc(uid),
        { [field]: FieldValue.increment(1) }, { merge: true });
    }
    tx.set(ref, { claim, field, winners, at: FieldValue.serverTimestamp() });
    return { awarded: true, winners };
  });
}
