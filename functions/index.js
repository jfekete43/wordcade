/**
 * Lexathon / Wordcade — server-side score & economy validation.
 *
 * The client (index.html) reports what happened — a finished run, a match
 * outcome, a purchase/claim request — but every write that changes wallet,
 * careerBank, mmr, win/loss records, career+daily stat counters, inventory,
 * or username happens HERE, using the Admin SDK (which bypasses
 * firestore.rules entirely). The client no longer has a path to write those
 * fields directly — see firestore.rules, which enforces that at the
 * database level as a backstop in case a function ever gets bypassed.
 *
 * Deploy: firebase deploy --only functions  (requires the Blaze plan).
 */

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ============================================================================
// Server-side source of truth. Keep in sync with the display copies in
// index.html — those are for rendering only; these are what's trusted.
// ============================================================================

const SHOP_ITEMS = {
  titles: [
    { id: "title_none", cost: 0 },
    { id: "title_rookie", cost: 500 },
    { id: "title_hacker", cost: 2500 },
    { id: "title_speedrunner", cost: 3000 },
    { id: "title_grid", cost: 4000 },
    { id: "title_pixel", cost: 5000 },
    { id: "title_synth", cost: 6000 },
    { id: "title_wizard", cost: 7500 },
    { id: "title_overclocked", cost: 8000 },
    { id: "title_glitch", cost: 8500 },
    { id: "title_lex", cost: 10000 },
    { id: "title_algorithm", cost: 12500 },
    { id: "title_finalboss", cost: 15000 },
    { id: "title_sentient", cost: 25000 },
    { id: "title_missingno", cost: 50000 },
  ],
  banners: [
    { id: "banner_default", cost: 0 },
    { id: "banner_cyan", cost: 2500 },
    { id: "banner_magenta", cost: 2500 },
    { id: "banner_8bit", cost: 5000 },
    { id: "banner_scanline", cost: 7500 },
    { id: "banner_grid", cost: 10000 },
    { id: "banner_matrix", cost: 12500 },
    { id: "banner_vaporwave", cost: 15000 },
    { id: "banner_galactic", cost: 17500 },
    { id: "banner_carbon", cost: 20000 },
    { id: "banner_neoncity", cost: 22500 },
    { id: "banner_champ", cost: 25000 },
  ],
  effects: [
    { id: "effect_none", cost: 0 },
    { id: "effect_pulse", cost: 5000 },
    { id: "effect_glitch", cost: 10000 },
    { id: "effect_electric", cost: 12500 },
    { id: "effect_hologram", cost: 15000 },
    { id: "effect_fire", cost: 20000 },
    { id: "effect_void", cost: 22500 },
    { id: "effect_golden", cost: 50000 },
  ],
};

const CHALLENGES = {
  daily_pool: [
    { id: "d_warmup", req: 5, field: "played", reward: 1000 },
    { id: "d_doubletap", req: 2, field: "guess2", reward: 2500 },
    { id: "d_grind", req: 20, field: "guessed", reward: 5000 },
    { id: "d_sweat", req: 3, field: "guess4", reward: 3000 },
    { id: "d_clutch", req: 1, field: "guess5", reward: 2500 },
    { id: "d_marathon", req: 30, field: "played", reward: 7500 },
    { id: "d_flawless", req: 1, field: "guess1", reward: 5000 },
  ],
  career: [
    { id: "c_homerun", req: 1, field: "guess1", reward: 10000 },
    { id: "c_silverslugger", req: 50, field: "guess2", reward: 15000 },
    { id: "c_rookie", req: 50, field: "totalWordsGuessed", reward: 5000 },
    { id: "c_gemmint", req: 500, field: "totalWordsGuessed", reward: 25000 },
    { id: "c_hof", req: 2500, field: "totalWordsGuessed", reward: 100000 },
    { id: "c_heavyhitter", req: 1000, field: "wordsPlayed", reward: 50000 },
    { id: "c_arcadechamp", req: 5000, field: "wordsPlayed", reward: 200000 },
    { id: "c_top10daily", req: 1, field: "achievedTop10Daily", reward: 25000 },
    { id: "c_kobe", req: 1, field: "kobeCount", reward: 5000 },
    { id: "c_closer_elite", req: 50, field: "kobeCount", reward: 75000 },
  ],
};

