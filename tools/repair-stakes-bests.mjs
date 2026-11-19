#!/usr/bin/env node
/*
 * Recomputes the two Stakes board fields from the runs that actually exist.
 *
 *   node tools/repair-stakes-bests.mjs --dry-run
 *   node tools/repair-stakes-bests.mjs
 *   node tools/repair-stakes-bests.mjs --uid=abc123 --dry-run
 *
 * WHY THIS EXISTS, and why nothing else can do it.
 *
 * onRunCreated let Sprint, Marathon and Trifecta runs feed bestRunScore and
 * periodBestScore for as long as those fields existed. a2bcfaf closed that,
 * and its own message says what it left behind: "bestRunScore is an all-time
 * max and does not heal - a player whose stored best came from a Sprint or a
 * Trifecta keeps it until a real Stakes run beats it."
 *
 * That is the whole problem. EVERY path that writes these fields is
 * monotonic - the trigger, the refreshProfile backfill and
 * backfill-period-best.mjs all compare with > or max() and only ever raise.
 * They were built that way so two of them could run over the same account
 * without clobbering each other. The consequence is that a value which is too
 * HIGH is permanent, and a wrong row on the all-time board sits there for
 * good. Something has to be allowed to lower one, and this is the only thing
 * that is.
 *
 * THE OTHER DOOR, which is worse because it is silent: refreshProfile's
 * backfill is one-shot, flagged by bestsBackfilled. An account backfilled
 * BEFORE a2bcfaf got the old version, which took the best run of any mode -
 * and it carries bestsBackfilled: true, so the corrected backfill will never
 * run for it. Those accounts cannot repair themselves at any point in the
 * future. They are the ones this is for.
 *
 * WHAT IT CHANGES, per user, and only where the stored value disagrees:
 *   bestRunScore / bestRunAt              the best STAKES run, all time
 *   periodBestScore / Key / At            the best STAKES run in the window
 *                                         that is open right now
 * A player with no Stakes runs at all has the fields DELETED rather than
 * zeroed: the all-time board is an orderBy, which excludes documents missing
 * the field, so deleting takes them off a board they were never entitled to
 * be on. A zero would leave them on it with a zero.
 *
 * dayBestScore is not touched. It was guarded from the day it was written -
 * the comment in onRunCreated explaining why is the one the other two should
 * have had - so it was never contaminated.
 *
 * ONE PASS OVER /runs, grouped by uid, rather than a query per user: the
 * answer needs every run either way, and "Stakes" is the absence of a `mode`
 * field, which Firestore cannot index or query for. A negative list is the
 * only way to ask, and asking it client-side over one sweep is cheaper than
 * paging per account and hoping a Stakes run is near the top.
 *
 * Idempotent: a second run finds nothing to change. Safe to re-run after a
 * week rolls over, which is when the period half becomes a no-op anyway.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bestsFromRuns, repairFor } from "./stakes-bests.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const ONLY = val("--uid");
const unknown = args.filter((a) => !/^--(dry-run|uid=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

/*
 * isStakesRun and periodKeyFor are LIFTED from functions/index.js rather than
 * written again here. This program exists because a second copy of the mode
 * rule disagreed with the first; a third copy, in the thing sent to repair
 * the damage, would be the same mistake wearing a different hat. A rename
 * breaks the match and this exits loudly, having written nothing.
 */
const FN = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "functions", "index.js"), "utf8");
const lift = (name) => {
  const m = FN.match(new RegExp(`function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}`));
  if (!m) { console.error(`could not find ${name}() in functions/index.js - has it been renamed?`); process.exit(1); }
  return m[0];
};
const PERIOD = (FN.match(/const LEADERBOARD_PERIOD = "(\w+)"/) || [])[1];
if (!PERIOD) { console.error("could not read LEADERBOARD_PERIOD out of functions/index.js"); process.exit(1); }
const { isStakesRun, periodKeyFor } = new Function(
  `const LEADERBOARD_PERIOD = ${JSON.stringify(PERIOD)};
   ${lift("etParts")}\n${lift("periodKeyFor")}\n${lift("isStakesRun")}
   return { isStakesRun, periodKeyFor };`)();

