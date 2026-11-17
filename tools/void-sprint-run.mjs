#!/usr/bin/env node
/*
 * Voids one player's Sprint run for one day.
 *
 *   node tools/void-sprint-run.mjs --handle=SOMEBODY --date=2026-11-17 --dry-run
 *   node tools/void-sprint-run.mjs --handle=SOMEBODY --date=2026-11-17
 *   node tools/void-sprint-run.mjs --handle=SOMEBODY --date=2026-11-17 --reclaim
 *
 * For the case the boards cannot police themselves: a player who already
 * knows the answer. Nothing in the game can tell a lucky first guess from a
 * repeat under a second account, so this is a judgement the operator makes
 * and the tool carries out - it decides nothing on its own.
 *
 * WHAT IT CHANGES, by default, and only this:
 *
 *   runs/sprint_{uid}_{date}   score -> 0, elapsedMs -> null, the guess
 *                              histogram cleared, wordsGuessed -> 0,
 *                              fails -> 1, and voidedAt/voidedReason set so
 *                              the row says why rather than just looking odd.
 *
 * That is what the board ranks, so the row drops to the bottom alongside the
 * day's unsolved runs. The day's digest reads the same documents, so a post
 * that has not gone out yet will already agree.
 *
 * WHAT IT DOES NOT CHANGE unless you pass --reclaim: onRunCreated has
 * already paid the run out - wallet and careerBank by the score, and the
 * sprint counters and streak by one. Voiding the run does not claw any of
 * that back, so without --reclaim the player keeps the points and the
 * streak, and only the leaderboard row changes. --reclaim subtracts the
 * score from wallet and careerBank and steps sprintPlayed/sprintSolved back,
 * and says so for each one before it does.
 *
 * It will NOT touch sprintStreak or sprintBestStreak. A streak is a chain
 * across days and unpicking one day from the middle of it needs the whole
 * chain re-derived, which is a different job from this one.
 *
 * Idempotent: a run already marked voided is reported and left alone, so a
 * second run - or a --reclaim after a plain one - cannot charge twice.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient
 * service account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const RECLAIM = has("--reclaim");
const unknown = args.filter((a) => !/^--(dry-run|reclaim|handle=.*|date=.*|reason=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const HANDLE = val("--handle");
const DATE = val("--date");
const REASON = val("--reason") || "voided by operator";
if (!HANDLE) { console.error("--handle is required"); process.exit(1); }
if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error("--date=YYYY-MM-DD is required"); process.exit(1); }

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Matched on usernameLower, which is the field the game's own "already
// taken" check uses - so the handle typed here resolves the same way the
// handle typed in the game does, whatever its capitalisation.
const who = await db.collection("users")
  .where("usernameLower", "==", HANDLE.toLowerCase()).limit(2).get();
if (who.empty) { console.error(`no account with the handle ${HANDLE}`); process.exit(1); }
if (who.size > 1) { console.error(`${HANDLE} matches more than one account; refusing to guess`); process.exit(1); }
const uid = who.docs[0].id;
const user = who.docs[0].data();
console.log(`${HANDLE} -> ${uid}`);

const runRef = db.collection("runs").doc(`sprint_${uid}_${DATE}`);
const runSnap = await runRef.get();
if (!runSnap.exists) { console.error(`no Sprint run for ${HANDLE} on ${DATE}`); process.exit(1); }
const run = runSnap.data();

console.log(`\nthe run as it stands:`);
console.log(`  score       ${run.score}`);
console.log(`  elapsedMs   ${run.elapsedMs}`);
console.log(`  solved      ${run.wordsGuessed ? "yes" : "no"}`);
console.log(`  recorded    ${run.timestamp && run.timestamp.toDate ? run.timestamp.toDate().toISOString() : "?"}`);

if (run.voidedAt) {
  console.log(`\nalready voided (${run.voidedReason || "no reason recorded"}); nothing to do.`);
  process.exit(0);
}

const paid = Math.max(0, Number(run.score) || 0);
const solved = Math.max(0, Number(run.wordsGuessed) || 0) > 0;

console.log(`\nwill write to runs/sprint_${uid}_${DATE}:`);
console.log(`  score 0, elapsedMs null, guesses cleared, fails 1, voidedReason "${REASON}"`);
if (RECLAIM) {
  console.log(`will also adjust users/${uid}:`);
  console.log(`  wallet       ${user.wallet} -> ${Math.max(0, (Number(user.wallet) || 0) - paid)}  (-${paid})`);
  console.log(`  careerBank   ${user.careerBank} -> ${Math.max(0, (Number(user.careerBank) || 0) - paid)}  (-${paid})`);
  console.log(`  sprintPlayed -1${solved ? ", sprintSolved -1" : ""}`);
  console.log(`  streaks are LEFT ALONE - see the note at the top of this file`);
} else {
  console.log(`\nthe payout is NOT being reclaimed: ${paid} pts stay in the wallet and`);
  console.log(`career bank, and the sprint counters keep this run. Pass --reclaim to`);
  console.log(`take them back as well.`);
}

if (DRY) { console.log("\n--dry-run: nothing written"); process.exit(0); }

await db.runTransaction(async (tx) => {
  // Re-read inside the transaction: the check above was outside it, and two
  // runs of this tool at once must not both decide the run was unvoided.
  const fresh = await tx.get(runRef);
  if (!fresh.exists) throw new Error("the run disappeared while we were looking at it");
  if (fresh.data().voidedAt) throw new Error("already voided by something else; nothing written");

  tx.update(runRef, {
    score: 0,
    elapsedMs: null,
    wordsGuessed: 0,
    fails: 1,
    bestStreak: 0,
    guess1: 0, guess2: 0, guess3: 0, guess4: 0, guess5: 0,
    voidedAt: FieldValue.serverTimestamp(),
    voidedReason: REASON,
  });

  if (RECLAIM) {
    // set+merge, like every other write to a user document in this project:
    // an account can be deleted and leave its runs behind, and update() on a
    // missing document would fail the whole transaction.
    tx.set(db.collection("users").doc(uid), {
      wallet: FieldValue.increment(-paid),
      careerBank: FieldValue.increment(-paid),
      sprintPlayed: FieldValue.increment(-1),
      ...(solved ? { sprintSolved: FieldValue.increment(-1) } : {}),
    }, { merge: true });
  }
});

console.log(`\nvoided. The board reads this document directly, so a reload shows it at 0.`);
if (!RECLAIM) console.log(`The ${paid} pts were left where they are.`);
