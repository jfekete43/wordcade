/*
 * WHICH match documents are finished with, and safe to delete.
 *
 * Match docs were never cleaned up. Only two things ever deleted one: a host
 * abandoning a lobby, and the client opportunistically clearing its own stale
 * `waiting` rooms on the way into matchmaking. Every match that actually got
 * PLAYED stayed in Firestore for good — and `matches` is readable by any
 * signed-in account, because matchmaking has to query for open lobbies. So the
 * collection grew without bound and every match's chat sat in it indefinitely.
 *
 * A match's whole useful life is minutes: a lobby wait, a race of at most seven
 * minutes, the end modal, and the rematch hop (the guest follows
 * `rematchMatchId` off the finished doc, so the doc has to outlive the match
 * itself). Anything appreciably older than that is done with, whatever its
 * status says — a `playing` doc from yesterday is an abandoned tab, not a game.
 *
 * Age is measured from `createdAt`, which the client writes as a
 * serverTimestamp() and firestore.rules pins to request.time. That matters: an
 * age computed from a client clock could be wrong in the dangerous direction
 * and delete a match that is still being played. `endTime` IS a client clock,
 * which is why it is only consulted for legacy docs that have no createdAt at
 * all, and then only to confirm a match is long over rather than to end it.
 *
 * Pure: no Firestore, no clock, no filesystem. Everything here is decided from
 * its arguments so it can be tested exhaustively.
 */

// Stated in privacy.html. Long enough to read the end modal, take a rematch,
// and look into a complaint the same day; short enough to bound how long chat
// lives. tests/docs-consistency pins the policy prose to this number.
export const DEFAULT_RETENTION_HOURS = 24;

// Firestore hands back a Timestamp; tests and older docs may hold a plain
// number, a Date, or a serialized {seconds}/{_seconds}. Anything else is
// treated as absent rather than coerced into a misleading 0.
export function toMillis(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v.toMillis === "function") { const n = v.toMillis(); return Number.isFinite(n) ? n : null; }
  const s = v.seconds ?? v._seconds;
  if (typeof s === "number" && Number.isFinite(s)) return s * 1000;
  return null;
}

export const KEEP = "keep";
export const DELETE = "delete";

/*
 * One match's verdict. `legacy` says whether to act on documents predating
 * createdAt; without it they are left alone, so the recurring job can never be
 * the thing that guesses at a live match's age.
 */
export function classifyMatch(m, nowMs, retentionMs, legacy = false) {
  const created = toMillis(m.createdAt);
  if (created !== null) {
    // A createdAt in the future means a broken write, not a new match. Deleting
    // on that basis would be acting on a timestamp we already know is wrong.
    if (created > nowMs) return { action: KEEP, reason: "createdAt is in the future" };
    const age = nowMs - created;
    return age >= retentionMs
      ? { action: DELETE, reason: `aged out (${Math.floor(age / 3600000)}h old)` }
      : { action: KEEP, reason: `recent (${Math.floor(age / 60000)}m old)` };
  }

  if (!legacy) return { action: KEEP, reason: "no createdAt (needs --legacy)" };

  // Legacy docs, created before createdAt existed. Nothing here can be aged
  // properly, so each case has to be safe on its own terms.
  const status = m.status;
  if (status === "finished") return { action: DELETE, reason: "legacy, finished" };
  if (status === "waiting") return { action: DELETE, reason: "legacy, never started" };
  if (status === "playing") {
    // endTime is the match's own deadline, written by the host's clock. Well
    // past means the match cannot still be running even if that clock was off
    // by hours; anything else is left for a later run, by which point the doc
    // will have a createdAt or be gone.
    const end = toMillis(m.endTime);
    if (end !== null && nowMs - end >= retentionMs) return { action: DELETE, reason: "legacy, abandoned mid-match" };
    return { action: KEEP, reason: "legacy and playing, age unknown" };
  }
  return { action: KEEP, reason: `legacy, unrecognised status ${JSON.stringify(status)}` };
}

/*
 * The whole plan. `matches` is [{ id, ...data }].
 */
export function planMatchCleanup(matches, now, opts = {}) {
  const retentionHours = opts.retentionHours === undefined ? DEFAULT_RETENTION_HOURS : Number(opts.retentionHours);
  if (!Number.isFinite(retentionHours) || retentionHours < 0) throw new Error("retentionHours must be a non-negative number");
  const nowMs = toMillis(now);
  if (nowMs === null) throw new Error("now must be a usable timestamp");
  const retentionMs = retentionHours * 3600000;

  const del = [], keep = [];
  for (const m of matches) {
    const v = classifyMatch(m, nowMs, retentionMs, !!opts.legacy);
    (v.action === DELETE ? del : keep).push({ id: m.id, reason: v.reason, status: m.status });
  }
  return {
    del, keep,
    retentionHours,
    counts: { total: matches.length, del: del.length, keep: keep.length },
  };
}

// Firestore caps a write batch at 500 operations.
export const MAX_BATCH = 500;
export function batches(items, size = MAX_BATCH) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH) throw new Error(`batch size must be 1..${MAX_BATCH}`);
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
