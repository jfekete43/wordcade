#!/usr/bin/env node
/*
 * Finds the runs that were voided, and lists who played on a given day.
 *
 *   node tools/voided-runs.mjs
 *   node tools/voided-runs.mjs --date=2026-11-17
 *   node tools/voided-runs.mjs --handle=ELERUMMY
 *
 * void-sprint-run.mjs stamps voidedAt and voidedReason on the run it zeroes,
 * so the record of an operator decision lives in the data rather than in
 * anyone's memory. Nothing read it back until now: working out which day a
 * void happened on meant already knowing.
 *
 * With no arguments it lists every voided run, oldest first - the puzzle day,
 * the handle, the reason, and when the void was applied.
 *
 * With --date it lists everyone who played that day's Sprint, best first,
 * which is the cross-reference you want once you have the date: who else was
 * on the board, in how many guesses, how fast. Voided rows are MARKED rather
 * than hidden - a board with a row quietly missing is the thing that makes
 * you doubt the rest of it.
 *
 * With --handle it lists one player's runs across every day they appear, and
 * ends with how often they play. That last number is the one that decides
 * whether a coincidence is a coincidence: two handles turning up on the same
 * day only means something if turning up is itself uncommon, and a player on
 * the board most days coincides with everything. Submission times are printed
 * to the second for the same reason - one person running two accounts shows
 * up as runs landing seconds apart, which rounding to the minute hides.
 *
 * It is a tool for looking, not for concluding. Nothing in a run distinguishes
 * a fast solve from a repeat under a second account; that remains the
 * operator's judgement, exactly as void-sprint-run.mjs says.
 *
 * READ-ONLY. It writes nothing, so it is safe to run while still deciding.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient
 * service account, exactly as the other tools in here do.
 */

// ---- the pure parts, exported so tests can reach them ----------------------

// To the SECOND, not the minute. Two accounts being the same person shows up
// as submissions landing seconds apart, every time; rounded to the minute that
// signal is mostly gone.
export const when = (ts) =>
  (ts && ts.toDate ? ts.toDate().toISOString().replace("T", " ").slice(0, 19) : "?");

// null is a real value here, not a gap: the board orders on elapsedMs, and an
// unsolved or voided run carries null so Firestore still returns it.
export const secs = (ms) =>
  (ms === null || ms === undefined ? "—" : (Number(ms) / 1000).toFixed(1) + "s");

// The histogram is one bucket per guess number, so the bucket that is set IS
// the number of guesses the solve took. A voided run has all five cleared.
export const guesses = (r) => {
  for (let i = 1; i <= 5; i++) if (Number(r["guess" + i]) > 0) return String(i);
  return "—";
};

/*
 * The board's own order: score first, then the clock.
 *
 * ?? Infinity, not || Infinity: a first-guess solve has elapsedMs of exactly
 * 0 because the clock starts ON the first guess, and 0 is falsy. || would
 * send the fastest possible run to the back of the tie it just won - which is
 * the same mistake the Sprint board itself shipped with, where a 500 rendered
 * with no clock at all.
 *
 * A voided run scores 0 with a null clock, so it sorts to the bottom here
 * exactly as it does on the live leaderboard.
 */
export const sortRuns = (rows) => [...rows].sort((a, b) =>
  (Number(b.score) || 0) - (Number(a.score) || 0) ||
  ((a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity)));

