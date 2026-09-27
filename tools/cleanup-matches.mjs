#!/usr/bin/env node
/*
 * Deletes match documents that are finished with.
 *
 * Everything that DECIDES what goes lives in match-cleanup.mjs and is tested
 * against fixtures. This file only reads and deletes.
 *
 *   node tools/cleanup-matches.mjs --dry-run            see what would go
 *   node tools/cleanup-matches.mjs                      delete aged-out matches
 *   node tools/cleanup-matches.mjs --retention-hours=48
 *   node tools/cleanup-matches.mjs --legacy --dry-run   include pre-createdAt docs
 *
 * --legacy is for the one-off sweep of documents created before matches
 * carried a createdAt. The recurring job runs WITHOUT it, so the scheduled
 * path never has to guess at a live match's age. Run the legacy sweep with
 * --dry-run first; once it has been done, it never needs doing again.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
import * as C from "./match-cleanup.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const LEGACY = has("--legacy");
const RETENTION = val("--retention-hours") === null ? C.DEFAULT_RETENTION_HOURS : Number(val("--retention-hours"));
if (!Number.isFinite(RETENTION) || RETENTION < 0) { console.error("--retention-hours must be a non-negative number"); process.exit(1); }

const unknown = args.filter((a) => !/^--(dry-run|legacy|retention-hours=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const snap = await db.collection("matches").get();
const matches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const plan = C.planMatchCleanup(matches, new Date(), { retentionHours: RETENTION, legacy: LEGACY });

console.log(`matches: ${plan.counts.total} total · ${plan.counts.del} to delete · ${plan.counts.keep} kept`
  + `  (retention ${plan.retentionHours}h${LEGACY ? ", legacy sweep" : ""})`);

// Grouped, because a per-document line is unreadable once there are hundreds
// and the reasons are what tell you whether the plan is right.
const tally = (rows) => {
  const by = new Map();
  for (const r of rows) {
    const k = r.reason.replace(/\(\d+[hm] old\)/, "(…)");
    by.set(k, (by.get(k) || 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
};
for (const [reason, n] of tally(plan.del)) console.log(`  delete  ${String(n).padStart(5)}  ${reason}`);
for (const [reason, n] of tally(plan.keep)) console.log(`  keep    ${String(n).padStart(5)}  ${reason}`);

if (DRY) { console.log("\n--dry-run: nothing deleted"); process.exit(0); }
if (!plan.del.length) { console.log("\nnothing to delete"); process.exit(0); }

let done = 0;
for (const chunk of C.batches(plan.del)) {
  const batch = db.batch();
  for (const row of chunk) batch.delete(db.collection("matches").doc(row.id));
  await batch.commit();
  done += chunk.length;
  console.log(`  deleted ${done}/${plan.del.length}`);
}
console.log(`\ndeleted ${done} match document(s)`);
