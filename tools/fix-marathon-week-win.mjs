#!/usr/bin/env node
/*
 * Re-settles a Marathon week's win against what the week's runs actually say.
 *
 *   node tools/fix-marathon-week-win.mjs --week=2026-11-09 --dry-run
 *   node tools/fix-marathon-week-win.mjs --week=2026-11-09
 *
 * WHY THIS EXISTS. postWeeklyDigest used to read the week's standings off
 * /users, where marathonKey holds the week a player is CURRENTLY on.
 * onRunCreated moves that field on their first word of a new week, and the
 * digest fires at 09:10 Monday - so any player who had already started the
 * new week was missing from the old one's results, and the win was settled
 * off that same truncated snapshot. The player most likely to be missing is
 * the one who came back first, which is to say the one most likely to have
 * won. The digest reads /runs now; this repairs the weeks settled before it
 * did.
 *
 * boardAwards claims are permanent by design - that is what stops a retried
 * schedule paying twice - so a week already settled will never correct
 * itself. Hence a tool, run by hand, that says what it found before it
 * changes anything.
 *
 * WHAT IT CHANGES:
 *   users/{uid}                  marathonWins, up for a player owed the win
 *                                and down for one credited it wrongly. Read
 *                                and clamped rather than blind-incremented,
 *                                so a counter cannot be driven below zero.
 *   boardAwards/marathon_{week}  winners rewritten to the true set, with
 *                                correctedAt and correctedFrom recording
 *                                what it used to say.
 *
 * It is idempotent: a week whose claim already matches the runs is reported
 * and left alone, so running it twice cannot double-count.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient
 * service account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as B from "./daily-board.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const unknown = args.filter((a) => !/^--(dry-run|week=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const WEEK = val("--week");
if (!WEEK || !/^\d{4}-\d{2}-\d{2}$/.test(WEEK)) { console.error("--week=YYYY-MM-DD is required"); process.exit(1); }
if (B.weekKeyET(WEEK) !== WEEK) {
  console.error(`--week must be a Monday; ${WEEK} belongs to the week of ${B.weekKeyET(WEEK)}`);
  process.exit(1);
}
const thisWeek = B.weekKeyET(B.dayKeyET(new Date()));
if (WEEK >= thisWeek) {
  console.error(`refusing ${WEEK}: that week is not over yet (this week is ${thisWeek} Eastern)`);
  process.exit(1);
}

/*
 * The reducer and the tie rule, LIFTED from functions/index.js rather than
 * written again here.
 *
 * tools/award-win.mjs keeps its own copy of awardBoardWin because the two
 * programs have different Firestore SDKs and the claim document is the
 * contract between them. These two are different: they are pure, they take
 * no SDK, and a second copy of them that drifted is the entire reason this
 * week needs repairing. Reading the shipped source means the correction is
 * computed by the same code the digest now runs.
 *
 * A rename breaks the match and this exits - loudly, having written
 * nothing - which is the failure mode to want.
 */
const FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "functions", "index.js"), "utf8");
const lift = (name) => {
  const m = FN.match(new RegExp(`function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}`));
  if (!m) { console.error(`could not find ${name}() in functions/index.js - has it been renamed?`); process.exit(1); }
  return m[0];
};
const { marathonStandings, topTied } = new Function(
  `${lift("marathonStandings")}\n${lift("topTied")}\nreturn { marathonStandings, topTied };`)();

// A bad lift must not be able to produce a confident wrong answer, so it is
// asked something with a known result before it is trusted with real runs.
{
  const probe = marathonStandings([
    { uid: "b", username: "B", marathonWords: 9, marathonScore: 400 },
    { uid: "a", username: "A", marathonWords: 3, marathonScore: 120 },
    { uid: "a", username: "A", marathonWords: 20, marathonScore: 900 },
  ]);
  const won = topTied(probe, (r) => r.marathonScore).map((r) => r.uid);
  if (probe.length !== 2 || won.length !== 1 || won[0] !== "a") {
    console.error("the lifted reducer failed its self-check; refusing to touch anything");
    console.error(`  got ${JSON.stringify(probe)} / winners ${JSON.stringify(won)}`);
    process.exit(1);
  }
}

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Only marathon runs carry marathonKey, so one equality filter is the whole
// query - the same one postWeeklyDigest makes.
const runSnap = await db.collection("runs").where("marathonKey", "==", WEEK).limit(5000).get();
const standings = marathonStandings(runSnap.docs);
if (!standings.length) { console.error(`no Marathon runs for the week of ${WEEK}; nothing to settle`); process.exit(1); }

