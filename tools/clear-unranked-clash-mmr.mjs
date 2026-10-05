#!/usr/bin/env node
/*
 * One-shot sweep: takes the seeded `mmr: 1000` back off profiles that have
 * never played a Clash match, so the Clash leaderboard lists players instead
 * of accounts.
 *
 *   node tools/clear-unranked-clash-mmr.mjs --dry-run
 *   node tools/clear-unranked-clash-mmr.mjs
 *
 * Why this exists: the board is `orderBy("mmr", "desc") limit(100)`, and
 * Firestore's orderBy leaves out documents that do not carry the field — which
 * is how the FFA board has only ever listed players with an ffaMmr. Clash
 * seeded every new profile at 1000 instead, so every account that ever opened
 * the page sat on the ladder at the base rating. At a hundred accounts that
 * reads as a board of ties; past a hundred it is worse than cosmetic, because
 * the wall of 1000s fills the limit and pushes every player BELOW 1000 off the
 * page entirely.
 *
 * onMatchFinished mints the rating on a player's first public match now, and
 * refreshProfile clears an unearned one on sign-in — which covers everyone who
 * comes back. This is for the accounts that do not.
 *
 * What it will not touch: any rating that is not exactly 1000, and any profile
 * with a non-zero Clash record. A player who has played and happens to sit on
 * the base rating keeps it; so does a player whose only matches were private
 * (those move the record but not the rating). Erring toward keeping someone on
 * the board is the right way to be wrong here.
 *
 * Idempotent — a second run finds nothing left to do.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const unknown = args.filter((a) => a !== "--dry-run");
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();

// Only the base rating can be unearned, so query for it rather than reading
// every user document. This is the automatic single-field index the board
// already uses.
const snap = await db.collection("users").where("mmr", "==", 1000).get();
console.log(`${snap.size} profile(s) sitting on the base rating`);

const clear = [];
let played = 0;
for (const d of snap.docs) {
  const u = d.data();
  const matches = (u.clashWins || 0) + (u.clashLosses || 0) + (u.clashTies || 0);
  if (matches > 0) { played++; continue; }
  clear.push(d.ref);
}
console.log(`${played} of them have a Clash record and keep their rating`);

if (!DRY) {
  for (let i = 0; i < clear.length; i += 400) {
    const batch = db.batch();
    clear.slice(i, i + 400).forEach((ref) => batch.update(ref, { mmr: FieldValue.delete() }));
    await batch.commit();
  }
}
console.log(DRY
  ? `--dry-run: would clear ${clear.length} unearned rating(s)`
  : `cleared ${clear.length} unearned rating(s) — the Clash board now lists players only`);
