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
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// A copy of words.js's word lists, generated once via a small script (see
// the repo's DEPLOY.md) rather than parsed from words.js at runtime — keep
// the two in sync if the dictionary ever changes. Used only by the Daily
// Gauntlet functions below, to validate guesses and pick target words
// server-side without ever sending the answer to the client.
const { targetWords: DAILY_TARGET_WORDS, validGuesses: DAILY_VALID_GUESSES } = require("./words.json");
const DAILY_ALL_VALID_WORDS = new Set([...DAILY_TARGET_WORDS, ...DAILY_VALID_GUESSES]);

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
    { id: "banner_prism", cost: 30000 },
    { id: "banner_flux", cost: 45000 },
    { id: "banner_solaris", cost: 65000 },
    { id: "banner_frostbite", cost: 8000, seasonal: { fromMonthDay: "12-01", toMonthDay: "01-05" } },
    { id: "banner_celestial", cost: 100000 },
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
    { id: "effect_haunted", cost: 8000, seasonal: { fromMonthDay: "10-15", toMonthDay: "11-01" } },
    { id: "effect_chromatic", cost: 40000 },
    { id: "effect_prism", cost: 60000 },
    { id: "effect_supernova", cost: 80000 },
    { id: "effect_celestial", cost: 100000 },
  ],
};

