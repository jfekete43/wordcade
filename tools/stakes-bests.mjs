/*
 * What a user document's Stakes board fields SHOULD say, given the runs that
 * exist. Pure: no Firestore, no clock, no credentials.
 *
 * Split out from repair-stakes-bests.mjs for the reason daily-board.mjs is
 * split out from build-week-wins.mjs - everything that DECIDES lives
 * somewhere it can be run against fixtures, and the program that reads and
 * writes only reads and writes. This one decides whether to lower a player's
 * all-time best, which is a thing no other code in the project is allowed to
 * do, so it is the half worth testing.
 *
 * The mode rule itself is NOT restated here. It is lifted from
 * functions/index.js by the caller and passed in, because this whole repair
 * exists because a second copy of that rule disagreed with the first.
 */

/*
 * Reduce a player's runs to the two bests that matter.
 *
 *   isStakes   the lifted predicate from functions/index.js
 *   periodKey  the lifted window function, called with a Date
 *   window     the window key that is open right now
 *
 * A run's OWN timestamp decides which window it belongs to. Using "now"
 * instead would file last Tuesday's run under this week the moment this is
 * run on a Wednesday, which is the same class of mistake as the Marathon
 * digest reading marathonKey off /users.
 */
export function bestsFromRuns(runs, { isStakes, periodKey, window }) {
  let best = null, period = null;
  for (const run of runs) {
    if (!isStakes(run)) continue;
    const score = Math.max(0, Number(run && run.score) || 0);
    const at = (run && run.timestamp) || null;
    if (!best || score > best.score) best = { score, at };
    const when = at && typeof at.toDate === "function" ? at.toDate() : at instanceof Date ? at : null;
    if (when && periodKey(when) === window) {
      if (!period || score > period.score) period = { score, at };
    }
  }
  return { best, period };
}

/*
 * The change to write, or null. Only ever returns the fields that actually
 * disagree, so a second run over a repaired account finds nothing - which is
 * what makes this safe to re-run and safe to leave in a schedule.
 *
 * `del` is the caller's delete sentinel (FieldValue.delete), passed in rather
 * than imported so this file needs no SDK. A player with no Stakes runs has
 * the fields REMOVED, not zeroed: the all-time board is an orderBy, which
 * excludes documents missing the field, so removing takes them off a board
 * they were never entitled to be on. A zero leaves them on it with a zero.
 */
export function repairFor(user, truth, { window, del }) {
  const num = (v) => Math.max(0, Number(v) || 0);
  const u = user || {};
  const t = truth || { best: null, period: null };
  const change = {};
  const notes = [];

  const storedBest = num(u.bestRunScore);
  if (u.bestRunScore !== undefined && !t.best) {
    change.bestRunScore = del;
    change.bestRunAt = del;
    notes.push(`all-time ${storedBest} -> none (no Stakes runs)`);
  } else if (t.best && storedBest !== t.best.score) {
    change.bestRunScore = t.best.score;
    if (t.best.at) change.bestRunAt = t.best.at;
    notes.push(`all-time ${storedBest} -> ${t.best.score}`);
  }

  // A stored best from a PREVIOUS window is not wrong, it is just spent: the
  // board filters on periodBestKey, so it is already invisible and rewriting
  // it would be churn. Only the window that is open now is compared.
  const storedPeriod = u.periodBestKey === window ? num(u.periodBestScore) : 0;
  const truePeriod = t.period ? t.period.score : 0;
  if (storedPeriod !== truePeriod) {
    if (truePeriod) {
      change.periodBestKey = window;
      change.periodBestScore = t.period.score;
      if (t.period.at) change.periodBestAt = t.period.at;
      notes.push(`this window ${storedPeriod} -> ${truePeriod}`);
    } else if (u.periodBestKey === window) {
      change.periodBestKey = del;
      change.periodBestScore = del;
      change.periodBestAt = del;
      notes.push(`this window ${storedPeriod} -> none`);
    }
  }

  return Object.keys(change).length ? { change, notes } : null;
}
