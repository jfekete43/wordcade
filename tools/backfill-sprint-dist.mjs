#!/usr/bin/env node
/*
 * Seeds sprintG1..sprintG5 on user documents from existing Sprint runs, so the
 * guess distribution on the end-of-round screen is not empty for everyone who
 * played before those counters existed.
 *
 *   node tools/backfill-sprint-dist.mjs --dry-run
 *   node tools/backfill-sprint-dist.mjs
 *
 * onRunCreated maintains them from now on. Without this, every Sprint played
 * before that deploy is missing from its player's distribution permanently:
 * the trigger fires once, at creation, and there is no second chance to count
 * a run.
 *
 * SETS rather than increments — see tools/sprint-dist.mjs for why that is the
 * whole design, and what makes this safe to run twice.
 *
 * It only touches sprintG1..sprintG5. sprintPlayed and sprintSolved are
 * already correct and are what the chart's X row is derived from, so
 * recomputing them here could only introduce a disagreement: a run since
 * deleted from /runs would silently lower a career total that genuinely
 * happened.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
import { foldSprintRuns, sprintRowMatches, sprintRowUpdate } from "./sprint-dist.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const unknown = args.filter((a) => a !== "--dry-run");
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const snap = await db.collection("runs").where("mode", "==", "sprint").get();
console.log(`${snap.size} Sprint run(s) found`);
if (snap.empty) { console.log("nothing to do"); process.exit(0); }

const byUid = foldSprintRuns(snap.docs.map((d) => d.data()));
const solves = [...byUid.values()].reduce((a, row) => a + row.reduce((b, n) => b + n, 0), 0);
console.log(`${byUid.size} player(s), ${solves} solve(s); the ${snap.size - solves} miss(es) are the X row, derived elsewhere`);

let written = 0, skipped = 0, unchanged = 0;
const entries = [...byUid.entries()];
for (let i = 0; i < entries.length; i += 400) {
  const chunk = entries.slice(i, i + 400);
  const refs = chunk.map(([uid]) => db.collection("users").doc(uid));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let inBatch = 0;
  chunk.forEach(([uid, row], j) => {
    const cur = snaps[j];
    // A departed account is not an error: its runs stay on the board under the
    // name they were written with, but there is no document to credit.
    if (!cur.exists) { skipped++; return; }
    if (sprintRowMatches(cur.data(), row)) { unchanged++; return; }
    const was = [1, 2, 3, 4, 5].map((k) => Number(cur.data()["sprintG" + k]) || 0);
    console.log(`  ${uid}  ${row.join("/")}  (was ${was.join("/")})`);
    if (!DRY) { batch.update(cur.ref, sprintRowUpdate(row)); inBatch++; }
    written++;
  });
  if (!DRY && inBatch) await batch.commit();
}

console.log(DRY
  ? `\n--dry-run: would update ${written}, leave ${unchanged} already correct, skip ${skipped} missing`
  : `\nupdated ${written} user document(s), left ${unchanged} already correct, skipped ${skipped} missing`);