const correct = topTied(standings, (r) => r.marathonScore).map((r) => r.uid);

console.log(`week of ${WEEK}: ${runSnap.size} run document(s), ${standings.length} player(s)\n`);
console.log("the week as its runs tell it:");
for (const [i, r] of standings.slice(0, 10).entries()) {
  console.log(`  #${i + 1}  ${String(r.username || r.uid).padEnd(16)} ${String(r.marathonWords).padStart(2)}w  ${String(r.marathonScore).padStart(6)}`
    + (correct.includes(r.uid) ? "   <- the win" : ""));
}

const awardRef = db.collection("boardAwards").doc(`marathon_${WEEK}`);
const awardSnap = await awardRef.get();
if (!awardSnap.exists) {
  console.error(`\nno claim for marathon_${WEEK}. This tool repairs a settled week;`);
  console.error(`an unsettled one is the digest's own job and it will take it.`);
  process.exit(1);
}
const stored = (awardSnap.data().winners || []).filter(Boolean);

const nameOf = new Map(standings.map((r) => [r.uid, r.username || r.uid]));
const show = (uids) => uids.length ? uids.map((u) => `${nameOf.get(u) || "(unknown)"} [${u}]`).join(", ") : "(nobody)";
console.log(`\ncredited at the time : ${show(stored)}`);
console.log(`the runs say         : ${show(correct)}`);

const wrong = stored.filter((u) => !correct.includes(u));
const missing = correct.filter((u) => !stored.includes(u));
if (!wrong.length && !missing.length) {
  console.log(`\nalready correct; nothing to do.`);
  process.exit(0);
}
console.log(`\n  take a win from : ${show(wrong)}`);
console.log(`  give a win to   : ${show(missing)}`);

if (DRY) { console.log("\n--dry-run: nothing written"); process.exit(0); }

const touched = [...new Set([...wrong, ...missing])];
const result = await db.runTransaction(async (tx) => {
  // Re-read the claim inside the transaction: the comparison above was made
  // outside it, and two runs of this tool at once must not both decide the
  // same correction is still owed.
  const fresh = await tx.get(awardRef);
  const freshStored = ((fresh.exists && fresh.data().winners) || []).filter(Boolean);
  if (JSON.stringify([...freshStored].sort()) !== JSON.stringify([...stored].sort())) {
    throw new Error("the claim changed while we were looking at it; nothing written");
  }

  const refs = touched.map((uid) => db.collection("users").doc(uid));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  const moves = [];
  snaps.forEach((snap, i) => {
    const uid = touched[i];
    // A player can delete their account and leave their runs behind. There
    // is nothing to adjust on a document that is gone, and set+merge would
    // conjure one holding a single counter.
    if (!snap.exists) { moves.push(`${uid}: no account any more, skipped`); return; }
    const now = Math.max(0, Number(snap.data().marathonWins) || 0);
    const next = Math.max(0, now + (missing.includes(uid) ? 1 : -1));
    tx.update(snap.ref, { marathonWins: next });
    moves.push(`${nameOf.get(uid) || uid}: marathonWins ${now} -> ${next}`);
  });

  tx.set(awardRef, {
    mode: "marathon",
    key: WEEK,
    winners: correct,
    at: fresh.exists ? fresh.data().at : FieldValue.serverTimestamp(),
    correctedAt: FieldValue.serverTimestamp(),
    correctedFrom: stored,
  });
  return moves;
});

console.log("");
for (const m of result) console.log(`  ${m}`);
console.log(`\nclaim marathon_${WEEK} rewritten to ${show(correct)}.`);
console.log(`correctedFrom records what it used to say, so this stays auditable.`);