const DEFAULT_INVENTORY = ["title_none", "skin_default", "banner_default", "effect_none"];
const DEFAULT_EQUIPPED = { title: "title_none", skin: "skin_default", banner: "banner_default", effect: "effect_none" };

// UTC calendar-day string (YYYY-MM-DD). Must match index.html's
// getTodayDateStr() exactly, since this is the sole source of truth for
// when daily challenges/stats roll over.
function getTodayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function freshDailyStats(today) {
  const shuffled = [...CHALLENGES.daily_pool].sort(() => 0.5 - Math.random());
  return {
    date: today,
    played: 0,
    guessed: 0,
    guess1: 0,
    guess5: 0,
    claimed: [],
    activeIds: shuffled.slice(0, 3).map((c) => c.id),
  };
}

// Elo Rating Logic: change = K * (Actual - Expected). Mirrors the math the
// client used to run itself — the only difference is it now runs once,
// here, instead of being self-reported by whichever player's client got
// there first.
function calculateEloChange(myMMR, opponentMMR, iWon) {
  const expected = 1 / (1 + Math.pow(10, (opponentMMR - myMMR) / 400));
  return Math.round(32 * ((iWon ? 1 : 0) - expected));
}

// ============================================================================
// Standard-mode run payout. Triggered by the client creating a `runs` doc
// (bounds on its fields are enforced by firestore.rules before this ever
// runs). Applies wallet/careerBank, every stat counter, and the daily-
// challenge rollover, atomically and exactly once.
// ============================================================================
exports.onRunCreated = onDocumentCreated("runs/{runId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const run = snap.data();
  if (!run || !run.uid) return;

  const userRef = db.collection("users").doc(run.uid);
  const runRef = snap.ref;

  await db.runTransaction(async (tx) => {
    const [runSnap, userSnap] = await Promise.all([tx.get(runRef), tx.get(userRef)]);
    if (!runSnap.exists || runSnap.data().payoutApplied) return; // already processed (retry-safe)
    if (!userSnap.exists) return;

    const user = userSnap.data();
    const today = getTodayDateStr();
    const daily = user.dailyStats && user.dailyStats.date === today ? user.dailyStats : freshDailyStats(today);

    const score = Math.max(0, Number(run.score) || 0);
    const wordsGuessed = Math.max(0, Number(run.wordsGuessed) || 0);
    const wordsPlayed = Math.max(0, Number(run.wordsPlayed) || 0);
    const g1 = Math.max(0, Number(run.guess1) || 0);
    const g2 = Math.max(0, Number(run.guess2) || 0);
    const g3 = Math.max(0, Number(run.guess3) || 0);
    const g4 = Math.max(0, Number(run.guess4) || 0);
    const g5 = Math.max(0, Number(run.guess5) || 0);
    const fails = Math.max(0, Number(run.fails) || 0);
    const kobe = Math.max(0, Number(run.kobeCount) || 0);

    tx.update(userRef, {
      wallet: FieldValue.increment(score),
      careerBank: FieldValue.increment(score),
      totalWordsGuessed: FieldValue.increment(wordsGuessed),
      wordsPlayed: FieldValue.increment(wordsPlayed),
      guess1: FieldValue.increment(g1),
      guess2: FieldValue.increment(g2),
      guess3: FieldValue.increment(g3),
      guess4: FieldValue.increment(g4),
      guess5: FieldValue.increment(g5),
      fails: FieldValue.increment(fails),
      kobeCount: FieldValue.increment(kobe),
      dailyStats: {
        date: today,
        played: (daily.played || 0) + wordsPlayed,
        guessed: (daily.guessed || 0) + wordsGuessed,
        guess1: (daily.guess1 || 0) + g1,
        guess5: (daily.guess5 || 0) + g5,
        claimed: daily.claimed || [],
        activeIds: daily.activeIds || freshDailyStats(today).activeIds,
      },
    });
    tx.update(runRef, { payoutApplied: true });
  });
});