export function parseArgs(argv) {
  const val = (f) => { const a = argv.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
  const unknown = argv.filter((a) => !/^--(date=.*|mode=.*|handle=.*)$/.test(a));
  if (unknown.length) return { error: "unknown argument(s): " + unknown.join(" ") };
  const date = val("--date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "--date=YYYY-MM-DD" };
  const handle = val("--handle");
  if (handle && date) return { error: "--handle and --date are separate questions; pass one" };
  return { date, handle, mode: val("--mode") || "sprint" };
}

/*
 * How often somebody plays, which is the number that decides whether "they
 * were both there" means anything.
 *
 * Two accounts turning up on the same day is only suspicious if turning up is
 * itself rare. A player on the board most days coincides with everything, so
 * the base rate has to be read before the coincidence is.
 */
export function playRate(dates, fromDate, toDate) {
  const uniq = [...new Set(dates)].sort();
  if (!uniq.length) return { days: 0, span: 0, rate: 0 };
  const from = fromDate || uniq[0], to = toDate || uniq[uniq.length - 1];
  const span = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
  return { days: uniq.length, span, rate: span > 0 ? uniq.length / span : 0, first: uniq[0], last: uniq[uniq.length - 1] };
}

// ---- and the part that talks to Firestore ---------------------------------

async function main() {
  const { error, date: DATE, handle: HANDLE, mode: MODE } = parseArgs(process.argv.slice(2));
  if (error) { console.error(error); process.exit(1); }

  const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  if (HANDLE) {
    // Resolved through usernameLower, the same field the game's own
    // "already taken" check uses, so the handle typed here resolves the way
    // the handle typed in the game does.
    const who = await db.collection("users")
      .where("usernameLower", "==", HANDLE.toLowerCase()).limit(2).get();
    if (who.empty) { console.log(`no account with the handle ${HANDLE}`); return; }
    if (who.size > 1) { console.log(`${HANDLE} matches more than one account; refusing to guess`); return; }
    const uid = who.docs[0].id;
    const snap = await db.collection("runs").where("uid", "==", uid).get();
    const runs = snap.docs.map((d) => d.data()).filter((r) => (r.mode || "") === MODE);
    if (!runs.length) { console.log(`${HANDLE} has no ${MODE} runs.`); return; }
    runs.sort((a, b) => String(a.puzzleDate || "").localeCompare(String(b.puzzleDate || "")));

    console.log(`${HANDLE} -> ${uid}`);
    console.log(`${runs.length} ${MODE} run(s):\n`);
    console.log("  DAY          SCORE  GUESSES   TIME    RECORDED");
    for (const r of runs) {
      console.log("  " +
        String(r.puzzleDate || "?").padEnd(12) +
        String(Number(r.score) || 0).padStart(5) + "  " +
        guesses(r).padStart(7) + "   " +
        secs(r.elapsedMs).padStart(6) + "  " +
        when(r.timestamp) +
        (r.voidedAt ? `   VOIDED (${r.voidedReason || "no reason recorded"})` : ""));
    }
    const rate = playRate(runs.map((r) => r.puzzleDate).filter(Boolean));
    console.log(`\nPlayed ${rate.days} of the ${rate.span} days from ${rate.first} to ${rate.last}` +
                ` (${Math.round(rate.rate * 100)}%).`);
    // The point of printing this at all.
    console.log("Read that before reading any coincidence: somebody on the board most days");
    console.log("coincides with everything, so \"they were both there\" is only evidence when");
    console.log("being there is itself uncommon.");
    return;
  }

  if (!DATE) {
    // orderBy on voidedAt rather than a != filter: Firestore drops documents
    // missing an ordered field from the result entirely, which is exactly the
    // filter wanted here and needs no composite index.
    const snap = await db.collection("runs").orderBy("voidedAt", "asc").get();
    if (snap.empty) {
      console.log("No voided runs found.");
      console.log("Either nothing has been through void-sprint-run.mjs, or it was voided by hand.");
      return;
    }
    console.log(`${snap.size} voided run(s), oldest first:\n`);
    console.log("  PUZZLE DAY   MODE     HANDLE           VOIDED AT         REASON");
    for (const d of snap.docs) {
      const r = d.data();
      console.log("  " +
        String(r.puzzleDate || r.date || "?").padEnd(12) +
        String(r.mode || "?").padEnd(8) + " " +
        String(r.username || r.uid || "?").padEnd(16) + " " +
        when(r.voidedAt).padEnd(17) + " " +
        (r.voidedReason || ""));
    }
    console.log("\nThen: node tools/voided-runs.mjs --date=<the puzzle day above>");
    return;
  }

  // One equality filter, so the automatic single-field index covers it and
  // there is no composite to add. The mode is filtered in memory: a day's run
  // count is small, and a second equality filter would need an index created.
  const snap = await db.collection("runs").where("puzzleDate", "==", DATE).get();
  const rows = sortRuns(snap.docs.map((d) => d.data()).filter((r) => (r.mode || "") === MODE));
  if (!rows.length) { console.log(`No ${MODE} runs on ${DATE}.`); return; }

  console.log(`${rows.length} ${MODE} run(s) on ${DATE}, best first:\n`);
  console.log("  #   HANDLE             SCORE  GUESSES   TIME    RECORDED");
  rows.forEach((r, i) => {
    console.log("  " +
      String(i + 1).padEnd(4) +
      String(r.username || r.uid || "?").padEnd(18) + " " +
      String(Number(r.score) || 0).padStart(5) + "  " +
      guesses(r).padStart(7) + "   " +
      secs(r.elapsedMs).padStart(6) + "  " +
      when(r.timestamp) +
      (r.voidedAt ? `   VOIDED (${r.voidedReason || "no reason recorded"})` : ""));
  });

  const quick = rows.filter((r) => !r.voidedAt && ["1", "2"].includes(guesses(r)));
  if (quick.length) {
    console.log(`\n${quick.length} solve(s) in one or two guesses: ` +
      quick.map((r) => `${r.username} (${guesses(r)})`).join(", "));
    console.log("A first-guess solve always reads 0.0s - the clock starts on the first guess,");
    console.log("so a 0.0s row is the clock working, not evidence on its own.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
