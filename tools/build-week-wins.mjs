#!/usr/bin/env node
/*
 * Settles a finished Stakes week: who had the best single run in it.
 *
 *   node tools/build-week-wins.mjs                 the most recent finished week
 *   node tools/build-week-wins.mjs --weeks=8       the last 8 finished weeks
 *   node tools/build-week-wins.mjs --week=2026-11-02
 *   node tools/build-week-wins.mjs --weeks=8 --dry-run
 *
 * WHY A SEPARATE PASS OVER /runs, rather than reading periodBestScore off
 * /users the way the live weekly board does: that field holds ONE week and is
 * overwritten by the first run of the next one. By the time a week is over
 * and safe to settle, anybody who has already played has had theirs replaced
 * - so the players most likely to have won are the ones whose record is gone
 * first. Runs are the only durable account of a finished week.
 *
 * WHY NOT THE SEVEN DAILY BOARDS, which are already stored and would be seven
 * reads instead of a range query: each of those holds only its top ten. A
 * week-winning run that placed eleventh on a busy day is not in any of them,
 * and the counter would be quietly wrong exactly when the game got popular.
 *
 * WHY IT RUNS EVERY DAY rather than on Mondays: awardWin is claim-guarded, so
 * a week already settled is skipped. Running daily means a missed or failed
 * Monday heals itself the next morning instead of losing a week for good, and
 * there is no day-of-week branch to get wrong twice a year when the clocks
 * move.
 *
 * Everything that decides WHO won lives in daily-board.mjs and is tested
 * against fixtures. This file only reads and writes.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
import * as B from "./daily-board.mjs";
import { awardWin } from "./award-win.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const unknown = args.filter((a) => !/^--(dry-run|week=.*|weeks=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const WEEKS = val("--weeks") === null ? 1 : Number(val("--weeks"));
if (!Number.isInteger(WEEKS) || WEEKS < 1 || WEEKS > 60) { console.error("--weeks must be 1..60"); process.exit(1); }

// Which weeks, decided BEFORE firebase-admin is loaded: working this out needs
// nothing but the clock, so a bad --week should say so rather than fail on a
// missing module or missing credentials first.
const today = B.dayKeyET(new Date());
const thisWeek = B.weekKeyET(today);
let weeks;
const one = val("--week");
if (one) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(one)) { console.error("--week must be YYYY-MM-DD"); process.exit(1); }
  if (B.weekKeyET(one) !== one) {
    console.error(`--week must be a Monday; ${one} belongs to the week of ${B.weekKeyET(one)}`);
    process.exit(1);
  }
  // The same refusal the daily tool makes about today, for the same reason: a
  // week settled while it is still being played crowns somebody who could
  // still be overtaken, and nothing later corrects it.
  if (one >= thisWeek) {
    console.error(`refusing ${one}: that week is not over yet (this week is ${thisWeek} Eastern)`);
    process.exit(1);
  }
  weeks = [one];
} else {
  weeks = B.finishedWeeks(today, WEEKS);
}
console.log(`settling ${weeks.length} week(s): ${weeks.join(", ")}  (this week is ${thisWeek} Eastern)`);

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Eastern midnight, built from the date parts rather than a fixed offset so
// this stays correct across the DST changes - the same probe the daily tool
// uses, and for the same reason.
const etMidnight = (dayKey) => {
  const [y, m, d] = dayKey.split("-").map(Number);
  for (const offset of [5, 4]) {
    const guess = new Date(Date.UTC(y, m - 1, d, offset, 0, 0));
    if (B.dayKeyET(guess) === dayKey
        && new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(guess) === "00") {
      return guess;
    }
  }
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
};

let awarded = 0;
for (const week of weeks) {
  const start = etMidnight(week);
  const end = etMidnight(B.shiftDay(week, 7));
  const snap = await db.collection("runs")
    .where("timestamp", ">=", Timestamp.fromDate(start))
    .where("timestamp", "<", Timestamp.fromDate(end))
    .get();
  const runs = snap.docs.map((d) => d.data());
  const uids = B.topWinners(runs);
  const best = B.bestPerPlayer(runs);
  const lead = uids.length ? best.get(uids[0]) : null;

  console.log(`  ${week}  ${String(snap.size).padStart(4)} run(s), ${best.size} player(s)`
    + (lead ? `  top: ${lead.name} ${lead.score.toLocaleString()}` : "  (nobody)")
    + (uids.length > 1 ? `  [tied ${uids.length} ways]` : ""));

  if (!DRY && uids.length) {
    const win = await awardWin(db, FieldValue, {
      claim: `standardWeek_${week}`, field: "weekWins", uids,
    });
    awarded += win.awarded ? 1 : 0;
    console.log(`    win ${week}: ` + (win.awarded ? `awarded to ${win.winners.length}` : win.reason));
  }
}
console.log(DRY ? "\n--dry-run: nothing written" : `\nsettled ${awarded} new week win(s)`);