// ============================================================================
// Clash-mode match resolution. Triggered when a match doc's status flips to
// 'finished' (either client can request that — see finishMatch() in
// index.html — but neither client decides the MMR/wallet outcome anymore).
// ============================================================================
exports.onMatchFinished = onDocumentUpdated("matches/{matchId}", async (event) => {
  const after = event.data.after.data();
  const before = event.data.before.data();
  if (!after || after.status !== "finished" || (before && before.status === "finished")) return;
  if (!after.hostUid || !after.guestUid) return; // never actually matched — nothing to pay out

  const matchRef = event.data.after.ref;
  const hostRef = db.collection("users").doc(after.hostUid);
  const guestRef = db.collection("users").doc(after.guestUid);

  await db.runTransaction(async (tx) => {
    const [matchSnap, hostSnap, guestSnap] = await Promise.all([tx.get(matchRef), tx.get(hostRef), tx.get(guestRef)]);
    if (!matchSnap.exists || matchSnap.data().payoutApplied) return; // already processed (retry-safe)
    if (!hostSnap.exists || !guestSnap.exists) return;

    const match = matchSnap.data();
    const isTie = match.winner === null || match.winner === undefined;
    const hostWon = !isTie && match.winner === match.hostUid;
    const isPublicMatch = match.isPublic === true;

    const hostData = hostSnap.data();
    const guestData = guestSnap.data();
    const hostMMR = hostData.mmr || 1000;
    const guestMMR = guestData.mmr || 1000;

    let hostChange = 0;
    if (isPublicMatch && !isTie) hostChange = calculateEloChange(hostMMR, guestMMR, hostWon);
    const guestChange = isTie ? 0 : -hostChange;

    const newHostMmr = Math.max(0, hostMMR + hostChange);
    const newGuestMmr = Math.max(0, guestMMR + guestChange);

    const hostUpdate = { mmr: newHostMmr };
    const guestUpdate = { mmr: newGuestMmr };
    if (!isTie) {
      hostUpdate.clashWins = FieldValue.increment(hostWon ? 1 : 0);
      hostUpdate.clashLosses = FieldValue.increment(hostWon ? 0 : 1);
      guestUpdate.clashWins = FieldValue.increment(hostWon ? 0 : 1);
      guestUpdate.clashLosses = FieldValue.increment(hostWon ? 1 : 0);
      if (hostWon) { hostUpdate.wallet = FieldValue.increment(1000); hostUpdate.careerBank = FieldValue.increment(1000); }
      else { guestUpdate.wallet = FieldValue.increment(1000); guestUpdate.careerBank = FieldValue.increment(1000); }
    } else {
      hostUpdate.clashTies = FieldValue.increment(1);
      guestUpdate.clashTies = FieldValue.increment(1);
    }

    tx.update(hostRef, hostUpdate);
    tx.update(guestRef, guestUpdate);
    tx.update(matchRef, { hostChange, guestChange, payoutApplied: true });
  });
});

// ============================================================================
// Callable functions (client calls these via httpsCallable instead of
// writing Firestore directly).
// ============================================================================

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  return request.auth.uid;
}

exports.claimChallenge = onCall(async (request) => {
  const uid = requireAuth(request);
  const { id, type } = request.data || {};
  if (typeof id !== "string" || (type !== "daily" && type !== "career")) {
    throw new HttpsError("invalid-argument", "Bad challenge request.");
  }
  const pool = type === "daily" ? CHALLENGES.daily_pool : CHALLENGES.career;
  const chal = pool.find((c) => c.id === id);
  if (!chal) throw new HttpsError("not-found", "Unknown challenge.");

  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
    const data = snap.data();

    if (type === "daily") {
      const today = getTodayDateStr();
      const daily = data.dailyStats || {};
      if (daily.date !== today) throw new HttpsError("failed-precondition", "Daily challenges have reset — reopen the menu.");
      if ((daily.claimed || []).includes(id)) throw new HttpsError("already-exists", "Already claimed.");
      if (!(daily.activeIds || []).includes(id)) throw new HttpsError("failed-precondition", "Not one of today's active challenges.");
      if ((daily[chal.field] || 0) < chal.req) throw new HttpsError("failed-precondition", "Challenge not complete yet.");
      tx.update(userRef, {
        wallet: FieldValue.increment(chal.reward),
        "dailyStats.claimed": [...(daily.claimed || []), id],
      });
    } else {
      const claimedCareer = data.claimedCareer || [];
      if (claimedCareer.includes(id)) throw new HttpsError("already-exists", "Already claimed.");
      if ((data[chal.field] || 0) < chal.req) throw new HttpsError("failed-precondition", "Challenge not complete yet.");
      tx.update(userRef, {
        wallet: FieldValue.increment(chal.reward),
        claimedCareer: [...claimedCareer, id],
      });
    }
    return { reward: chal.reward };
  });
});

