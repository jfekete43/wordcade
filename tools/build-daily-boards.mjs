#!/usr/bin/env node
/*
 * Snapshots a finished day's Standard board into dailyBoards/{date}.
 *
 *   node tools/build-daily-boards.mjs                 yesterday (Eastern)
 *   node tools/build-daily-boards.mjs --date=2026-09-28
 *   node tools/build-daily-boards.mjs --days=7        the last 7 finished days
 *   node tools/build-daily-boards.mjs --days=7 --dry-run
 *
 * Everything that decides WHAT a board contains lives in daily-board.mjs and is
 * tested against fixtures. This file only reads and writes.
 *
 * Why snapshot at all: the home screen reads TODAY live off /users, because
 * onRunCreated keeps each player's dayBestScore there. That field holds one day
 * and is overwritten when the next day's first run lands, so it cannot answer
 * "show me yesterday" — and rebuilding a past day from /runs on demand is the
 * every-run-on-every-view pattern that made the old Monthly board quadratic.
 * One document per finished day makes browsing history one read per day.
 *
 * Refuses to touch today: the day is not over, and a board written mid-day
 * would be wrong in a way nothing later corrects.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
import * as B from "./daily-board.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const unknown = args.filter((a) => !/^--(dry-run|date=.*|days=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const DAYS = val("--days") === null ? 1 : Number(val("--days"));
if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 60) { console.error("--days must be 1..60"); process.exit(1); }

// Which days, decided BEFORE firebase-admin is loaded. Working out the dates
// needs nothing but the clock, so a bad --date should say so rather than fail
// on a missing module or missing credentials first.
const today = B.dayKeyET(new Date());
let dates;
const one = val("--date");
if (one) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(one)) { console.error("--date must be YYYY-MM-DD"); process.exit(1); }
  if (one >= today) { console.error(`refusing ${one}: that day is not over yet (today is ${today} Eastern)`); process.exit(1); }
  dates = [one];
} else {
  dates = B.browsableDays(today, DAYS);
}
console.log(`building ${dates.length} day(s): ${dates.join(", ")}  (today is ${today} Eastern)`);

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Eastern midnight to Eastern midnight. Built from the date parts rather than
// a fixed offset so this stays correct across the DST changes, same as
// everything else that reasons about a Lexathon day.
const etMidnight = (dayKey) => {
  const [y, m, d] = dayKey.split("-").map(Number);
  // Find the UTC instant whose Eastern date is dayKey and whose Eastern time is
  // 00:00, by probing: Eastern is UTC-5 or UTC-4.
  for (const offset of [5, 4]) {
    const guess = new Date(Date.UTC(y, m - 1, d, offset, 0, 0));
    if (B.dayKeyET(guess) === dayKey
        && new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(guess) === "00") {
      return guess;
    }
  }
  // Fall back to UTC-5; a one-hour edge beats refusing to build the day.
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
};

let written = 0;
for (const date of dates) {
  const start = etMidnight(date);
  const end = etMidnight(B.shiftDay(date, 1));
  const snap = await db.collection("runs")
    .where("timestamp", ">=", Timestamp.fromDate(start))
    .where("timestamp", "<", Timestamp.fromDate(end))
    .get();
  const board = B.buildDayBoard(date, snap.docs.map((d) => d.data()));
  const line = `  ${date}  ${String(snap.size).padStart(4)} run(s) -> ${board.top.length} row(s), ${board.players} player(s)`
    + (board.top.length ? `  top: ${board.top[0].name} ${board.top[0].score.toLocaleString()}` : "  (nobody)");
  console.log(line);
  if (!DRY) {
    await db.collection("dailyBoards").doc(date).set({ ...board, builtAt: Timestamp.now() });
    written++;
  }
}
console.log(DRY ? "\n--dry-run: nothing written" : `\nwrote ${written} board document(s)`);