// A bad lift must not be able to produce a confident wrong answer, so it is
// asked something with a known result before it is trusted with real runs.
{
  const bad = [];
  // Exactly the rule and nothing more. This shipped with [null, false] in
  // it, which the shipped function has never done - run && run.mode is null
  // for a null run, and null matches none of the three excluded modes, so it
  // comes back true. The tool then did what it promises and refused to touch
  // anything, over an expectation that was the probe's opinion rather than
  // the function's behaviour. A null run cannot reach this code anyway: the
  // sweep skips anything without a uid.
  for (const [run, want] of [[{}, true], [{ mode: "sprint" }, false], [{ mode: "marathon" }, false],
                             [{ mode: "daily" }, false], [{ mode: "endless" }, true]]) {
    if (isStakesRun(run) !== want) bad.push(`${JSON.stringify(run)} -> ${isStakesRun(run)}, wanted ${want}`);
  }
  // 2026-11-18 is a Wednesday; its week opened on Monday the 16th.
  const probe = periodKeyFor(new Date("2026-11-18T17:00:00Z"));
  const wantKey = PERIOD === "monthly" ? "2026-11" : "2026-11-16";
  if (probe !== wantKey) bad.push(`periodKeyFor -> ${probe}, wanted ${wantKey}`);
  if (bad.length) {
    console.error("the lifted rules failed their self-check; refusing to touch anything:");
    for (const b of bad) console.error("  " + b);
    process.exit(1);
  }
}

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const WINDOW = periodKeyFor(new Date());
console.log(`period: ${PERIOD}, window open now: ${WINDOW}${ONLY ? `  (uid ${ONLY} only)` : ""}\n`);

// ---- one sweep over /runs, grouped by player ------------------------------
const byUid = new Map();
let scanned = 0;
let q = db.collection("runs").orderBy("__name__").limit(2000);
if (ONLY) q = db.collection("runs").where("uid", "==", ONLY).limit(5000);
for (;;) {
  const snap = await q.get();
  if (snap.empty) break;
  for (const doc of snap.docs) {
    scanned++;
    const run = doc.data();
    if (!run || !run.uid) continue;
    if (!byUid.has(run.uid)) byUid.set(run.uid, []);
    byUid.get(run.uid).push(run);
  }
  if (ONLY || snap.size < 2000) break;
  q = db.collection("runs").orderBy("__name__").startAfter(snap.docs[snap.docs.length - 1]).limit(2000);
}
const truth = new Map();
for (const [uid, runs] of byUid) truth.set(uid, bestsFromRuns(runs, { isStakes: isStakesRun, periodKey: periodKeyFor, window: WINDOW }));
const withStakes = [...truth.values()].filter((t) => t.best).length;
console.log(`read ${scanned} run document(s) across ${byUid.size} player(s); ${withStakes} have a Stakes run\n`);

// ---- compare against what each user document says -------------------------
const userDocs = ONLY
  ? [await db.collection("users").doc(ONLY).get()].filter((d) => d.exists)
  : (await db.collection("users").get()).docs;

const fixes = [];
for (const doc of userDocs) {
  const r = repairFor(doc.data(), truth.get(doc.id), { window: WINDOW, del: FieldValue.delete() });
  if (r) fixes.push({ id: doc.id, name: (doc.data() || {}).username || doc.id, ...r });
}

if (!fixes.length) { console.log("nothing to repair; every stored best already matches the runs."); process.exit(0); }

console.log(`${fixes.length} player(s) to correct:\n`);
for (const f of fixes.slice(0, 40)) console.log(`  ${String(f.name).padEnd(18)} ${f.notes.join("; ")}`);
if (fixes.length > 40) console.log(`  ... and ${fixes.length - 40} more`);

if (DRY) { console.log("\n--dry-run: nothing written"); process.exit(0); }

// set+merge rather than update, like every other write to a user document in
// this project: an account can be deleted and leave its runs behind, and
// update() on a missing document fails the whole batch.
let written = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = db.batch();
  for (const f of fixes.slice(i, i + 400)) {
    batch.set(db.collection("users").doc(f.id), f.change, { merge: true });
  }
  await batch.commit();
  written += Math.min(400, fixes.length - i);
  console.log(`  committed ${written}/${fixes.length}`);
}
console.log(`\nrepaired ${written} player(s). Re-run with --dry-run to confirm it reads clean.`);