exports.purchaseItem = onCall(async (request) => {
  const uid = requireAuth(request);
  const { itemId, category } = request.data || {};
  const items = SHOP_ITEMS[category];
  if (!items) throw new HttpsError("invalid-argument", "Unknown category.");
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new HttpsError("not-found", "Unknown item.");

  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
    const data = snap.data();
    const inventory = data.inventory || [];
    if (inventory.includes(item.id)) throw new HttpsError("already-exists", "Already owned.");
    const wallet = data.wallet || 0;
    if (wallet < item.cost) throw new HttpsError("failed-precondition", "Not enough points in your Wallet!");
    tx.update(userRef, {
      wallet: FieldValue.increment(-item.cost),
      inventory: [...inventory, item.id],
    });
    return { wallet: wallet - item.cost };
  });
});

exports.changeUsername = onCall(async (request) => {
  const uid = requireAuth(request);
  const raw = (request.data && request.data.username) || "";
  const name = String(raw)
    .replace(/[^a-zA-Z0-9_\s-]/g, "")
    .trim()
    .substring(0, 12);
  if (name.length < 3) throw new HttpsError("invalid-argument", "Arcade Handle must be at least 3 valid characters long.");

  // Best-effort uniqueness check. Firestore transactions can't safely query
  // *other* documents by field value, so this narrows the collision window
  // rather than eliminating it outright — a true guarantee would need a
  // dedicated `usernames/{name}` reservation doc, which is a reasonable
  // follow-up if handle squatting/collisions turn out to matter in practice.
  const dupeSnap = await db.collection("users").where("username", "==", name).limit(2).get();
  if (dupeSnap.docs.some((d) => d.id !== uid)) {
    throw new HttpsError("already-exists", "That Arcade Handle is already taken! Please choose another.");
  }

  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
    const data = snap.data();
    const handleChanges = data.handleChanges || 0;
    const cost = handleChanges > 0 ? 5000 : 0;
    const wallet = data.wallet || 0;
    if (wallet < cost) throw new HttpsError("failed-precondition", "You need 5,000 pts in your Wallet to change your handle!");
    tx.update(userRef, {
      username: name,
      wallet: FieldValue.increment(-cost),
      handleChanges: handleChanges + 1,
    });
    return { username: name, cost };
  });
});

// Legacy-field backfill + daily-challenge rollover. Called on every sign-in
// and whenever the Challenges menu is opened; replaces what used to be a
// direct client-side updateDoc.
exports.refreshProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "Profile not found.");
    const data = snap.data();
    const updates = {};

    if (data.mmr === undefined) { updates.mmr = 1000; updates.clashWins = 0; updates.clashLosses = 0; updates.clashPucks = 0; }
    if (data.clashTies === undefined) updates.clashTies = 0;
    if (data.wallet === undefined) {
      let spent = 0;
      (data.inventory || []).forEach((itemId) => {
        for (const cat in SHOP_ITEMS) {
          const item = SHOP_ITEMS[cat].find((i) => i.id === itemId);
          if (item) spent += item.cost;
        }
      });
      updates.wallet = data.careerBank || 0;
      updates.careerBank = (data.careerBank || 0) + spent;
    }
    if (data.handleChanges === undefined) updates.handleChanges = 0;
    if (data.achievedTop10Daily === undefined) updates.achievedTop10Daily = 0;
    if (data.kobeCount === undefined) updates.kobeCount = 0;
    if (!data.inventory) { updates.inventory = DEFAULT_INVENTORY; updates.equipped = DEFAULT_EQUIPPED; }
    if (!data.claimedCareer) updates.claimedCareer = [];

    const today = getTodayDateStr();
    if (!data.dailyStats || data.dailyStats.date !== today || !data.dailyStats.activeIds) {
      updates.dailyStats = freshDailyStats(today);
    }

    if (Object.keys(updates).length > 0) tx.update(userRef, updates);
    return { profile: { ...data, ...updates } };
  });
});
