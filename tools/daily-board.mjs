/*
 * What a finished day's Standard board contains.
 *
 * The home screen shows TODAY live, read straight off /users (each player's
 * dayBestScore, maintained by onRunCreated). That cannot answer "show me
 * yesterday" — the field holds one day and is overwritten when the next day's
 * first run lands — and rebuilding a past day from /runs on demand is the
 * every-run-on-every-view pattern that made the old Monthly board quadratic.
 *
 * So a finished day is snapshotted once, by the daily job, into a single
 * document. Browsing back through history then costs one document read per day
 * looked at, whatever happened that day.
 *
 * Pure: no Firestore, no clock, no filesystem.
 */

// Ten fits the home screen without scrolling and keeps the stored document
// small enough that a day is always one read.
export const BOARD_SIZE = 10;

// Eastern, matching getTodayDateStr() in functions/index.js and index.html and
// the Trifecta's own rollover. A day boundary that differed from the Trifecta's
// would put "today" in two places at once.
export function dayKeyET(when) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when);
}

// N days before (or after) the Eastern day `when` falls in.
export function shiftDay(dayKey, days) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/*
 * Firestore hands back a Timestamp; fixtures and older docs may hold a number,
 * a Date or a serialized {seconds}. Anything else reads as absent rather than
 * being coerced into a misleading 0.
 */
export function toMillis(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v.toMillis === "function") { const n = v.toMillis(); return Number.isFinite(n) ? n : null; }
  const s = v.seconds ?? v._seconds;
  if (typeof s === "number" && Number.isFinite(s)) return s * 1000;
  return null;
}

/*
 * One day's board from that day's runs.
 *
 * `runs` is [{ uid, username, score, mode, timestamp }] — every run saved that
 * day. Returns the document to store.
 *
 * Trifecta runs are dropped: they have their own board, and ten words against
 * an endless run are not the same number. A wipeout scores 0 and onRunCreated
 * only counts a score above the day's prior best, so zeroes are dropped too —
 * this has to agree with the live path or a day would look different depending
 * on whether you were viewing it live or from history.
 */
/*
 * One entry per player: their best single run out of `runs`.
 *
 * Shared by the day board, the week's winner and the daily winner, so the
 * three cannot disagree about what "best" counts. Trifecta runs are dropped
 * (they have their own board, and ten words against an endless run are not
 * the same number) and so are wipeouts, which score 0 — onRunCreated only
 * counts a score above the prior best, so a zero never moves the live board
 * either, and a day must look the same viewed live or from history.
 */
export function bestPerPlayer(runs) {
  const best = new Map();
  for (const r of runs || []) {
    if (!r || r.mode === "daily") continue;
    const uid = r.uid;
    const score = Math.max(0, Number(r.score) || 0);
    if (!uid || score <= 0) continue;
    const at = toMillis(r.timestamp);
    const prev = best.get(uid);
    // `equipped` is carried so a past day renders with banners and name
    // effects like today's does; without it history would look plainer than
    // the live board and read as broken rather than as old. It is a snapshot
    // of what that player looked like on that day, which is the honest thing
    // for a record of that day to hold.
    if (!prev || score > prev.score) {
      best.set(uid, { uid, name: r.username || "Player", score, at, equipped: r.equipped || null });
    }
  }
  return best;
}

/*
 * Who won a period, as uids.
 *
 * The same ordering the board is sorted by: highest score, and among equal
 * scores the run that landed first, because getting there first is a
 * tiebreak a player can actually understand. A win is SHARED only by a true
 * tie - same score and the same instant - rather than by score alone, so the
 * counter agrees with the board a player is looking at. Two runs to the
 * millisecond is vanishingly unlikely; splitting it on uid, the way the
 * board's final sort key does, would hand a win to whoever Firestore named
 * first, which is not a thing anybody won.
 *
 * Returns [] for a period nobody played, which is not an error: most of
 * Lexathon's history predates most of its players.
 */
export function topWinners(runs) {
  const rows = [...bestPerPlayer(runs).values()];
  if (!rows.length) return [];
  const at = (r) => r.at ?? Infinity;
  const lead = rows.reduce((a, b) =>
    (b.score > a.score || (b.score === a.score && at(b) < at(a))) ? b : a);
  return rows.filter((r) => r.score === lead.score && at(r) === at(lead)).map((r) => r.uid);
}

/*
 * The Monday of the Eastern week a given Eastern date falls in, "YYYY-MM-DD".
 *
 * Must agree with periodKeyFor(when, "weekly") in functions/index.js: that is
 * what keys periodBestScore, so a week settled on a different Monday here
 * would be crediting a window nobody was playing for.
 */
export function weekKeyET(dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || "")) throw new Error("dayKey must be YYYY-MM-DD");
  const [y, m, d] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7)); // 0 = Monday
  return utc.toISOString().slice(0, 10);
}

/*
 * The last `howMany` FINISHED weeks, newest first. The week `todayKey` falls
 * in is still being played, so it is never included.
 */
export function finishedWeeks(todayKey, howMany) {
  const out = [];
  let k = weekKeyET(todayKey);
  for (let i = 0; i < howMany; i++) { k = shiftDay(k, -7); out.push(k); }
  return out;
}

export function buildDayBoard(dayKey, runs, size = BOARD_SIZE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || "")) throw new Error("dayKey must be YYYY-MM-DD");
  if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");

  const best = bestPerPlayer(runs);

  const top = [...best.values()]
    // Score first; an earlier run wins a tie, because getting there first is
    // the tiebreak a player can actually understand.
    .sort((a, b) => b.score - a.score || (a.at ?? Infinity) - (b.at ?? Infinity) || a.uid.localeCompare(b.uid))
    .slice(0, size);

  return {
    date: dayKey,
    top: top.map((t, i) => ({
      place: i + 1, uid: t.uid, name: t.name, score: t.score,
      ...(t.equipped ? { equipped: t.equipped } : {}),
    })),
    // How many players the board was drawn from, not how many rows it shows —
    // "3rd of 40" is a different thing to say than "3rd of 10".
    players: best.size,
  };
}

/*
 * Which days the home screen may step back to: finished days only, newest
 * first, and never further back than the boards that exist.
 */
export function browsableDays(todayKey, howMany) {
  const out = [];
  for (let i = 1; i <= howMany; i++) out.push(shiftDay(todayKey, -i));
  return out;
}
