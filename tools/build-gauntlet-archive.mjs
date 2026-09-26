#!/usr/bin/env node
/*
 * Builds the static Gauntlet archive under /gauntlet/ from Firestore.
 *
 * Everything that decides WHAT a page says lives in
 * gauntlet-archive-render.mjs and is tested against fixtures. This file only
 * reads and writes: it has no rules of its own beyond refusing to publish a
 * day the renderer says is not publishable.
 *
 *   node tools/build-gauntlet-archive.mjs --all          backfill everything
 *   node tools/build-gauntlet-archive.mjs                yesterday only
 *   node tools/build-gauntlet-archive.mjs --date=2026-09-24
 *   node tools/build-gauntlet-archive.mjs --all --dry-run
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient
 * service account (Cloud Shell, or a GitHub Action with the key in Secrets).
 *
 * Reads per day: one dailyPuzzles doc, one runs query, and one
 * dailyAttempts doc per player who finished. A deliberately boring shape —
 * no collection-group query and so no extra index to deploy.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as R from "./gauntlet-archive-render.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "gauntlet");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const DRY = has("--dry-run");
// A day nobody finished renders as ten words and "Nobody finished this one",
// and unlike the rest of the archive it can never improve — a past Gauntlet
// cannot be played retroactively, so its run count is final the moment the
// day ends. Those pages are permanently thin, so they are skipped by default.
// --min-players=0 publishes them anyway.
const MIN_PLAYERS = val("--min-players") === null ? 1 : Math.max(0, Number(val("--min-players")));
if (!Number.isFinite(MIN_PLAYERS)) { console.error("--min-players must be a number"); process.exit(1); }

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const now = new Date();

// Which days to build.
let dates;
const one = val("--date");
if (one) {
  if (!R.isPublishable(one, now)) {
    console.error(`refusing ${one}: not a finished Gauntlet day in Eastern (today is ${R.etDateStr(now)})`);
    process.exit(1);
  }
  dates = [one];
} else if (has("--all")) {
  dates = R.publishableDates(now);
} else {
  const yesterday = R.shiftDate(R.etDateStr(now), -1);
  dates = R.isPublishable(yesterday, now) ? [yesterday] : [];
}
console.log(`today in ET is ${R.etDateStr(now)}; building ${dates.length} day(s), minimum ${MIN_PLAYERS} player(s)`);

async function loadDay(date) {
  const puzzle = await db.collection("dailyPuzzles").doc(date).get();
  if (!puzzle.exists) return null;
  const words = (puzzle.data().words || []).map((w) => String(w).toUpperCase());
  if (words.length === 0) return null;

  const runsSnap = await db.collection("runs")
    .where("mode", "==", "daily").where("puzzleDate", "==", date)
    .orderBy("score", "desc").get();
  const runs = runsSnap.docs.map((d) => {
    const r = d.data();
    return { uid: r.uid, username: r.username, score: r.score, wordsGuessed: r.wordsGuessed };
  });

  // Per-word detail lives on each player's own attempt document. Fetched by
  // id from the uids the runs query already returned, rather than a
  // collection-group query — same reads, no new index. Only finished runs
  // have a /runs doc, so an abandoned attempt never skews a word's numbers.
  const attempts = [];
  for (let i = 0; i < runs.length; i += 300) {
    const chunk = runs.slice(i, i + 300);
    const refs = chunk.map((r) => db.collection("dailyAttempts").doc(r.uid).collection("days").doc(date));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists && Array.isArray(s.data().history)) attempts.push(s.data().history);
  }

  return { date, words, runs, attempts };
}

const built = [];
for (const date of dates) {
  if (!R.isPublishable(date, now)) { console.log(`  skip ${date} (not finished)`); continue; }
  const day = await loadDay(date);
  if (!day) { console.log(`  skip ${date} (no puzzle stored)`); continue; }
  if (!R.shouldPublish(day.runs.length, MIN_PLAYERS)) {
    console.log(`  skip ${date}  #${R.gauntletNumber(date)}  ${day.runs.length} runs (below ${MIN_PLAYERS})`);
    continue;
  }
  built.push(day);
  console.log(`  ${date}  #${R.gauntletNumber(date)}  ${day.runs.length} runs, ${day.attempts.length} attempts`);
}

if (!built.length && !has("--all")) { console.log("nothing to build"); process.exit(0); }

// Newest first for the hub; prev/next wired across the whole built set.
built.sort((a, b) => (a.date < b.date ? -1 : 1));
for (let i = 0; i < built.length; i++) {
  built[i].prev = i > 0 ? built[i - 1].date : null;
  built[i].next = i < built.length - 1 ? built[i + 1].date : null;
}

const write = (rel, body) => {
  const full = path.join(REPO, rel);
  if (DRY) { console.log(`  [dry-run] ${rel} (${body.length} bytes)`); return; }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  console.log(`  wrote ${rel} (${body.length} bytes)`);
};

for (const day of built) write(path.join("gauntlet", day.date, "index.html"), R.renderDayPage(day));

// Pages written under an older, lower threshold would otherwise linger:
// absent from the hub but still reachable and still in the sitemap. Only a
// full run prunes, because only a full run knows the whole set — a
// single-day run cannot tell whether the other days on disk still qualify.
if (has("--all") && fs.existsSync(OUT)) {
  const existing = fs.readdirSync(OUT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const plan = R.planPrune(existing, built.map((d) => d.date));
  if (plan.refuse) {
    console.error(`refusing to prune: ${plan.reason}.`);
    console.error("If that is really intended, delete gauntlet/ by hand and re-run.");
    process.exit(1);
  }
  for (const dir of plan.remove) {
    if (DRY) { console.log(`  [dry-run] would remove gauntlet/${dir}/`); continue; }
    fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
    console.log(`  removed gauntlet/${dir}/ (no longer qualifies)`);
  }
}

// The hub covers everything on disk, not just what this run rebuilt, so a
// single-day run does not shrink it back to one row.
const onDisk = fs.existsSync(OUT)
  ? fs.readdirSync(OUT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(OUT, d, "index.html")))
  : [];
const known = new Map();
for (const d of onDisk) known.set(d, { date: d, players: 0, perfect: 0, topScore: 0 });
for (const day of built) {
  const dist = R.computeDistribution(day.runs);
  known.set(day.date, {
    date: day.date,
    players: day.runs.length,
    perfect: dist[R.WORD_COUNT],
    topScore: day.runs.length ? Math.max(...day.runs.map((r) => r.score || 0)) : 0,
  });
}
// A day already on disk but not rebuilt this run keeps its headline numbers
// by re-reading them out of its own page, so the hub never blanks a row.
for (const [date, row] of known) {
  if (row.players || !fs.existsSync(path.join(OUT, date, "index.html"))) continue;
  const html = fs.readFileSync(path.join(OUT, date, "index.html"), "utf8");
  const grab = (label) => {
    const m = html.match(new RegExp(`<div>${label}<b>([\\d,]+)</b></div>`));
    return m ? Number(m[1].replace(/,/g, "")) : 0;
  };
  row.players = grab("Players"); row.perfect = grab("Perfect"); row.topScore = grab("Top score");
}
const hubDays = [...known.values()].sort((a, b) => (a.date > b.date ? -1 : 1));
write(path.join("gauntlet", "index.html"), R.renderHubPage(hubDays));

const sitemapPath = path.join(REPO, "sitemap.xml");
write("sitemap.xml", R.renderSitemap(fs.readFileSync(sitemapPath, "utf8"), hubDays));

console.log(`done: ${built.length} page(s) built, ${hubDays.length} in the archive`);
