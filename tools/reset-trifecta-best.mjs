#!/usr/bin/env node
/*
 * Clears the Hall of Fame's Trifecta board of everything that predates the
 * Trifecta.
 *
 *   node tools/reset-trifecta-best.mjs --dry-run
 *   node tools/reset-trifecta-best.mjs
 *
 * bestGauntletScore is each player's best single score on that mode, ever.
 * The mode was ten words, then seven, and is now three — so the board is
 * topped for good by runs nobody can match: ten words pay up to 5,000 and
 * three pay up to 1,500. A new player cannot reach the top of a board they
 * are allowed to see, which is worse than an empty one.
 *
 * DELETED, NOT ZEROED. Firestore's orderBy leaves out documents that lack the
 * ordered field, so deleting it takes a player off the board until they set a
 * real three-word best — exactly the property `mmr` is relied on for in
 * functions/index.js. Zeroing instead would fill the top hundred with players
 * tied at nothing.
 *
 * bestGauntletDate says which day each best came from, so this is precise: a
 * best already set on or after the epoch is a three-word score and is kept.
 * A stored best with no date at all predates that field and goes.
 *
 * Credentials come from GOOGLE_APPLICATION_CREDENTIALS or the ambient service
 * account (Cloud Shell, or a GitHub Action with the key in Secrets).
 */

// Must match TRIFECTA_EPOCH in index.html and functions/index.js.
export const TRIFECTA_EPOCH = "2026-11-04";

/*
 * Whether this player's stored Trifecta best belongs to the old mode.
 *
 * Exported and pure so the rule can be tested without a Firestore: the whole
 * risk here is deleting a best that was legitimately earned.
 */
export function isPreTrifectaBest(data, epoch = TRIFECTA_EPOCH) {
  const d = data || {};
  const score = Number(d.bestGauntletScore);
  // Nothing stored is nothing to clear.
  if (!Number.isFinite(score) || score <= 0) return false;
  const date = d.bestGauntletDate;
  // A best with no date predates the field that records one, so it cannot be
  // from the three-word era.
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
  return date < epoch;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const DRY = args.includes("--dry-run");
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

  const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  // Only players who have a best at all; everyone else is already off the board.
  const snap = await db.collection("users").orderBy("bestGauntletScore", "desc").get();
  console.log(`${snap.size} player(s) currently on the Trifecta board`);
  if (snap.empty) { console.log("nothing to do"); process.exit(0); }

  let cleared = 0, kept = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = db.batch();
    let inBatch = 0;
    for (const doc of chunk) {
      const d = doc.data();
      if (!isPreTrifectaBest(d, TRIFECTA_EPOCH)) {
        kept++;
        console.log(`  keep  ${doc.id}  ${d.bestGauntletScore} on ${d.bestGauntletDate}`);
        continue;
      }
      console.log(`  clear ${doc.id}  ${d.bestGauntletScore} on ${d.bestGauntletDate || "(no date)"}`);
      if (!DRY) {
        batch.update(doc.ref, {
          bestGauntletScore: FieldValue.delete(),
          bestGauntletDate: FieldValue.delete(),
        });
        inBatch++;
      }
      cleared++;
    }
    if (!DRY && inBatch) await batch.commit();
  }

  console.log(DRY
    ? `\n--dry-run: would clear ${cleared}, keep ${kept} already from the three-word era`
    : `\ncleared ${cleared} player(s), kept ${kept} already from the three-word era`);
}