// Recurring annual "MM-DD" window (UTC), wrap-safe for windows that cross
// the New Year (e.g. Dec 1 -> Jan 5). Must match the identical helper in
// index.html — this copy is the one that's actually enforced.
function isWithinSeasonalWindow(fromMD, toMD, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const cur = `${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return fromMD <= toMD ? (cur >= fromMD && cur <= toMD) : (cur >= fromMD || cur <= toMD);
}

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
    { id: "c_untouchable", req: 10, field: "bestNoMissStreak", reward: 20000 },
    { id: "c_perfectionist", req: 25, field: "bestNoMissStreak", reward: 60000 },
    { id: "c_hotstreak", req: 5, field: "bestClashWinStreak", reward: 30000 },
    { id: "c_unstoppable", req: 10, field: "bestClashWinStreak", reward: 75000 },
    { id: "c_dedication", req: 3, field: "bestLoginStreak", reward: 2500 },
    { id: "c_devoted", req: 14, field: "bestLoginStreak", reward: 20000 },
  ],
};

const DEFAULT_INVENTORY = ["title_none", "skin_default", "banner_default", "effect_none"];
const DEFAULT_EQUIPPED = { title: "title_none", skin: "skin_default", banner: "banner_default", effect: "effect_none" };

// Must match index.html's scorePoints exactly — points awarded by which
// guess (1st through 5th) solved the word.
const SCORE_POINTS = [500, 250, 150, 50, 10];
const DAILY_GAUNTLET_WORD_COUNT = 10;
const DAILY_GAUNTLET_MAX_GUESSES = 5;
const SUDDEN_DEATH_ROUND_MS = 90000; // a full 5-guess board per side, not one quick guess — needs real thinking time
const SUDDEN_DEATH_MAX_ROUNDS = 3; // after this many pushes (nobody guessed right), fall back to a true tie

const FFA_MAX_PLAYERS = 4;
const FFA_MIN_PLAYERS = 2;
const FFA_LOBBY_GRACE_MS = 20000; // once a public lobby has 2+, give it this long to fill further before auto-starting
const FFA_MATCH_MS = 420000; // same 7-minute race as 1v1 Clash
// 1st/2nd/3rd/4th split of the same 1,000-point pool 1v1 pays its winner —
// keyed by player count so a 2p FFA lobby degenerates to exactly duel's
// win/lose payout, and a 3p lobby drops the "200" tier rather than the "500".
const FFA_PAYOUT_CURVES = { 2: [1000, 0], 3: [1000, 500, 0], 4: [1000, 500, 200, 0] };

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
    const bestStreakThisRun = Math.max(0, Number(run.bestStreak) || 0);

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
      bestNoMissStreak: Math.max(user.bestNoMissStreak || 0, bestStreakThisRun),
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

      // Win streak: winner's streak advances, loser's resets to 0. A tie
      // leaves both untouched (see the else branch) rather than breaking
      // either player's streak.
      const hostStreak = hostData.currentClashWinStreak || 0;
      const guestStreak = guestData.currentClashWinStreak || 0;
      const newHostStreak = hostWon ? hostStreak + 1 : 0;
      const newGuestStreak = hostWon ? 0 : guestStreak + 1;
      hostUpdate.currentClashWinStreak = newHostStreak;
      hostUpdate.bestClashWinStreak = Math.max(hostData.bestClashWinStreak || 0, newHostStreak);
      guestUpdate.currentClashWinStreak = newGuestStreak;
      guestUpdate.bestClashWinStreak = Math.max(guestData.bestClashWinStreak || 0, newGuestStreak);
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
  if (item.seasonal && !isWithinSeasonalWindow(item.seasonal.fromMonthDay, item.seasonal.toMonthDay)) {
    // Blocks buying a seasonal item outside its window even if someone calls
    // this function directly instead of going through the (already-hidden)
    // Shop UI — an item already owned from a past window is unaffected,
    // since that check only runs on the not-yet-owned path below.
    throw new HttpsError("failed-precondition", "This item is not available right now.");
  }

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

    // walletBase tracks the wallet's value through this function as a plain
    // number (never FieldValue.increment) — both the legacy migration below
    // and the daily-login reward further down can affect it, and mixing an
    // increment sentinel with a plain-number write to the same field in one
    // update() would silently drop one of the two effects.
    let walletBase = data.wallet;
    if (walletBase === undefined) {
      let spent = 0;
      (data.inventory || []).forEach((itemId) => {
        for (const cat in SHOP_ITEMS) {
          const item = SHOP_ITEMS[cat].find((i) => i.id === itemId);
          if (item) spent += item.cost;
        }
      });
      walletBase = data.careerBank || 0;
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

    // Daily login streak + reward. Gated on lastLoginDate !== today so this
    // only ever fires once per calendar day no matter how many times
    // refreshProfile gets called that day (sign-in, opening Challenges, …).
    let walletFinal = walletBase;
    if (data.lastLoginDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const wasConsecutive = data.lastLoginDate === yesterday;
      const newStreak = wasConsecutive ? (data.loginStreak || 0) + 1 : 1;
      updates.loginStreak = newStreak;
      updates.bestLoginStreak = Math.max(data.bestLoginStreak || 0, newStreak);
      updates.lastLoginDate = today;
      walletFinal = (walletBase || 0) + 100;
    }
    if (walletFinal !== data.wallet) updates.wallet = walletFinal;

    if (Object.keys(updates).length > 0) tx.update(userRef, updates);
    return { profile: { ...data, ...updates } };
  });
});

// ============================================================================
// DAILY GAUNTLET — a shared, once-per-day puzzle: everyone gets the same
// DAILY_GAUNTLET_WORD_COUNT words each UTC day, one attempt each. Failing a
// word ends the run with whatever was earned so far (no continues/wipeout —
// this mode is meant to be a low-stress daily ritual, not the high-stakes
// endless mode). Feeds the "Daily" leaderboard tab, replacing what used to
// just be arbitrary endless-mode runs filtered by timestamp.
//
// dailyPuzzles/{date} is never readable by the client (see firestore.rules)
// — the client only ever learns the words one letter-color at a time via
// guessDailyWord, exactly like playing against a real opponent would reveal
// them. Grading a guess happens HERE rather than in the client specifically
// because this mode's whole point is a fair shared puzzle; letting the
// client compute colors itself would mean the raw word sits in a variable
// devtools can read before anyone's finished playing that day.
// ============================================================================

function gradeGuess(guess, target) {
  const guessArr = guess.split("");
  const targetArr = target.split("");
  const colors = [0, 0, 0, 0, 0]; // 0=absent, 1=present, 2=correct — matches index.html's mini-board encoding
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === targetArr[i]) { colors[i] = 2; targetArr[i] = null; }
  }
  for (let i = 0; i < 5; i++) {
    if (colors[i] === 2) continue;
    const idx = targetArr.indexOf(guessArr[i]);
    if (idx !== -1) { colors[i] = 1; targetArr[idx] = null; }
  }
  return colors;
}

function pickDailyWords() {
  const shuffled = [...DAILY_TARGET_WORDS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, DAILY_GAUNTLET_WORD_COUNT);
}

// Picks the day's words once, at 00:00 UTC. Guarded against ever
// overwriting an already-published day (a re-trigger or cold-start race)
// so the word set can't change out from under players mid-puzzle.
exports.generateDailyPuzzle = onSchedule("0 0 * * *", async () => {
  const today = getTodayDateStr();
  const puzzleRef = db.collection("dailyPuzzles").doc(today);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(puzzleRef);
    if (snap.exists) return;
    tx.set(puzzleRef, { words: pickDailyWords(), wordCount: DAILY_GAUNTLET_WORD_COUNT, generatedAt: FieldValue.serverTimestamp() });
  });
});

async function getOrCreateTodaysPuzzle(tx, puzzleRef, today) {
  const snap = await tx.get(puzzleRef);
  if (snap.exists) return snap.data();
  // Fallback for the rare case the 00:00 UTC schedule hasn't run yet (the
  // first day after deploy, or a missed trigger) — generate it lazily so
  // the feature doesn't hard-fail for whoever hits this first that day.
  const puzzle = { words: pickDailyWords(), wordCount: DAILY_GAUNTLET_WORD_COUNT, generatedAt: FieldValue.serverTimestamp() };
  tx.set(puzzleRef, puzzle);
  return puzzle;
}

function dailyAttemptRef(uid, date) {
  return db.collection("dailyAttempts").doc(uid).collection("days").doc(date);
}

// Shape returned to the client — never includes the target words, only
// each guess made so far and its color feedback.
function publicAttemptState(attempt) {
  return { date: attempt.date, wordIndex: attempt.wordIndex, wordCount: attempt.wordCount, score: attempt.score, status: attempt.status, history: attempt.history };
}

exports.startDailyGauntlet = onCall(async (request) => {
  const uid = requireAuth(request);
  const today = getTodayDateStr();
  const ref = dailyAttemptRef(uid, today);
  const puzzleRef = db.collection("dailyPuzzles").doc(today);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return { attempt: publicAttemptState(snap.data()) };

    const puzzle = await getOrCreateTodaysPuzzle(tx, puzzleRef, today);
    const attempt = {
      date: today,
      wordIndex: 0,
      wordCount: puzzle.wordCount,
      score: 0,
      status: "active",
      history: Array.from({ length: puzzle.wordCount }, () => ({ guesses: [], solved: false })),
    };
    tx.set(ref, attempt);
    return { attempt: publicAttemptState(attempt) };
  });
});

exports.guessDailyWord = onCall(async (request) => {
  const uid = requireAuth(request);
  const raw = (request.data && request.data.guess) || "";
  const guess = String(raw).toUpperCase().trim();
  if (!/^[A-Z]{5}$/.test(guess)) throw new HttpsError("invalid-argument", "Guess must be a 5-letter word.");
  if (!DAILY_ALL_VALID_WORDS.has(guess)) throw new HttpsError("invalid-argument", "Not in word list.");

  const today = getTodayDateStr();
  const ref = dailyAttemptRef(uid, today);
  const puzzleRef = db.collection("dailyPuzzles").doc(today);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [attemptSnap, puzzleSnap, userSnap] = await Promise.all([tx.get(ref), tx.get(puzzleRef), tx.get(userRef)]);
    if (!attemptSnap.exists) throw new HttpsError("failed-precondition", "Start today's gauntlet first.");
    if (!puzzleSnap.exists) throw new HttpsError("not-found", "Today's puzzle is missing.");
    const attempt = attemptSnap.data();
    const puzzle = puzzleSnap.data();
    const username = userSnap.exists ? userSnap.data().username : null;
    const equipped = userSnap.exists ? userSnap.data().equipped : null;
    if (attempt.status !== "active") throw new HttpsError("failed-precondition", "Today's gauntlet is already finished.");

    const wordIndex = attempt.wordIndex;
    const wordEntry = attempt.history[wordIndex];
    if (wordEntry.guesses.length >= DAILY_GAUNTLET_MAX_GUESSES) throw new HttpsError("failed-precondition", "No guesses left on this word.");

    const target = puzzle.words[wordIndex];
    const colors = gradeGuess(guess, target);
    const solved = colors.every((c) => c === 2);
    const guessNumber = wordEntry.guesses.length + 1; // 1-indexed, for scoring

    const newHistory = attempt.history.map((entry, i) => (i === wordIndex ? { ...entry, guesses: [...entry.guesses, { guess, colors }], solved } : entry));

    let earned = 0;
    let wordFinished = false;
    let failedOut = false;
    if (solved) {
      earned = SCORE_POINTS[guessNumber - 1];
      wordFinished = true;
    } else if (guessNumber >= DAILY_GAUNTLET_MAX_GUESSES) {
      wordFinished = true;
      failedOut = true;
    }

    const newScore = attempt.score + earned;
    const newWordIndex = wordFinished ? wordIndex + 1 : wordIndex;
    const gauntletFinished = wordFinished && (failedOut || newWordIndex >= attempt.wordCount);
    const newStatus = gauntletFinished ? "finished" : "active";

    tx.update(ref, { history: newHistory, score: newScore, wordIndex: newWordIndex, status: newStatus });

    if (gauntletFinished) {
      // Reuses the exact same payout path as a standard run: score earned
      // here is real, same as anywhere else in the game. Writing a /runs
      // doc with a deterministic id (blocks a second submission for the
      // same day — a repeat write hits the same doc, and onRunCreated's
      // own payoutApplied guard makes any retry a no-op) lets onRunCreated
      // apply wallet/careerBank/stat counters through its existing trigger,
      // no separate payout logic needed here.
      let wordsGuessed = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, currentStreak = 0, bestStreak = 0;
      newHistory.forEach((entry) => {
        if (entry.guesses.length === 0) return; // word never reached
        if (entry.solved) {
          wordsGuessed++;
          currentStreak++;
          bestStreak = Math.max(bestStreak, currentStreak);
          const n = entry.guesses.length;
          if (n === 1) g1++; else if (n === 2) g2++; else if (n === 3) g3++; else if (n === 4) g4++; else if (n === 5) g5++;
        } else {
          currentStreak = 0;
        }
      });
      const wordsPlayed = newHistory.filter((entry) => entry.guesses.length > 0).length;

      // The leaderboard's dedup-by-name step runs BEFORE it re-resolves each
      // entry's live username, so this can't be left null/generic the way
      // "the leaderboard re-fetches it anyway" might suggest — every daily
      // entry sharing one placeholder name would collapse into a single
      // row. Use the username read above instead.
      // equipped mirrors what saveRunToCloud() sends for a standard run —
      // without it, daily-mode entries render bannerless/effectless in the
      // live feed and leaderboard even though the player has cosmetics
      // equipped, since both just read equipped straight off the run doc.
      const runRef = db.collection("runs").doc(`daily_${uid}_${today}`);
      tx.set(runRef, {
        uid, username, equipped, score: newScore, isWipeout: false, lostScore: 0,
        wordsGuessed, wordsPlayed, guess1: g1, guess2: g2, guess3: g3, guess4: g4, guess5: g5,
        fails: failedOut ? 1 : 0, kobeCount: 0, bestStreak,
        mode: "daily", puzzleDate: today,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    return {
      colors, solved, wordFinished, gauntletFinished,
      earned, score: newScore, wordIndex: newWordIndex,
      revealedWord: wordFinished ? target : null, // safe now — this word is done either way
    };
  });
});

// ============================================================================
// CLASH SUDDEN DEATH — when a Clash match's timer runs out tied, instead of
// immediately calling it a tie, both players race on the SAME secret word,
// each with a normal 5-guess board (mirrors regular Clash word-guessing —
// same DAILY_GAUNTLET_MAX_GUESSES limit, same gradeGuess). Whoever guesses
// it correctly FIRST wins immediately, even mid-guess for the other side.
// If both exhaust all 5 guesses without either solving it, a new round
// starts with a fresh word; after SUDDEN_DEATH_MAX_ROUNDS unresolved rounds
// it falls back to a true tie. The word is graded here, never in the
// browser, for the same reason the Daily Gauntlet is — a devtools-savvy
// player could otherwise just read the answer before guessing.
//
// matches/{matchId}.suddenDeath carries the public, non-spoiling state
// (round, deadline, each side's guess COUNT only — never the guesses or
// colors themselves, which would tip off the opponent — and the eventual
// result). matchSecrets/{matchId} carries the actual word and each side's
// graded guess history; never client-readable (see firestore.rules), and
// scratch state only — once a round resolves, nothing in it is read again.
//
// Resolution writes status:'finished' + winner straight onto the match doc,
// which the existing onMatchFinished trigger already picks up — no separate
// payout logic needed here, same MMR/wallet/streak path as any other win,
// and a fallback tie still increments clashTies exactly like the original
// (pre-sudden-death) tie path did.
// ============================================================================

function matchSecretRef(matchId) {
  return db.collection("matchSecrets").doc(matchId);
}

function pickSuddenDeathWord() {
  return DAILY_TARGET_WORDS[Math.floor(Math.random() * DAILY_TARGET_WORDS.length)];
}

// Shared by "both sides exhausted their 5 guesses" and "deadline passed
// with nobody having solved it" (a correct guess always resolves the round
// immediately elsewhere, so by the time either of those apply, nobody has
// won yet). Writes each doc at most once — Firestore transactions don't
// support multiple writes to the same doc reference.
function pushSuddenDeathRoundOrFinalTie(tx, matchRef, secretRef, round) {
  if (round >= SUDDEN_DEATH_MAX_ROUNDS) {
    tx.update(matchRef, {
      status: "finished",
      winner: null,
      suddenDeath: { active: false, round, hostGuessCount: 0, guestGuessCount: 0, deadline: 0, result: "tie" },
    });
    return;
  }
  const nextRound = round + 1;
  tx.set(secretRef, { round: nextRound, word: pickSuddenDeathWord(), hostGuesses: [], guestGuesses: [] });
  tx.update(matchRef, {
    suddenDeath: { active: true, round: nextRound, deadline: Date.now() + SUDDEN_DEATH_ROUND_MS, hostGuessCount: 0, guestGuessCount: 0, result: null },
  });
}

exports.startSuddenDeath = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (!matchId) throw new HttpsError("invalid-argument", "Missing matchId.");

  const matchRef = db.collection("matches").doc(matchId);
  const secretRef = matchSecretRef(matchId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const match = snap.data();
    if (match.hostUid !== uid && match.guestUid !== uid) throw new HttpsError("permission-denied", "Not a participant in this match.");
    if (match.status !== "playing") throw new HttpsError("failed-precondition", "Match isn't active.");
    if (match.suddenDeath && match.suddenDeath.active) return { ok: true }; // already started — no-op (e.g. a race between both clients)

    tx.set(secretRef, { round: 1, word: pickSuddenDeathWord(), hostGuesses: [], guestGuesses: [] });
    tx.update(matchRef, {
      suddenDeath: { active: true, round: 1, deadline: Date.now() + SUDDEN_DEATH_ROUND_MS, hostGuessCount: 0, guestGuessCount: 0, result: null },
    });
    return { ok: true };
  });
});

exports.guessSuddenDeathWord = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  const raw = (request.data && request.data.guess) || "";
  const guess = String(raw).toUpperCase().trim();
  if (!matchId) throw new HttpsError("invalid-argument", "Missing matchId.");
  if (!/^[A-Z]{5}$/.test(guess)) throw new HttpsError("invalid-argument", "Guess must be a 5-letter word.");
  if (!DAILY_ALL_VALID_WORDS.has(guess)) throw new HttpsError("invalid-argument", "Not in word list.");

  const matchRef = db.collection("matches").doc(matchId);
  const secretRef = matchSecretRef(matchId);

  return db.runTransaction(async (tx) => {
    const [matchSnap, secretSnap] = await Promise.all([tx.get(matchRef), tx.get(secretRef)]);
    if (!matchSnap.exists || !secretSnap.exists) throw new HttpsError("not-found", "Match not found.");
    const match = matchSnap.data();
    const secret = secretSnap.data();
    const isHost = match.hostUid === uid;
    const isGuest = match.guestUid === uid;
    if (!isHost && !isGuest) throw new HttpsError("permission-denied", "Not a participant in this match.");
    const sd = match.suddenDeath;
    if (!sd || !sd.active) throw new HttpsError("failed-precondition", "Sudden death isn't active.");
    if (sd.round !== secret.round) throw new HttpsError("failed-precondition", "This round has already ended.");
    if (Date.now() > sd.deadline) throw new HttpsError("failed-precondition", "Time's up for this round.");

    const mySlot = isHost ? "hostGuesses" : "guestGuesses";
    const otherSlot = isHost ? "guestGuesses" : "hostGuesses";
    const myGuesses = secret[mySlot] || [];
    const otherGuesses = secret[otherSlot] || [];
    if (myGuesses.length >= DAILY_GAUNTLET_MAX_GUESSES) throw new HttpsError("failed-precondition", "No guesses left this round.");

    const colors = gradeGuess(guess, secret.word);
    const correct = colors.every((c) => c === 2);
    const newMyGuesses = [...myGuesses, { guess, colors, correct, at: Date.now() }];

    if (correct) {
      // Wins outright, right now — no need to persist the updated guess
      // list; matchSecrets is scratch state never read again once the
      // match is finished.
      tx.update(matchRef, {
        status: "finished",
        winner: uid,
        suddenDeath: {
          active: false, round: secret.round,
          hostGuessCount: isHost ? newMyGuesses.length : otherGuesses.length,
          guestGuessCount: isHost ? otherGuesses.length : newMyGuesses.length,
          deadline: 0, result: isHost ? "host" : "guest",
        },
      });
      return { correct: true, colors };
    }

    const bothExhausted = newMyGuesses.length >= DAILY_GAUNTLET_MAX_GUESSES && otherGuesses.length >= DAILY_GAUNTLET_MAX_GUESSES;
    if (bothExhausted) {
      pushSuddenDeathRoundOrFinalTie(tx, matchRef, secretRef, secret.round);
    } else {
      tx.update(secretRef, { [mySlot]: newMyGuesses });
      tx.update(matchRef, { suddenDeath: { ...sd, [isHost ? "hostGuessCount" : "guestGuessCount"]: newMyGuesses.length } });
    }

    return { correct: false, colors };
  });
});

// Host-triggered (mirrors how the main match clock is already only watched
// by the host's client) when a round's deadline passes. Since a correct
// guess always resolves the round immediately elsewhere, reaching this means
// nobody has solved it yet — same push-or-tie outcome as both sides running
// out of guesses, just triggered by time instead.
exports.resolveSuddenDeathTimeout = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (!matchId) throw new HttpsError("invalid-argument", "Missing matchId.");

  const matchRef = db.collection("matches").doc(matchId);
  const secretRef = matchSecretRef(matchId);

  return db.runTransaction(async (tx) => {
    const [matchSnap, secretSnap] = await Promise.all([tx.get(matchRef), tx.get(secretRef)]);
    if (!matchSnap.exists || !secretSnap.exists) throw new HttpsError("not-found", "Match not found.");
    const match = matchSnap.data();
    const secret = secretSnap.data();
    if (match.hostUid !== uid && match.guestUid !== uid) throw new HttpsError("permission-denied", "Not a participant in this match.");
    const sd = match.suddenDeath;
    if (!sd || !sd.active) return { ok: true }; // already resolved — no-op
    if (sd.round !== secret.round) return { ok: true }; // stale call from a client that hasn't seen the round advance yet
    if (Date.now() < sd.deadline) throw new HttpsError("failed-precondition", "Round isn't over yet.");

    pushSuddenDeathRoundOrFinalTie(tx, matchRef, secretRef, secret.round);
    return { ok: true };
  });
});

// ============================================================================
// CLASH: FREE-FOR-ALL — the same timed Score Attack race as 1v1 Clash (shared
// word list, 7-minute clock, most points when time's up wins), scaled to
// 2-4 players. Deliberately reuses 1v1's trust model rather than the hidden-
// word server-validated one Sudden Death/Gauntlet use: the word list is
// still generated client-side and stored openly on the match doc, and each
// player still self-reports their own score/board/word-index as they play
// (see checkGuess() in index.html) — no different from what 1v1 Clash
// already does. What IS new here, and DOES matter: unlike 1v1's finishMatch
// (a bare client updateDoc — any participant could, in principle, declare
// themselves the winner outright without playing), placement AND payout for
// FFA are decided by finishFfaMatch below, from the match doc's own score
// fields, not from whatever a client claims. A determined cheater can still
// inflate their own score client-side (same pre-existing limitation as 1v1),
// but can no longer just skip to a self-declared win.
//
// Schema (matches/{matchId}, mode:'ffa'): up to 4 flat player slots —
// p0Uid/p0Name/p0Equipped/p0Mmr/p0Score/p0Board/p0WordIndex, same for
// p1-p3 — rather than a nested players map or array, so each player's
// client can update its own slot's gameplay fields independently via a
// plain updateDoc (mirrors hostScore/guestScore in 1v1) without any
// read-modify-write race. Joining a slot, however, DOES have a real race
// (two players both grabbing "the last open slot" at once) — so unlike
// match creation, joining/starting/finishing all go through callables
// (Admin SDK, transactional) instead of raw client writes; see
// firestore.rules, which denies clients write access to every field below
// except pNScore/pNBoard/pNWordIndex/chat for exactly that reason.
// ============================================================================

// Returns the occupied slots (2-4 of them) as a normalized array, in slot
// order. Never includes empty slots (pNUid === null).
function ffaSlots(match) {
  const slots = [];
  for (let i = 0; i < FFA_MAX_PLAYERS; i++) {
    const uid = match[`p${i}Uid`];
    if (uid) {
      slots.push({
        idx: i,
        uid,
        name: match[`p${i}Name`],
        equipped: match[`p${i}Equipped`],
        mmr: match[`p${i}Mmr`] || 1000,
        score: Number(match[`p${i}Score`] || 0),
      });
    }
  }
  return slots;
}

function eloExpected(myMMR, opponentMMR) {
  return 1 / (1 + Math.pow(10, (opponentMMR - myMMR) / 400));
}

// Rank order (best first) as placement "groups" — a group has more than one
// player only when they're genuinely tied. Active (never-left) players are
// grouped by tied score, exactly as if nobody had left. Every player who
// left mid-match ranks below every active player regardless of their
// frozen score, each in their own singleton group — leave order is a
// strict, unambiguous tiebreaker among them, and whoever left FIRST gets
// the WORST placement (last), so leavers are listed last-to-leave-first.
// Shared by computeFfaOutcome (payout) and computeFfaEloDeltas (rating) so
// both agree on the same placement instead of one trusting raw score and
// the other trusting leave order.
function computeFfaPlacements(players, leftPlayers = []) {
  const leftSet = new Set(leftPlayers);
  const active = players.filter((p) => !leftSet.has(p.uid)).sort((a, b) => b.score - a.score);
  const leavers = leftPlayers
    .filter((uid) => players.some((p) => p.uid === uid))
    .map((uid) => players.find((p) => p.uid === uid))
    .reverse();

  const groups = [];
  let i = 0;
  while (i < active.length) {
    let j = i;
    while (j + 1 < active.length && active[j + 1].score === active[i].score) j++;
    groups.push(active.slice(i, j + 1));
    i = j + 1;
  }
  leavers.forEach((p) => groups.push([p]));
  return groups;
}

// Multiplayer Elo: for each player, average their pairwise Elo delta against
// every other player (actual = 1 beat them / 0.5 tied them / 0 lost to them,
// by final PLACEMENT — not raw score, so a leaver's frozen score can't put
// them ahead of an active player they actually rank below), rather than
// chaining sequential 1v1 updates — keeps the result independent of any
// ordering and, for exactly 2 players with nobody leaving, reduces to the
// exact same number calculateEloChange would produce.
function computeFfaEloDeltas(players, leftPlayers = []) {
  const groups = computeFfaPlacements(players, leftPlayers);
  const rankByUid = {};
  groups.forEach((group, idx) => { group.forEach((p) => { rankByUid[p.uid] = idx; }); });

  const n = players.length;
  const deltas = {};
  players.forEach((p) => {
    let sumDiff = 0;
    players.forEach((o) => {
      if (o.uid === p.uid) return;
      const actual = rankByUid[p.uid] < rankByUid[o.uid] ? 1 : rankByUid[p.uid] > rankByUid[o.uid] ? 0 : 0.5;
      sumDiff += actual - eloExpected(p.mmr, o.mmr);
    });
    deltas[p.uid] = Math.round(32 * (sumDiff / (n - 1)));
  });
  return deltas;
}

// Splits the payout curve across each placement group — e.g. two players
// tied for 1st in a 4p match share the combined 1st+2nd payout (1000+500)
// evenly, and a player who left mid-match takes whatever tier their
// leave-order placement lands on (see computeFfaPlacements).
function computeFfaOutcome(players, leftPlayers = []) {
  const n = players.length;
  const curve = FFA_PAYOUT_CURVES[n] || FFA_PAYOUT_CURVES[2];
  const groups = computeFfaPlacements(players, leftPlayers);

  const payoutByUid = {};
  let slot = 0;
  groups.forEach((group) => {
    const loSlot = slot, hiSlot = slot + group.length - 1;
    const totalPayout = curve.slice(loSlot, hiSlot + 1).reduce((a, b) => a + b, 0);
    const share = Math.round(totalPayout / group.length);
    group.forEach((p) => { payoutByUid[p.uid] = share; });
    slot = hiSlot + 1;
  });

  const winners = groups.length > 0 ? groups[0].map((p) => p.uid) : [];
  return { payoutByUid, winners };
}

// Claims the next open slot for the caller. Transactional so two players
// joining the same lobby at once can't both land in "the last slot" — one
// wins the transaction, the other's transaction retries against the
// now-full (or now-different) match and fails cleanly instead of racing.
exports.joinFfaMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (typeof matchId !== "string" || !matchId) throw new HttpsError("invalid-argument", "Bad match id.");

  const matchRef = db.collection("matches").doc(matchId);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [matchSnap, userSnap] = await Promise.all([tx.get(matchRef), tx.get(userRef)]);
    if (!matchSnap.exists) throw new HttpsError("not-found", "Match not found.");
    if (!userSnap.exists) throw new HttpsError("not-found", "Profile not found.");
    const match = matchSnap.data();
    if (match.mode !== "ffa") throw new HttpsError("failed-precondition", "Not an FFA match.");
    if (match.status !== "waiting") throw new HttpsError("failed-precondition", "That match already started.");

    const slots = ffaSlots(match);
    const already = slots.find((s) => s.uid === uid);
    if (already) return { matchId, slotIndex: already.idx, playerCount: slots.length, started: false }; // retried call — no-op
    if (slots.length >= FFA_MAX_PLAYERS) throw new HttpsError("failed-precondition", "That match is full.");

    const openIdx = [0, 1, 2, 3].find((i) => !match[`p${i}Uid`]);
    const userData = userSnap.data();
    const newCount = slots.length + 1;
    const update = {
      [`p${openIdx}Uid`]: uid,
      [`p${openIdx}Name`]: userData.username || "Guest",
      [`p${openIdx}Equipped`]: userData.equipped || DEFAULT_EQUIPPED,
      [`p${openIdx}Mmr`]: userData.mmr || 1000,
      playerCount: newCount,
    };

    let started = false;
    if (newCount >= FFA_MAX_PLAYERS) {
      update.status = "playing";
      update.endTime = Date.now() + FFA_MATCH_MS;
      started = true;
    } else if (match.isPublic && newCount === 2 && !match.lobbyDeadline) {
      update.lobbyDeadline = Date.now() + FFA_LOBBY_GRACE_MS;
    }

    tx.update(matchRef, update);
    return { matchId, slotIndex: openIdx, playerCount: newCount, started };
  });
});

// Before the match starts: frees a player's slot from a lobby that hasn't
// started yet. The host leaving deletes the whole room (mirrors 1v1's
// client-side "host deletes their own waiting match" behavior — the
// firestore.rules delete rule already lets any host delete their own
// waiting match doc directly, so this only needs to handle a non-host
// slot, which a client can't free itself).
//
// Once the match is 'playing': leaving is NOT a freeze-and-forget. It's
// recorded in leftPlayers (in leave order) and the match keeps running for
// whoever's left — computeFfaPlacements ranks every leaver below every
// still-active player, worst placement to whoever left FIRST, so leaving
// early always costs you more than sticking it out. This mirrors the "1v1
// leaving is a forfeit" rule, generalized to a field instead of a single
// binary loss since more than one player can leave.
exports.leaveFfaMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (typeof matchId !== "string" || !matchId) throw new HttpsError("invalid-argument", "Bad match id.");

  const matchRef = db.collection("matches").doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) return { ok: true }; // already gone
    const match = snap.data();
    if (match.mode !== "ffa") throw new HttpsError("failed-precondition", "Not an FFA match.");

    if (match.status === "waiting") {
      const slots = ffaSlots(match);
      const mine = slots.find((s) => s.uid === uid);
      if (!mine) return { ok: true }; // wasn't in it

      if (mine.idx === 0) {
        tx.delete(matchRef);
        return { ok: true, deleted: true };
      }
      tx.update(matchRef, {
        [`p${mine.idx}Uid`]: null,
        [`p${mine.idx}Name`]: null,
        [`p${mine.idx}Equipped`]: null,
        [`p${mine.idx}Mmr`]: 1000,
        playerCount: slots.length - 1,
      });
      return { ok: true };
    }

    if (match.status === "playing") {
      if (!ffaSlots(match).some((s) => s.uid === uid)) return { ok: true }; // wasn't in it
      const left = match.leftPlayers || [];
      if (left.includes(uid)) return { ok: true, alreadyLeft: true }; // retried call — no-op
      tx.update(matchRef, { leftPlayers: [...left, uid] });
      return { ok: true, left: true };
    }

    return { ok: true }; // already finished — nothing to do
  });
});

// Starts a still-waiting lobby early: host-only for a private room (any
// time there are 2+ players), or any participant once a public lobby's
// grace period has elapsed. Re-validates the deadline against the server's
// own clock rather than trusting the caller's — a client can't start it
// early by lying about what time it is locally.
exports.startFfaMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (typeof matchId !== "string" || !matchId) throw new HttpsError("invalid-argument", "Bad match id.");

  const matchRef = db.collection("matches").doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const match = snap.data();
    if (match.mode !== "ffa") throw new HttpsError("failed-precondition", "Not an FFA match.");
    if (!ffaSlots(match).some((s) => s.uid === uid)) throw new HttpsError("permission-denied", "Not a participant.");
    if (match.status !== "waiting") return { ok: true, alreadyStarted: true }; // idempotent no-op

    const count = match.playerCount || 0;
    if (count < FFA_MIN_PLAYERS) throw new HttpsError("failed-precondition", "Need at least 2 players.");

    if (match.isPublic) {
      if (!match.lobbyDeadline || Date.now() < match.lobbyDeadline) {
        throw new HttpsError("failed-precondition", "The grace period hasn't elapsed yet.");
      }
    } else if (match.hostUid !== uid) {
      throw new HttpsError("permission-denied", "Only the host can start a private match early.");
    }

    tx.update(matchRef, { status: "playing", endTime: Date.now() + FFA_MATCH_MS });
    return { ok: true };
  });
});

// Ends a 'playing' FFA match once its clock has actually run out, computing
// winners from the match doc's own score fields — not from anything the
// calling client asserts. Any participant's client may call this (whichever
// one notices the timer hit zero first); it's transaction-idempotent, so a
// race between multiple clients calling it at once just means the rest are
// no-ops. Payout/MMR happen separately in onFfaMatchFinished, same split as
// the 1v1 duel/onMatchFinished relationship.
exports.finishFfaMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (typeof matchId !== "string" || !matchId) throw new HttpsError("invalid-argument", "Bad match id.");

  const matchRef = db.collection("matches").doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const match = snap.data();
    if (match.mode !== "ffa") throw new HttpsError("failed-precondition", "Not an FFA match.");
    const slots = ffaSlots(match);
    if (!slots.some((s) => s.uid === uid)) throw new HttpsError("permission-denied", "Not a participant.");
    if (match.status !== "playing") return { ok: true }; // already resolved — idempotent no-op
    if (!match.endTime || Date.now() < match.endTime - 2000) {
      throw new HttpsError("failed-precondition", "The match hasn't ended yet.");
    }

    const { winners } = computeFfaOutcome(slots, match.leftPlayers || []);
    tx.update(matchRef, { status: "finished", winners });
    return { ok: true };
  });
});

// Payout/MMR trigger for FFA matches — the exact counterpart to
// onMatchFinished, just computing placements across 2-4 players instead of
// a binary win/lose. Public matches move MMR (pairwise-averaged Elo, see
// computeFfaEloDeltas); private matches still pay the wallet split but never
// touch MMR, same rule 1v1 already follows. clashWins/clashLosses/clashTies
// stay 1v1-only (a 3-way placement doesn't map cleanly onto a win/loss
// counter) — FFA gets its own lightweight ffaMatchesPlayed/ffaWins counters
// instead, for future FFA-specific challenges.
exports.onFfaMatchFinished = onDocumentUpdated("matches/{matchId}", async (event) => {
  const after = event.data.after.data();
  const before = event.data.before.data();
  if (!after || after.mode !== "ffa") return;
  if (after.status !== "finished" || (before && before.status === "finished")) return;

  const matchRef = event.data.after.ref;
  const slots = ffaSlots(after);
  if (slots.length < FFA_MIN_PLAYERS) return; // never actually filled — nothing to pay out

  const userRefs = slots.map((s) => db.collection("users").doc(s.uid));

  await db.runTransaction(async (tx) => {
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists || matchSnap.data().payoutApplied) return; // already processed (retry-safe)
    const userSnaps = await Promise.all(userRefs.map((r) => tx.get(r)));
    if (userSnaps.some((s) => !s.exists)) return;

    const players = slots.map((s, i) => ({ uid: s.uid, score: s.score, mmr: userSnaps[i].data().mmr || 1000 }));
    const leftPlayers = after.leftPlayers || [];
    const { payoutByUid, winners } = computeFfaOutcome(players, leftPlayers);
    const isPublicMatch = after.isPublic === true;
    const eloDeltas = isPublicMatch ? computeFfaEloDeltas(players, leftPlayers) : {};

    const changes = {};
    players.forEach((p, i) => {
      const payout = payoutByUid[p.uid] || 0;
      const eloChange = eloDeltas[p.uid] || 0;
      const newMmr = Math.max(0, p.mmr + eloChange);
      const update = { mmr: newMmr, ffaMatchesPlayed: FieldValue.increment(1) };
      if (payout > 0) {
        update.wallet = FieldValue.increment(payout);
        update.careerBank = FieldValue.increment(payout);
      }
      if (winners.includes(p.uid)) update.ffaWins = FieldValue.increment(1);
      tx.update(userRefs[i], update);
      changes[p.uid] = { payout, eloChange };
    });

    tx.update(matchRef, { changes, payoutApplied: true });
  });
});
