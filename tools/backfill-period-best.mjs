#!/usr/bin/env node
/*
 * Seeds periodBestScore / periodBestKey / periodBestAt on user documents from
 * existing runs, so the recurring leaderboard is not empty on the day it ships.
 *
 *   node tools/backfill-period-best.mjs --dry-run
 *   node tools/backfill-period-best.mjs
 *   node tools/backfill-period-best.mjs --period=monthly   # match the app's setting
 *
 * onRunCreated maintains these fields from now on; this is only for runs that
 * predate it. It is idempotent and never lowers a stored value, so running it
 * twice is harmless — same guarantee as the bestRunScore backfill in
 * refreshProfile, and for the same reason.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
const PERIOD = val("--period") || "weekly";
if (!["weekly", "monthly"].includes(PERIOD)) { console.error("--period must be weekly or monthly"); process.exit(1); }
const unknown = args.filter((a) => !/^--(dry-run|period=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

// Deliberately a copy of functions/index.js's pair rather than an import:
// functions/ is CommonJS and deployed separately. tests/leaderboard-period
// pins all three copies (here, the function, the client) to the same answers.
function etParts(when) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when).split("-").map(Number);
  return { y, m, d };
}
function periodKeyFor(when, period) {
  const { y, m, d } = etParts(when);
  if (period === "monthly") return `${y}-${String(m).padStart(2, "0")}`;
  const utc = new Date(Date.UTC(y, m - 1, d));
  const back = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - back);
  return utc.toISOString().slice(0, 10);
}

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const key = periodKeyFor(new Date(), PERIOD);
console.log(`backfilling ${PERIOD} best for window ${key}`);

// Only runs inside the current window can contribute — an earlier window's best
// is not a score on this board.
const windowStart = PERIOD === "monthly"
  ? new Date(`${key}-01T00:00:00-05:00`)
  : new Date(`${key}T00:00:00-05:00`);
const snap = await db.collection("runs").where("timestamp", ">=", windowStart).get();
console.log(`${snap.size} run(s) since ${windowStart.toISOString()}`);

// Best run per player, and only runs the board would have counted: a wipeout
// scores 0 and onRunCreated requires score > 0, so this must agree or the
// backfill would seed rows the live path never would.
const best = new Map();
for (const doc of snap.docs) {
  const r = doc.data();
  const uid = r.uid;
  const score = Math.max(0, Number(r.score) || 0);
  if (!uid || score <= 0) continue;
  // Guard against a run whose own timestamp puts it in a different window than
  // the range query implies (clock skew at the boundary).
  if (r.timestamp && periodKeyFor(r.timestamp.toDate(), PERIOD) !== key) continue;
  const prev = best.get(uid);
  if (!prev || score > prev.score) best.set(uid, { score, at: r.timestamp || null });
}
console.log(`${best.size} player(s) with a qualifying run this window`);

let written = 0, skipped = 0;
const entries = [...best.entries()];
for (let i = 0; i < entries.length; i += 400) {
  const chunk = entries.slice(i, i + 400);
  const refs = chunk.map(([uid]) => db.collection("users").doc(uid));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let inBatch = 0;
  chunk.forEach(([uid, v], j) => {
    const cur = snaps[j];
    if (!cur.exists) { skipped++; return; }
    const d = cur.data();
    const stored = d.periodBestKey === key ? Math.max(0, Number(d.periodBestScore) || 0) : 0;
    if (v.score <= stored) { skipped++; return; }
    if (!DRY) {
      batch.update(cur.ref, { periodBestKey: key, periodBestScore: v.score, ...(v.at ? { periodBestAt: v.at } : {}) });
      inBatch++;
    }
    written++;
  });
  if (!DRY && inBatch) await batch.commit();
}
console.log(DRY
  ? `--dry-run: would update ${written}, leave ${skipped} alone`
  : `updated ${written} user document(s), left ${skipped} alone`);
