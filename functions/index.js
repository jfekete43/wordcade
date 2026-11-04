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
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// A copy of words.js's word lists, generated once via a small script (see
// the repo's DEPLOY.md) rather than parsed from words.js at runtime — keep
// the two in sync if the dictionary ever changes. Used only by the Daily
// Daily Puzzle functions below, to validate guesses and pick target words
// server-side without ever sending the answer to the client.
const { targetWords: DAILY_TARGET_WORDS, validGuesses: DAILY_VALID_GUESSES } = require("./words.json");
const DAILY_ALL_VALID_WORDS = new Set([...DAILY_TARGET_WORDS, ...DAILY_VALID_GUESSES]);
const DAILY_TARGET_SET = new Set(DAILY_TARGET_WORDS.map((w) => w.toUpperCase()));

// Precomputed difficulty, 0 (easiest) to 1 (hardest), for every target word.
// Derived offline from the word list itself — how many other targets differ by
// a single letter (the "four letters green and still six candidates" trap),
// repeated letters, letter rarity and vowel count — so it needs no player data
// and costs nothing at runtime. See tools/build-word-difficulty.mjs.
const WORD_DIFFICULTY = require("./word-difficulty.json");
const HANDLE = require("./handle-filter.js");

initializeApp();
const db = getFirestore();

// ============================================================================
// Server-side source of truth. Keep in sync with the display copies in
// index.html — those are for rendering only; these are what's trusted.
// ============================================================================

const SHOP_ITEMS = {
  titles: [
    { id: "title_none", cost: 0 },
    { id: "title_rookie", cost: 450 },
    { id: "title_nightowl", cost: 650 },
    { id: "title_debugger", cost: 1100 },
    { id: "title_hacker", cost: 1700 },
    { id: "title_speedrunner", cost: 2000 },
    { id: "title_combobreaker", cost: 2300 },
    { id: "title_grid", cost: 2600 },
    { id: "title_pixel", cost: 3100 },
    { id: "title_synth", cost: 3600 },
    { id: "title_wizard", cost: 4400 },
    { id: "title_overclocked", cost: 4600 },
    { id: "title_glitch", cost: 4800 },
    { id: "title_lex", cost: 5500 },
    { id: "title_algorithm", cost: 6750 },
    { id: "title_finalboss", cost: 7750 },
    { id: "title_sentient", cost: 12000 },
    { id: "title_architect", cost: 15750 },
    { id: "title_oracle", cost: 19250 },
    { id: "title_missingno", cost: 21000 },
    { id: "title_singularity", cost: 45500 },
  ],
  banners: [
    { id: "banner_default", cost: 0 },
    { id: "banner_diamond", cost: 950 },
    { id: "banner_foil", cost: 1300 },
    { id: "banner_cyan", cost: 1700 },
    { id: "banner_magenta", cost: 1700 },
    { id: "banner_8bit", cost: 3100 },
    { id: "banner_scanline", cost: 4400 },
    { id: "banner_grid", cost: 5500 },
    { id: "banner_matrix", cost: 6750 },
    { id: "banner_vaporwave", cost: 7750 },
    { id: "banner_galactic", cost: 8750 },
    { id: "banner_carbon", cost: 9750 },
    { id: "banner_neoncity", cost: 11000 },
    { id: "banner_champ", cost: 12000 },
    { id: "banner_prism", cost: 13750 },
    { id: "banner_toxic", cost: 15750 },
    { id: "banner_flux", cost: 19250 },
    { id: "banner_aurora", cost: 23000 },
    { id: "banner_solaris", cost: 26500 },
    { id: "banner_bloodmoon", cost: 34500 },
    { id: "banner_frostbite", cost: 4600, seasonal: { fromMonthDay: "12-01", toMonthDay: "01-05" } },
    { id: "banner_lantern", cost: 4600, seasonal: { season: "halloween" } },
    { id: "banner_harvest", cost: 4600, seasonal: { season: "thanksgiving" } },
    { id: "banner_sweetheart", cost: 4600, seasonal: { season: "valentines" } },
    { id: "banner_eggshell", cost: 4600, seasonal: { season: "easter" } },
    { id: "banner_firework", cost: 4600, seasonal: { season: "julyfourth" } },
    { id: "banner_celestial", cost: 37500 },
    { id: "banner_titanium", cost: 17500 },
    { id: "banner_circuit", cost: 24500 },
    { id: "banner_obsidian", cost: 33000 },
    { id: "banner_singularity", cost: 53000 },
    { id: "banner_nero", cost: 60000 },
    { id: "banner_verde", cost: 39000 },
    { id: "banner_rosso", cost: 43000 },
    { id: "banner_lapis", cost: 48000 },
    { id: "banner_argento", cost: 56000 },
    { id: "banner_ember", cost: 27500 },
    { id: "banner_depth", cost: 29000 },
    { id: "banner_caustic", cost: 31500 },
    { id: "banner_mercury", cost: 35500 },
    { id: "banner_moire", cost: 41000 },
  ],
  effects: [
    { id: "effect_none", cost: 0 },
    { id: "effect_neon_outline", cost: 2000 },
    { id: "effect_pulse", cost: 3100 },
    { id: "effect_static", cost: 4100 },
    { id: "effect_glitch", cost: 5500 },
    { id: "effect_electric", cost: 6750 },
    { id: "effect_hologram", cost: 7750 },
    { id: "effect_fire", cost: 9750 },
    { id: "effect_void", cost: 11000 },
    { id: "effect_toxic", cost: 15750 },
    { id: "effect_chromatic", cost: 17500 },
    { id: "effect_golden", cost: 21000 },
    { id: "effect_aurora", cost: 23000 },
    { id: "effect_prism", cost: 24500 },
    { id: "effect_supernova", cost: 31500 },
    { id: "effect_haunted", cost: 4600, seasonal: { season: "halloween" } },
    { id: "effect_tinsel", cost: 4600, seasonal: { season: "christmas" } },
    { id: "effect_countdown", cost: 4600, seasonal: { season: "newyear" } },
    { id: "effect_shamrock", cost: 4600, seasonal: { season: "stpatricks" } },
    { id: "effect_celestial", cost: 37500 },
    { id: "effect_permafrost", cost: 13750 },
    { id: "effect_chrome", cost: 19250 },
    { id: "effect_oilslick", cost: 29500 },
    { id: "effect_foil", cost: 46000 },
    { id: "effect_singularity", cost: 53000 },
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

// ---------------------------------------------------------------------------
// HOLIDAY WINDOWS — the same eight the site themes itself for, so an item is
// buyable exactly while its holiday is on screen. Mirrored from the Seasons
// module in index.html; this copy is the enforced one.
//
// A fixed "MM-DD" pair cannot express two of them: Easter moves between 22
// March and 25 April, and Thanksgiving is the fourth Thursday of November. So
// an item says `seasonal: { season: "easter" }` and the dates are computed on
// both sides from the same arithmetic, rather than approximated by a window
// wide enough to contain every possible date.
// ---------------------------------------------------------------------------
const utcDay = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

// Meeus/Jones/Butcher.
function easterFor(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utcDay(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
function thanksgivingFor(y) {
  const first = utcDay(y, 11, 1);
  return utcDay(y, 11, 1 + ((4 - first.getUTCDay()) + 7) % 7 + 21);
}

// Same priority order as the client: Easter outranks St Patrick's because an
// early Easter opens inside St Patrick's window (2027, 2032, 2035).
const SEASON_WINDOWS = [
  { id: "easter", lead: 10, on: easterFor },
  { id: "stpatricks", lead: 10, on: (y) => utcDay(y, 3, 17) },
  { id: "valentines", lead: 10, on: (y) => utcDay(y, 2, 14) },
  { id: "julyfourth", lead: 10, on: (y) => utcDay(y, 7, 4) },
  { id: "halloween", lead: 16, on: (y) => utcDay(y, 10, 31) },
  { id: "thanksgiving", lead: 10, on: thanksgivingFor },
  { id: "christmas", lead: 10, on: (y) => utcDay(y, 12, 25) },
  { id: "newyear", lead: 2, on: (y) => utcDay(y, 1, 1) },
];

// Whole days, inclusive both ends. Adjacent years are checked because New
// Year's window opens on 30 December of the year before it.
function isSeasonActive(seasonId, now = new Date()) {
  const entry = SEASON_WINDOWS.find((s) => s.id === seasonId);
  if (!entry) return false;
  const ymd = (date) => date.toISOString().slice(0, 10);
  const shift = (date, days) => { const x = new Date(date); x.setUTCDate(x.getUTCDate() + days); return x; };
  const today = ymd(now);
  const y = now.getUTCFullYear();
  for (const yy of [y - 1, y, y + 1]) {
    const on = entry.on(yy);
    if (today >= ymd(shift(on, -entry.lead)) && today <= ymd(shift(on, 1))) return true;
  }
  return false;
}

// One gate for both shapes: the two original items carry a fixed MM-DD window,
// everything added since names a holiday.
function isItemAvailable(item, now = new Date()) {
  if (!item.seasonal) return true;
  if (item.seasonal.season) return isSeasonActive(item.seasonal.season, now);
  return isWithinSeasonalWindow(item.seasonal.fromMonthDay, item.seasonal.toMonthDay, now);
}

/*
 * The server's half of the challenge table: id, requirement, field, payout.
 * The client carries the same rows plus the name, the sentence and the mode
 * each one belongs to - what a player reads cannot change what they are paid.
 * tests/challenges holds the two halves together and checks that every `field`
 * is one this file actually writes, which is the check that was missing when
 * two of these were impossible to finish.
 */
const CHALLENGES = {
  daily_pool: [
    { id: "d_warmup", req: 5, field: "played", reward: 1000 },
    { id: "d_doubletap", req: 2, field: "guess2", reward: 2500 },
    { id: "d_grind", req: 20, field: "guessed", reward: 5000 },
    { id: "d_sweat", req: 3, field: "guess4", reward: 3000 },
    { id: "d_clutch", req: 1, field: "guess5", reward: 2500 },
    { id: "d_marathon", req: 30, field: "played", reward: 7500 },
    { id: "d_flawless", req: 1, field: "guess1", reward: 5000 },
    { id: "d_sprint", req: 1, field: "sprintDone", reward: 2500 },
    { id: "d_trifecta", req: 1, field: "gauntletSwept", reward: 5000 },
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
    { id: "c_ffa_rookie", req: 10, field: "ffaMatchesPlayed", reward: 8000 },
    { id: "c_ffa_veteran", req: 50, field: "ffaMatchesPlayed", reward: 25000 },
    { id: "c_ffa_champion", req: 10, field: "ffaWins", reward: 35000 },
    { id: "c_ffa_legend", req: 40, field: "ffaWins", reward: 100000 },
    { id: "c_sprint_bullseye", req: 1, field: "sprintG1", reward: 10000 },
    { id: "c_sprint_regular", req: 50, field: "sprintSolved", reward: 25000 },
    { id: "c_sprint_week", req: 7, field: "sprintBestStreak", reward: 20000 },
    { id: "c_sprint_month", req: 30, field: "sprintBestStreak", reward: 100000 },
    { id: "c_trifecta_regular", req: 25, field: "gauntletPlayed", reward: 20000 },
    { id: "c_trifecta_sweep", req: 1, field: "gauntletPerfect", reward: 15000 },
    { id: "c_trifecta_sweeps", req: 10, field: "gauntletPerfect", reward: 60000 },
    { id: "c_dedication", req: 3, field: "bestLoginStreak", reward: 2500 },
    { id: "c_devoted", req: 14, field: "bestLoginStreak", reward: 20000 },
  ],
};

const DEFAULT_INVENTORY = ["title_none", "skin_default", "banner_default", "effect_none"];
const DEFAULT_EQUIPPED = { title: "title_none", skin: "skin_default", banner: "banner_default", effect: "effect_none" };

// The Trifecta's three words, drawn uniformly from the whole target list.
//
// It used to draw a ramp — one word from the easy third of the list, one from
// the middle, one from the hardest, in that order — which meant position in
// the published list WAS the difficulty tier, and the archive labelled it so.
// Over three words a ramp reads as "the last one is the nasty one" rather than
// as a curve, and it rules out two thirds of the list for each slot. One pool
// is one pool: any three words, in no meaningful order.
//
// effectiveDifficulty and the word stats are untouched by this. Sprint still
// records the tier it drew from and Marathon still bands its fifty; this is
// only about which words today's three are.

// Must match index.html's scorePoints exactly — points awarded by which
// guess (1st through 5th) solved the word.
const SCORE_POINTS = [500, 250, 150, 50, 10];
// Three. Seven was a sitting for a mode that is meant to be a coffee
// break, and the feedback that it took too long was the same feedback
// twice. The tier split below is DERIVED from this, so this line is the
// only one to change.
const DAILY_GAUNTLET_WORD_COUNT = 3;
const DAILY_GAUNTLET_MAX_GUESSES = 5;
// Marathon: one set of words per calendar month, played at whatever pace you
// like. Fifty rather than a hundred to start — the question this mode is
// being run to answer is whether anyone finishes, and fifty answers it inside
// one month instead of never.
const MARATHON_WORD_COUNT = 50;
// Easy / medium / hard, summing to MARATHON_WORD_COUNT. Drawn from the same
// three difficulty thirds the Daily Puzzle uses.
const MARATHON_TIER_SPLIT = [17, 16, 17];
const SUDDEN_DEATH_ROUND_MS = 90000; // a full 5-guess board per side, not one quick guess — needs real thinking time
const SUDDEN_DEATH_MAX_ROUNDS = 1; // one word decides it — if neither side solves it, the match is a genuine tie rather than dragging a drawn 7-minute match out by another 90s per extra round

const FFA_MAX_PLAYERS = 6;
// Three, not two. A 2-player FFA is a Clash duel wearing a different payout
// table — same word list, same 7-minute clock, same two people — so it made
// the mode indistinguishable from the one next to it. Applies to private
// rooms too: two friends who want a head-to-head already have Clash, which
// has its own room codes.
const FFA_MIN_PLAYERS = 3;
const FFA_LOBBY_GRACE_MS = 20000; // once a public lobby reaches FFA_MIN_PLAYERS, give it this long to fill further before auto-starting
const FFA_MATCH_MS = 420000; // same 7-minute race as 1v1 Clash
// Placement split of the same 1,000-point pool 1v1 pays its winner, keyed by
// player count. Every curve is a prefix of the longest one plus a trailing
// zero, so moving from a 4p lobby to a 6p one never changes what 1st through
// 4th are worth — a bigger room only adds tiers underneath. Last place always
// takes nothing, and at six that is one player rather than a crowd.
//
// 2 is unreachable while FFA_MIN_PLAYERS is 3 and is kept only as the
// fallback computeFfaOutcome indexes into for an unexpected count.
const FFA_PAYOUT_CURVES = {
  2: [1000, 0],
  3: [1000, 500, 0],
  4: [1000, 500, 200, 0],
  5: [1000, 500, 200, 100, 0],
  6: [1000, 500, 200, 100, 50, 0],
};

// Eastern-time calendar-day string (YYYY-MM-DD) — the sole source of truth
// for when the Daily Puzzle puzzle, daily challenges/stats, and login streaks
// roll over. Must match index.html's getTodayDateStr() exactly. Using the
// America/New_York IANA zone (rather than a fixed UTC offset) means this
// correctly follows EST/EDT across DST changes with no manual adjustment.
// A straight UTC day was simpler but rolled over at 7-8pm Eastern, which
// read as "way too early" to US players — revisit if the player base ever
// gets large/global enough that a single fixed reset time stops making
// sense for everyone.
function getTodayDateStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// The Eastern calendar MONTH, "YYYY-MM". Marathon's whole identity: the word
// set, the attempt and the board are all keyed by it, and it rolling over is
// what ends one marathon and starts the next. Eastern for the same reason
// every other boundary in the game is — so the month turns at one moment for
// everybody rather than at each viewer's midnight.
function getMonthKeyStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date());
}

// Calendar arithmetic on a YYYY-MM-DD string, used by the Sprint streak to
// ask "was the last solve yesterday". Parsed as UTC deliberately: the string
// is already an Eastern calendar date, so re-anchoring it to a timezone would
// shift it. UTC has no DST, which makes the day arithmetic plain addition and
// keeps month and year boundaries the Date object's problem rather than ours.
function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/*
 * The recurring Standard leaderboard's window.
 *
 * "weekly" resets every Monday, "monthly" on the 1st, both in Eastern so the
 * boundary matches the Daily Puzzle's rather than each viewer's own timezone. The
 * board it feeds used to be built by downloading every run in the window on
 * every open, which is quadratic in playercount; it is a denormalised field on
 * the user doc now, exactly like bestRunScore.
 *
 * Changing this constant changes the board. index.html has the same pair of
 * functions and tests/leaderboard-period pins the two copies together; a change
 * here needs the same change there, plus tools/backfill-period-best.mjs.
 */
const LEADERBOARD_PERIOD = "weekly"; // "weekly" | "monthly"

// The Eastern calendar date of `when`, as {y, m, d} numbers.
function etParts(when) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when).split("-").map(Number);
  return { y, m, d };
}

/*
 * The key every run in the same window shares.
 *
 * Weekly is the Eastern date of that week's Monday ("2026-09-21"), NOT an ISO
 * week number: week numbering has genuinely awkward year-boundary and
 * 53-week cases, and three separate implementations of it (here, the client,
 * the backfill) would have to agree on all of them. A Monday's date has none of
 * that and sorts correctly as a string.
 */
function periodKeyFor(when, period) {
  const { y, m, d } = etParts(when);
  if ((period || LEADERBOARD_PERIOD) === "monthly") {
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  // Day-of-week for that Eastern date, via a UTC date built from its parts so
  // the host machine's own zone cannot shift it.
  const utc = new Date(Date.UTC(y, m - 1, d));
  const back = (utc.getUTCDay() + 6) % 7; // 0 = Monday
  utc.setUTCDate(utc.getUTCDate() - back);
  return utc.toISOString().slice(0, 10);
}

/*
 * A counter for every `field` any daily challenge reads - plus the rest of the
 * guess distribution, so a challenge on guess3 needs no server change. Not a
 * style rule:
 * onRunCreated writes dailyStats as a WHOLE OBJECT, so a counter missing from
 * here is a counter that never exists, and `(daily[field] || 0) < req` then
 * refuses the claim forever. guess2 and guess4 were missing, which made Double
 * Tap and Down to the Wire - two of the seven in the rotation - impossible to
 * complete from the day they were written. tests/challenges holds this list to
 * the pool rather than to a memory of what was needed.
 */
function freshDailyStats(today) {
  const shuffled = [...CHALLENGES.daily_pool].sort(() => 0.5 - Math.random());
  return {
    date: today,
    played: 0,
    guessed: 0,
    guess1: 0,
    guess2: 0,
    guess3: 0,
    guess4: 0,
    guess5: 0,
    // Today's one-a-day modes, 0 or 1 each. Named apart from the career
    // counters of the same shape (sprintSolved, gauntletPerfect) because
    // challengeState picks the scope by the challenge's type, and two fields
    // that mean "ever" and "today" must not share a name.
    sprintDone: 0,
    gauntletSwept: 0,
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

  // A Daily Puzzle run also gets checked against today's top 10 — Firestore
  // transactions need every read up front, before any write, so this
  // query has to be prepared here alongside the plain doc reads below
  // rather than run separately afterward.
  const top10Query = run.mode === "daily" && run.puzzleDate
    ? db.collection("runs").where("mode", "==", "daily").where("puzzleDate", "==", run.puzzleDate).orderBy("score", "desc").orderBy("wordsGuessed", "desc").limit(10)
    : null;

  await db.runTransaction(async (tx) => {
    const [runSnap, userSnap, top10Snap] = await Promise.all([
      tx.get(runRef),
      tx.get(userRef),
      top10Query ? tx.get(top10Query) : Promise.resolve(null),
    ]);
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

    // The two one-a-day modes, for the challenges that name them.
    //
    // A sweep is "every word this run played", read off the run itself rather
    // than compared against DAILY_GAUNTLET_WORD_COUNT: the count has been ten,
    // then seven, then three, and a challenge that hardcoded any of those
    // became either unwinnable or free the day it changed. A Trifecta run is
    // only written once every word has been played, so wordsPlayed is the
    // whole puzzle whatever its size.
    const isSprintSolve = run.mode === "sprint" && wordsGuessed > 0;
    const isGauntletSweep = run.mode === "daily" && wordsPlayed > 0 && wordsGuessed >= wordsPlayed;

    const update = {
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
        guess2: (daily.guess2 || 0) + g2,
        guess3: (daily.guess3 || 0) + g3,
        guess4: (daily.guess4 || 0) + g4,
        guess5: (daily.guess5 || 0) + g5,
        // Capped at 1: both are one attempt a day, and a retried trigger must
        // not make "solve today's Sprint" read 2.
        sprintDone: Math.min(1, (daily.sprintDone || 0) + (isSprintSolve ? 1 : 0)),
        gauntletSwept: Math.min(1, (daily.gauntletSwept || 0) + (isGauntletSweep ? 1 : 0)),
        claimed: daily.claimed || [],
        activeIds: daily.activeIds || freshDailyStats(today).activeIds,
      },
    };

    // Denormalised per-player bests.
    //
    // The all-time boards used to read /runs and then collapse rows by
    // display name down to one per player. That is what produced the "SODA
    // three times" bug, and it also makes an exact rank impossible: counting
    // the runs above you overcounts anyone holding several good runs. Keeping
    // each player's best on their own doc turns those boards into a plain
    // /users query — one row per player by construction, no dedup — and
    // their ranks into a single count.
    //
    // Free to maintain here: this transaction already reads and writes the
    // user doc for every run, so this adds no read and no write.
    //
    // Plain writes rather than FieldValue.increment, and always guarded by a
    // max() against the stored value, which makes them idempotent — the
    // backfill in refreshProfile can run against the same field without
    // risking a higher value being clobbered by a lower one.
    if (score > Math.max(0, Number(user.bestRunScore) || 0)) {
      update.bestRunScore = score;
      // The board shows when a best was set. Prefer the run's own timestamp;
      // it is written by the same operation that created this doc, so it is
      // resolved by the time this trigger sees it.
      update.bestRunAt = run.timestamp || FieldValue.serverTimestamp();
    }
    if (run.mode === "daily" && run.puzzleDate && score > Math.max(0, Number(user.bestGauntletScore) || 0)) {
      update.bestGauntletScore = score;
      // Which Daily Puzzle it was, so the all-time board can cite the puzzle
      // number rather than a bare date.
      update.bestGauntletDate = run.puzzleDate;
    }

    // ---- The Trifecta's career record -------------------------------------
    // How many Trifectas, and how many of them were clean. Incremented rather
    // than compared, which is safe because this whole transaction is guarded
    // by payoutApplied — a retried trigger returns before reaching here.
    //
    // Kept out of the bests block above on purpose: tests/leaderboard-bests
    // lifts that block verbatim and runs it against a FieldValue stub that has
    // only serverTimestamp(), so an increment inside it is a broken lift.
    if (run.mode === "daily") {
      update.gauntletPlayed = FieldValue.increment(1);
      if (isGauntletSweep) update.gauntletPerfect = FieldValue.increment(1);
    }

    // ---- Marathon's live standing -----------------------------------------
    // The board reads these off /users rather than aggregating /runs, the
    // same denormalisation the weekly and daily boards use and for the same
    // reason: built from runs it would read every run of the month on every
    // page load.
    //
    // SET from the totals the run carries, not incremented. Each finished
    // word writes a run, and a retried trigger would increment twice — these
    // fields would then climb on their own and look like play. Carrying the
    // running total makes a replay idempotent.
    //
    // A total from a PREVIOUS month does not count against this one, so the
    // comparison floor drops to 0 when the key changes. That is what makes
    // the month reset without anything having to sweep it.
    if (run.mode === "marathon" && run.marathonKey) {
      const priorInMonth = user.marathonKey === run.marathonKey
        ? Math.max(0, Number(user.marathonScore) || 0)
        : -1;
      const incoming = Math.max(0, Number(run.marathonScore) || 0);
      // Only move forward. Two words finished close together can have their
      // triggers delivered out of order, and the later-arriving earlier word
      // must not drag the standing backwards.
      if (incoming > priorInMonth) {
        update.marathonKey = run.marathonKey;
        update.marathonScore = incoming;
        update.marathonWords = Math.max(0, Number(run.marathonWords) || 0);
        update.marathonAt = run.timestamp || FieldValue.serverTimestamp();
      }
    }

    // ---- Sprint's career record -------------------------------------------
    // Everything the finish popup shows, kept on the user doc so opening it
    // costs no extra read. Counters increment; the two "best" fields compare
    // first, the same way bestRunScore does, so a worse later run cannot
    // clobber a better earlier one.
    if (run.mode === "sprint" && run.puzzleDate) {
      const didSolve = (Number(run.wordsGuessed) || 0) > 0;
      update.sprintPlayed = FieldValue.increment(1);
      update.sprintSolved = FieldValue.increment(didSolve ? 1 : 0);
      // Guesses used, so the popup can divide by sprintSolved for an average.
      // Only counted on a solve: a miss always costs the full five and would
      // drag the average toward a number nobody actually played.
      update.sprintGuessTotal = FieldValue.increment(didSolve ? (g1 + g2 * 2 + g3 * 3 + g4 * 4 + g5 * 5) : 0);

      // The guess distribution, Sprint's own. The guess1..guess5 counters
      // above are career-wide across every mode, so they cannot answer "how
      // do my Sprints usually go". Exactly one of these is 1 on a solve and
      // all are 0 on a miss, which is what makes the misses derivable as
      // sprintPlayed - sprintSolved rather than needing a sixth counter.
      update.sprintG1 = FieldValue.increment(g1);
      update.sprintG2 = FieldValue.increment(g2);
      update.sprintG3 = FieldValue.increment(g3);
      update.sprintG4 = FieldValue.increment(g4);
      update.sprintG5 = FieldValue.increment(g5);

      if (score > Math.max(0, Number(user.sprintBestScore) || 0)) {
        update.sprintBestScore = score;
        update.sprintBestDate = run.puzzleDate;
      }
      const t = Number(run.elapsedMs);
      const priorBestTime = Number(user.sprintBestTimeMs);
      if (didSolve && Number.isFinite(t) && t > 0 && (!Number.isFinite(priorBestTime) || priorBestTime <= 0 || t < priorBestTime)) {
        update.sprintBestTimeMs = t;
      }

      // The streak. Only a solve extends it; a miss ends it, which is the
      // whole point of having one. Compared against the run's OWN puzzle date
      // rather than today, so a late-arriving trigger cannot break a streak
      // that the player did not break.
      if (didSolve) {
        const last = String(user.sprintLastDate || "");
        const continued = last && last === shiftDateStr(run.puzzleDate, -1);
        // Replaying the same day is not a second day: keep the streak where
        // it is rather than counting the day twice.
        const streak = last === run.puzzleDate
          ? Math.max(1, Number(user.sprintStreak) || 0)
          : (continued ? (Number(user.sprintStreak) || 0) + 1 : 1);
        update.sprintStreak = streak;
        update.sprintLastDate = run.puzzleDate;
        if (streak > Math.max(0, Number(user.sprintBestStreak) || 0)) update.sprintBestStreak = streak;
      } else {
        update.sprintStreak = 0;
        update.sprintLastDate = run.puzzleDate;
      }
    }

    // The recurring board. Same shape as bestRunScore, with one extra move: a
    // stored best from a PREVIOUS window does not count against this one, so
    // the comparison floor drops back to 0 when the key changes. That is what
    // makes the board reset without anything having to sweep it.
    const periodKey = periodKeyFor(new Date());
    const priorInWindow = user.periodBestKey === periodKey
      ? Math.max(0, Number(user.periodBestScore) || 0)
      : 0;
    if (score > priorInWindow) {
      update.periodBestKey = periodKey;
      update.periodBestScore = score;
      update.periodBestAt = run.timestamp || FieldValue.serverTimestamp();
    }

    // Today's board, the one on the home screen. Same denormalisation again,
    // for the same reason: built from /runs it would read every run of the day
    // on every page load.
    //
    // Daily Puzzle runs are excluded. They have their own board on their own
    // screen, and their scores are on a different scale entirely — a fixed set of words
    // against an endless run — so mixing them would make the number on this
    // board mean two different things.
    //
    // Sprint is excluded for the same reason, only more so: one word caps it
    // at 500 against a Stakes run with no ceiling at all, so a Sprint can
    // never be a meaningful row here, and a player whose only game is Sprint
    // would otherwise sit on the Stakes board with a score that cannot be
    // compared to anything else on it.
    // Marathon is excluded on the same grounds, and more sharply still: it
    // writes one run per WORD, so its score here is a single word's payout.
    if (run.mode !== "daily" && run.mode !== "sprint" && run.mode !== "marathon") {
      const dayKey = getTodayDateStr();
      const priorToday = user.dayBestKey === dayKey
        ? Math.max(0, Number(user.dayBestScore) || 0)
        : 0;
      if (score > priorToday) {
        update.dayBestKey = dayKey;
        update.dayBestScore = score;
        update.dayBestAt = run.timestamp || FieldValue.serverTimestamp();
      }
    }

    // Daily Puzzle-only: did this run land in today's top 10? The query above
    // returns the top 10 including this run's own doc (already written by
    // guessDailyWord before this trigger fired), so it has to be filtered
    // out before comparing — otherwise a run's score is always <= the min
    // of a set that already contains itself, silently failing every check.
    // A snapshot at the moment you finish, like most daily-leaderboard
    // achievements — not revoked if someone posts a higher score later in
    // the day. Only ever set once (never re-decremented/reset) since this
    // is a one-time career challenge, not a daily-resetting one.
    if (top10Snap && !user.achievedTop10Daily) {
      // Ordered the same way the board is - score, then words solved - so
      // "top 10" means the same thing here as it does on the screen the
      // achievement is named after. Comparing on score alone would hand the
      // badge to a player the board shows 11th, and withhold it from one it
      // shows 10th, whenever a tie straddles the cut.
      //
      // The query is already in that order, so the weakest of the others is
      // simply the last of them - no min() over a key that is now a pair.
      const others = top10Snap.docs.filter((d) => d.id !== runRef.id);
      const rank = (d) => [Math.max(0, Number(d.score) || 0), Math.max(0, Number(d.wordsGuessed) || 0)];
      // Not strictly ahead of the cut row — level with it counts, because the
      // board gives tied runs a SHARED place. Two runs level on both keys both
      // read "#10" on screen, and only one of them can be inside a limit(10)
      // that Firestore then breaks by document id. Requiring strictly-ahead
      // here would hand the badge to one and refuse the other for a reason
      // neither could see.
      const notBelow = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1]);
      const madeTop10 = others.length < 10 || notBelow([score, wordsGuessed], rank(others[others.length - 1].data()));
      if (madeTop10) update.achievedTop10Daily = 1;
    }

    tx.update(userRef, update);
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

    // Only a public match touches `mmr`, and that is also the ONLY thing that
    // ever creates the field. A profile starts without one, so orderBy("mmr")
    // leaves it out of the ladder's index entirely until the player has
    // actually played a ranked Clash match — the same shape ffaMmr already
    // has, and what stops the Clash board being a list of everyone who ever
    // opened the page, all tied at the base rating. Writing it on a private
    // match would mint a rating no ranked result produced (the value is
    // unchanged there, but the field would exist) and put that player on the
    // board at 1000.
    const hostUpdate = isPublicMatch ? { mmr: newHostMmr } : {};
    const guestUpdate = isPublicMatch ? { mmr: newGuestMmr } : {};
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

// Ends a 'playing' 1v1 Clash match once it's genuinely over — either side
// reached the 1,000-point lead, or the clock ran out — deciding the winner
// from the match doc's own hostScore/guestScore fields, not from anything
// the calling client asserts. Previously this was a bare client updateDoc
// setting status/winner directly: firestore.rules never restricted what a
// participant could write there beyond a few payout fields, so literally
// any player could, at any point mid-match, write themselves in as the
// winner without playing at all. This closes exactly that gap, the same
// way finishFfaMatch and the Sudden Death functions already do — the
// client still decides WHEN to call this (it's the one watching its own
// countdown timer), but no longer decides WHO won.
//
// Doesn't touch the deeper, separate, already-known limitation that
// hostScore/guestScore themselves are still self-reported by each client
// as they play (the word list is visible client-side, same as Sudden
// Death's board isn't) — fixing that would mean moving Clash's whole
// scoring model server-side, a much bigger change than this one.
exports.finishClashMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (typeof matchId !== "string" || !matchId) throw new HttpsError("invalid-argument", "Bad match id.");

  const matchRef = db.collection("matches").doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
    const match = snap.data();
    if (match.hostUid !== uid && match.guestUid !== uid) throw new HttpsError("permission-denied", "Not a participant.");
    if (match.status !== "playing") return { ok: true }; // already resolved — idempotent no-op
    if (match.suddenDeath && match.suddenDeath.active) throw new HttpsError("failed-precondition", "Sudden death is already deciding this match.");

    const hostScore = Number(match.hostScore || 0);
    const guestScore = Number(match.guestScore || 0);
    const scoreDiff = hostScore - guestScore;
    const leadReached = Math.abs(scoreDiff) >= 1000;
    const timeUp = match.endTime && Date.now() >= match.endTime - 2000;
    if (!leadReached && !timeUp) throw new HttpsError("failed-precondition", "This match hasn't ended yet.");

    if (scoreDiff === 0) {
      // Only reachable via timeUp (leadReached implies |diff| >= 1000) —
      // tied at the buzzer. Never awards a win off a tie; the caller
      // starts Sudden Death instead (see startSuddenDeath, which
      // independently validates status and is idempotent on its own).
      return { ok: true, tied: true };
    }

    tx.update(matchRef, { status: "finished", winner: scoreDiff > 0 ? match.hostUid : match.guestUid });
    return { ok: true };
  });
});

// Leaving a 'playing' 1v1 match is a forfeit — the side that stayed wins
// outright, same payout/MMR path as any other win via onMatchFinished.
// Moved server-side alongside finishClashMatch so firestore.rules can
// deny status/winner from direct client writes entirely: the client no
// longer has ANY legitimate path to set winner itself (previously this
// was a bare updateDoc — safe in what it actually asserted, since a
// leaving client only ever named the OTHER side as winner, but only
// safe because the legitimate code happened to be written that way, not
// because anything stopped a modified client from asserting itself as
// the winner via the same open field). No-ops if there's no opponent yet
// or the match is already decided, so it's safe to call from
// leaveVersusMatch() unconditionally.
exports.forfeitClashMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const { matchId } = request.data || {};
  if (typeof matchId !== "string" || !matchId) throw new HttpsError("invalid-argument", "Bad match id.");

  const matchRef = db.collection("matches").doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) return { ok: true }; // already gone
    const match = snap.data();
    if (match.hostUid !== uid && match.guestUid !== uid) throw new HttpsError("permission-denied", "Not a participant.");
    if (match.status !== "playing" || !match.guestUid) return { ok: true }; // nothing to forfeit

    const opponentUid = match.hostUid === uid ? match.guestUid : match.hostUid;
    const update = { status: "finished", winner: opponentUid, endReason: "forfeit" };
    if (match.suddenDeath && match.suddenDeath.active) update.suddenDeath = { ...match.suddenDeath, active: false };
    tx.update(matchRef, update);
    return { ok: true, forfeited: true };
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

// The Daily Puzzle is a fixed puzzle, so its answers can be learned once on
// one account and replayed on another. Anonymous sign-in is free and instant,
// which made a scout account cost literally nothing. Requiring a real account
// does not make scouting impossible — it stops it being free, which is the
// part that actually governs whether anyone bothers.
//
// Enforced here rather than only in the browser: the client check is a
// courtesy so the player gets a sign-in prompt instead of an error, but this
// is what a crafted call hits.
/* Whether the Daily Puzzle is account-only.
 *
 * It was, and the reason was real: everyone plays the same seven words, so an
 * anonymous throwaway could be used to read the answers and then play them on
 * a real account. Making that cost a real account was the whole point.
 *
 * Turned off while the mode has no players to protect. A gate in front of the
 * one feature built to bring people back daily is a poor trade when the
 * leaderboard it defends is empty - the archive skips whole days for having
 * nobody on them. Flip this back to true when there is traction worth
 * defending; index.html has a matching constant for the prompt the player
 * sees, and the two are meant to move together.
 */
const GAUNTLET_REQUIRES_ACCOUNT = false;

function requireNonGuest(request) {
  const uid = requireAuth(request);
  const firebase = request.auth.token && request.auth.token.firebase;
  if (firebase && firebase.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Sign in with Google or email to play the Daily Puzzle.");
  }
  return uid;
}

/* What a player sees when a callable throws something that is not an
 * HttpsError: the bare word "internal". No message, no code, nothing to act
 * on, and no trail for anyone else either unless somebody thinks to open the
 * logs. The Daily Puzzle did exactly that - a dialog reading "internal" and
 * silence everywhere else.
 *
 * So the real error is logged with enough context to find it, and what
 * reaches the player names the operation and says whose problem it is.
 * Deliberate HttpsErrors pass straight through: they already say something
 * true, and rewriting them would bury the sign-in prompt behind a shrug.
 */
function readableFailures(what, handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      console.error(`${what} failed`, {
        uid: (request && request.auth && request.auth.uid) || null,
        message: e && e.message,
        stack: e && e.stack,
      });
      throw new HttpsError("internal",
        `${what} failed unexpectedly. That is a problem on our side, not yours - try again in a moment.`);
    }
  };
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
  if (!isItemAvailable(item)) {
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

  // Screened here because a handle is the last free text a stranger can put in
  // front of you, and because it outlives them: `runs` documents store
  // `username` denormalised, and the leaderboard and the static Daily Puzzle
  // archive pages both read it from there, so a slur that gets through is
  // published to a page in sitemap.xml and cannot be retracted by a rename.
  // Rejected rather than mangled — asterisks would just teach the bypass.
  if (HANDLE.isBlockedHandle(name)) {
    throw new HttpsError("invalid-argument", "That Arcade Handle isn't allowed. Please choose another.");
  }

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

/*
 * The other door. A new profile's handle is written by the client (index.html),
 * derived from the Google display name, so changeUsername never sees it — and
 * firestore.rules cannot screen it, since rules have no wordlist. This replaces
 * a refused seeded handle with a safe generated one the moment the profile
 * appears. Silent on purpose: the player is choosing their real handle in the
 * next breath anyway, and nothing is lost but a name they did not pick.
 *
 * Creation is the only other way a username is ever set — rules let a client
 * update nothing but `equipped` on its own profile — so these two doors are the
 * complete set.
 */
exports.onUserProfileCreated = onDocumentCreated("users/{userId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const name = snap.get("username");
  if (typeof name !== "string" || !HANDLE.isBlockedHandle(name)) return;
  const replacement = HANDLE.safeFallbackHandle();
  console.warn(`replaced a screened handle on new profile ${event.params.userId}`);
  await snap.ref.update({ username: replacement });
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

    if (data.clashWins === undefined) { updates.clashWins = 0; updates.clashLosses = 0; updates.clashPucks = 0; }
    if (data.clashTies === undefined) updates.clashTies = 0;

    // `mmr` is no longer seeded at 1000 — onMatchFinished mints it on a
    // player's first public Clash match (see the note there). Profiles that
    // predate that, and any created by a cached older copy of index.html that
    // still sends the seed, get the unearned rating taken back off here so
    // they drop out of the ladder's index instead of filling the board with
    // base-rating rows. Only an UNTOUCHED 1000 goes: a non-zero record means
    // the player has played, so the rating is theirs even when it happens to
    // sit exactly on the base.
    const clashPlayed = (data.clashWins || 0) + (data.clashLosses || 0) + (data.clashTies || 0);
    let clearedMmr = false;
    if (data.mmr === 1000 && clashPlayed === 0) { updates.mmr = FieldValue.delete(); clearedMmr = true; }

    // A guest who links a Google account (see linkWithPopup client-side)
    // keeps the exact same uid/doc — the auth token's own provider flips
    // to non-anonymous immediately, but isGuest on the profile doc was
    // only ever set once, at doc creation. Correct it here so the
    // client's "am I a guest" checks (Profile menu, the sign-up nudge,
    // Sign Out vs Sign Up button text) don't keep reading stale data.
    const isAnonymous = !!(request.auth.token.firebase && request.auth.token.firebase.sign_in_provider === "anonymous");
    if (data.isGuest === true && !isAnonymous) updates.isGuest = false;

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
    // One-time backfill of the denormalised bests (see onRunCreated) for
    // accounts whose runs predate them. Without this, switching the all-time
    // boards over to /users would silently drop every score set before the
    // deploy.
    //
    // Self-healing rather than a one-off admin script: refreshProfile already
    // runs on every sign-in, so each account repairs itself the next time its
    // owner opens the game. The flag means the two queries below are paid
    // once per account, ever — not on every call.
    //
    // Both reads happen before this transaction writes anything, which is
    // what a Firestore transaction requires. Values are combined with the
    // stored ones via max(), so this can never walk a best backwards if a run
    // completed between the deploy and the backfill.
    if (!data.bestsBackfilled) {
      try {
        const runsRef = db.collection("runs");
        const [bestAnySnap, bestDailySnap] = await Promise.all([
          tx.get(runsRef.where("uid", "==", uid).orderBy("score", "desc").limit(1)),
          tx.get(runsRef.where("uid", "==", uid).where("mode", "==", "daily").orderBy("score", "desc").limit(1)),
        ]);
        updates.bestsBackfilled = true;
        if (!bestAnySnap.empty) {
          const best = bestAnySnap.docs[0].data();
          const bestScore = Math.max(0, Number(best.score) || 0);
          if (bestScore > Math.max(0, Number(data.bestRunScore) || 0)) {
            updates.bestRunScore = bestScore;
            if (best.timestamp) updates.bestRunAt = best.timestamp;
          }
        }
        if (!bestDailySnap.empty) {
          const best = bestDailySnap.docs[0].data();
          const bestScore = Math.max(0, Number(best.score) || 0);
          if (bestScore > Math.max(0, Number(data.bestGauntletScore) || 0)) {
            updates.bestGauntletScore = bestScore;
            if (best.puzzleDate) updates.bestGauntletDate = best.puzzleDate;
          }
        }
      } catch (e) {
        // A missing index or a transient failure must not break sign-in —
        // the flag stays unset, so the next refreshProfile tries again.
        console.error("Bests backfill failed", uid, e);
      }
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
    // The client caches this as its live profile, so the one delete sentinel
    // above cannot simply be spread in: it is a transform, not a value, and
    // would reach the client as `mmr: {}` — which every `data.mmr || 1000`
    // read would then treat as a present rating rather than an absent one.
    const profile = { ...data, ...updates };
    if (clearedMmr) delete profile.mmr;
    return { profile };
  });
});

// ============================================================================
// DAILY PUZZLE — a shared, once-per-day puzzle: everyone gets the same
// DAILY_GAUNTLET_WORD_COUNT words each Eastern-time day (see
// getTodayDateStr), one attempt each. Everyone plays every word: running out of
// guesses on a word reveals the answer and moves play to the next one, scoring
// nothing for it, and only running out of words ends the run (no
// continues/wipeout — this mode is meant to be a low-stress daily ritual, not
// the high-stakes endless mode). Today's board is ordered by score, then by
// words solved.
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

// How many samples before measured difficulty is trusted over the computed
// score. Below this the two are blended in proportion, so a word seen four
// times barely moves off its prior instead of swinging the whole grading.
const WORD_STATS_PRIOR = 20;

// Measured difficulty for one word, on the same 0..1 scale as the computed
// score: average guesses mapped from 1..5 onto 0..1, with a miss counting its
// full board. Returns the computed score alone when there is nothing measured.
function effectiveDifficulty(word, stats) {
  const base = WORD_DIFFICULTY[word];
  const prior = typeof base === "number" ? base : 0.5;
  const s = stats && stats[word];
  const plays = s && Number(s.p) > 0 ? Number(s.p) : 0;
  if (!plays) return prior;
  const avg = Number(s.g) / plays;
  if (!Number.isFinite(avg)) return prior;
  const measured = Math.min(1, Math.max(0, (avg - 1) / 4));
  // Shrink toward the computed score in proportion to how much data there is.
  return (plays * measured + WORD_STATS_PRIOR * prior) / (plays + WORD_STATS_PRIOR);
}

// Seven words that ramp: two from the easy third, three from the middle, two
// from the hard third, then ordered easiest to hardest so a Daily Puzzle opens
// gently and closes with its teeth out.
//
// Was ten. Players said a Daily Puzzle took too long, and length was the only one
// of the obvious fixes that does not change what the mode IS — a clock would
// have made the one unhurried mode a third race, and would have punished
// exactly the people complaining. Seven rather than five because the tiers
// below still divide into a real ramp at seven ([2,3,2]); at five they
// collapse to [2,1,2] and "opens gently, closes with its teeth out" stops
// meaning anything.
//
// `stats` is optional. The nightly generator passes the measured table; the
// lazy fallback inside getOrCreateTodaysPuzzle deliberately does not, because
// that path runs inside a player's own request and is not worth a read.
// `exclude` is a Set of uppercase words this draw may not use. It exists so
// the day's Sprint word cannot also appear in the day's Daily Puzzle: a player
// who does both would otherwise learn one answer from the other. Sprint is
// drawn first and handed in here, which makes the collision impossible rather
// than merely unlikely.
function pickDailyWords(exclude) {
  const banned = exclude instanceof Set ? exclude : new Set();
  const pool = DAILY_TARGET_WORDS.filter((w) => !banned.has(w.toUpperCase()));
  const picked = [];
  // Splice from the filtered copy rather than shuffling 2,300 words to take
  // three. Same uniformity, three operations, and it cannot repeat a word.
  while (picked.length < DAILY_GAUNTLET_WORD_COUNT && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

// Sprint's one word for the day, drawn uniformly from the whole target list
// rather than from a chosen tier. That is a deliberate product call: every
// word in the list is fair game, so some mornings open gently and some open
// on the hardest word in the game, and everybody meets the same one.
//
// The tier is recorded alongside it. Nothing reads it yet; it costs one sort
// a day and means the archive and the stats can group Sprints by difficulty
// later without a backfill.
function pickSprintWord(stats) {
  const ranked = DAILY_TARGET_WORDS
    .map((w) => ({ w, d: effectiveDifficulty(w.toUpperCase(), stats) }))
    .sort((a, b) => a.d - b.d);
  const i = Math.floor(Math.random() * ranked.length);
  const third = Math.floor(ranked.length / 3);
  const tier = i < third ? "easy" : i < third * 2 ? "medium" : "hard";
  return { word: ranked[i].w.toUpperCase(), tier };
}

// Marathon's month of words: MARATHON_TIER_SPLIT drawn from each difficulty
// third, stored easy-to-hard. The stored order is canonical and the same for
// everybody; the order a given player MEETS them in is a per-player shuffle
// of this one (see marathonOrderFor).
function pickMarathonWords(stats) {
  const ranked = DAILY_TARGET_WORDS
    .map((w) => ({ w, d: effectiveDifficulty(w.toUpperCase(), stats) }))
    .sort((a, b) => a.d - b.d);
  const third = Math.floor(ranked.length / 3);
  const tiers = [ranked.slice(0, third), ranked.slice(third, third * 2), ranked.slice(third * 2)];

  const picked = [];
  tiers.forEach((tier, i) => {
    const pool = [...tier];
    for (let k = 0; k < MARATHON_TIER_SPLIT[i] && pool.length; k++) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
  });
  // Bounded for the same reason pickDailyWords' top-up is: a loop that draws
  // at random and rejects must not be able to spin inside a billed function.
  for (let tries = 0; picked.length < MARATHON_WORD_COUNT && tries < 20000; tries++) {
    const w = DAILY_TARGET_WORDS[Math.floor(Math.random() * DAILY_TARGET_WORDS.length)];
    if (!picked.some((p) => p.w === w)) picked.push({ w, d: effectiveDifficulty(w.toUpperCase(), stats) });
  }
  return picked.sort((a, b) => a.d - b.d).slice(0, MARATHON_WORD_COUNT).map((p) => p.w.toUpperCase());
}

// A small deterministic PRNG, so one player's running order is reproducible
// from their uid and the month alone. Math.random would do the job once and
// then be unable to explain itself; this can be re-derived when somebody asks
// why they got the words in the order they did.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// The order ONE player meets the month's words in: a shuffle WITHIN each
// difficulty band, never across them.
//
// Across-the-board shuffling was the obvious version and it is wrong: it
// throws away the ramp, so a player can meet the hardest word of the month at
// position three. Shuffling inside each band keeps the month opening gently
// and closing hard for everyone, while still meaning no two players hit the
// same word at the same position — which is the point, because it makes
// "word 12 is brutal" unspoilable.
function marathonOrderFor(uid, month, wordCount) {
  const rng = mulberry32(seedFrom(`${uid}:${month}`));
  const order = [];
  let start = 0;
  for (const size of MARATHON_TIER_SPLIT) {
    const band = [];
    for (let i = start; i < Math.min(start + size, wordCount); i++) band.push(i);
    // Fisher-Yates, inside this band only.
    for (let i = band.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [band[i], band[j]] = [band[j], band[i]];
    }
    order.push(...band);
    start += size;
  }
  // Anything past the declared bands (a short or over-long word list) keeps
  // its canonical position rather than being dropped.
  for (let i = start; i < wordCount; i++) order.push(i);
  return order;
}

const WORD_STATS_REF = () => db.collection("wordStats").doc("aggregate");

// The measured table, or null. Only ever called from the scheduled generator,
// never from a player's request.
async function loadWordStats() {
  try {
    const snap = await WORD_STATS_REF().get();
    return snap.exists ? (snap.data().words || null) : null;
  } catch (e) {
    console.error("Word stats read failed; using computed difficulty only", e);
    return null;
  }
}

// Picks the day's words once, at 00:00 Eastern (America/New_York — an IANA
// zone, so this stays correct across EST/EDT with no manual DST handling).
// Guarded against ever overwriting an already-published day (a re-trigger
// or cold-start race) so the word set can't change out from under players
// mid-puzzle. Also just a backstop — getOrCreateTodaysPuzzle's lazy-
// generate fallback (below) covers the rare case this hasn't fired yet
// when the first player of the day opens the Daily Puzzle.
exports.generateDailyPuzzle = onSchedule({ schedule: "0 0 * * *", timeZone: "America/New_York" }, async () => {
  const today = getTodayDateStr();
  const puzzleRef = db.collection("dailyPuzzles").doc(today);
  const sprintRef = db.collection("sprintPuzzles").doc(today);
  // One read, once a day, on a schedule with no player waiting on it.
  const stats = await loadWordStats();
  await db.runTransaction(async (tx) => {
    const [daySnap, sprintSnap] = await Promise.all([tx.get(puzzleRef), tx.get(sprintRef)]);

    // Sprint is settled FIRST so its word can be kept out of the Daily's
    // seven. Each document is guarded on its own rather than returning early
    // on the first one that exists, so a day that somehow published only one
    // of the two still gets the other rather than staying half-generated.
    const sprint = sprintSnap.exists
      ? sprintSnap.data()
      : { ...pickSprintWord(stats), generatedAt: FieldValue.serverTimestamp() };
    if (!sprintSnap.exists) tx.set(sprintRef, sprint);

    if (!daySnap.exists) {
      tx.set(puzzleRef, {
        words: pickDailyWords(new Set([String(sprint.word || "").toUpperCase()])),
        wordCount: DAILY_GAUNTLET_WORD_COUNT,
        generatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
});

// Folds the per-word samples that ride along on /runs into a single document.
//
// Cost shape, which is the whole reason it looks like this: one read per run
// written since the last pass, plus exactly ONE write. Every word's totals live
// in one document rather than one document per word, which would otherwise be
// up to 2,315 writes a night and a write hot-spot besides.
//
// Progress is tracked by the timestamp of the last run folded in, not by
// yesterday's date. That makes it self-healing — a missed night catches up on
// the next one — and makes double-counting impossible, since a run is only
// ever read by a pass that starts strictly after it.
const WORD_STATS_BATCH = 2000;

// Folds one run's samples into the running totals. Split out from the
// scheduled function so the validation can be tested directly — this is the
// part that decides what a client is allowed to teach the game about its own
// word list, and it is client-reported data like everything else on a /runs
// document.
// What a finished run contributes to the word library: one entry per word
// actually played, with how many guesses it took and whether it fell.
//
// Written on the server for Sprint, the Trifecta and Marathon, which is
// better evidence than Stakes' client-written log can ever be: the client
// cannot inflate a word's difficulty by claiming five guesses on a word it
// solved in two. foldRunWordLog re-checks every entry against the real target
// list regardless, because Stakes still writes its own.
function buildWordLog(entries) {
  const out = [];
  for (const e of entries || []) {
    const w = String(e && e.word || "").toUpperCase();
    const g = Number(e && e.guesses);
    // A word that was never reached has no guesses and is not evidence.
    if (!/^[A-Z]{5}$/.test(w) || !Number.isInteger(g) || g < 1 || g > DAILY_GAUNTLET_MAX_GUESSES) continue;
    out.push({ w, g, s: !!(e && e.solved) });
  }
  return out;
}

function foldRunWordLog(run, words) {
  let counted = 0, rejected = 0;
  if (!run || !Array.isArray(run.wordLog)) return { counted, rejected };

  // One sample per word per run. A client controls what it writes here, so a
  // word repeated within a single run is not evidence of anything.
  const seen = new Set();
  for (const entry of run.wordLog) {
    if (!entry || typeof entry.w !== "string") { rejected++; continue; }
    const w = entry.w.toUpperCase();
    const g = Number(entry.g);
    // Re-checked against the real target list rather than trusted.
    if (!DAILY_TARGET_SET.has(w) || !Number.isInteger(g) || g < 1 || g > 5) { rejected++; continue; }
    if (seen.has(w)) { rejected++; continue; }
    seen.add(w);

    const cur = words[w] || { p: 0, g: 0, f: 0 };
    cur.p += 1;
    cur.g += g;
    if (entry.s === false) cur.f += 1;
    words[w] = cur;
    counted++;
  }
  return { counted, rejected };
}

exports.aggregateWordStats = onSchedule({ schedule: "30 1 * * *", timeZone: "America/New_York" }, async () => {
  const ref = WORD_STATS_REF();
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};
  const words = prev.words || {};
  const since = prev.lastProcessed || new Date(0);

  const runs = await db.collection("runs")
    .where("timestamp", ">", since)
    .orderBy("timestamp", "asc")
    .limit(WORD_STATS_BATCH)
    .get();
  if (runs.empty) return;

  let latest = since;
  let counted = 0, rejected = 0;
  for (const doc of runs.docs) {
    const run = doc.data();
    if (run.timestamp) latest = run.timestamp;
    const tally = foldRunWordLog(run, words);
    counted += tally.counted;
    rejected += tally.rejected;
  }

  await ref.set({ words, lastProcessed: latest, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`wordStats: ${runs.size} runs, ${counted} samples counted, ${rejected} rejected, ${Object.keys(words).length} words known`);
});

// ============================================================================
// THE DAILY DISCORD DIGEST
//
// Yesterday's Sprint and Trifecta top ten, posted to Discord each morning
// through an incoming webhook. A webhook is a URL you POST JSON to: no bot,
// no gateway, no OAuth, and nothing to keep running.
//
// Yesterday's, not today's. Both boards reset at midnight Eastern, so a
// morning post about today would be three people deep and wrong by lunchtime.
// Yesterday is closed: the standings are final and the answers are spent,
// which is also why the post can name the words.
//
// The two webhook URLs are secrets rather than constants because anyone
// holding one can post into the channel as the game. Set them with
//   firebase functions:secrets:set DISCORD_SPRINT_WEBHOOK
//   firebase functions:secrets:set DISCORD_TRIFECTA_WEBHOOK
// The same URL in both posts them to one channel; different URLs split them.
// ============================================================================
const DISCORD_SPRINT_WEBHOOK = defineSecret("DISCORD_SPRINT_WEBHOOK");
const DISCORD_TRIFECTA_WEBHOOK = defineSecret("DISCORD_TRIFECTA_WEBHOOK");

// Must match index.html. tests/docs-consistency checks every copy against
// every other, because a digest numbering yesterday differently from the
// share text a player posts beside it is worse than no number.
const SPRINT_EPOCH = "2026-11-02";
const TRIFECTA_EPOCH = "2026-11-04";

// Both count whole days from their epoch in UTC midnights, which is what
// survives a DST change — the same arithmetic gauntletNumber uses.
function puzzleNumber(dateStr, epoch) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const toUTC = (x) => { const [y, m, d] = x.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const days = Math.floor((toUTC(dateStr) - toUTC(epoch)) / 86400000) + 1;
  return days >= 1 ? days : null;
}

// Matches formatSprintTime in index.html: tenths under a minute, m:ss.t over.
function formatClock(ms) {
  const total = Math.max(0, Number(ms) || 0) / 1000;
  if (total < 60) return total.toFixed(1) + "s";
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  return m + ":" + (sec < 10 ? "0" : "") + sec.toFixed(1);
}

/*
 * A player-chosen name, made safe to print inside a Discord code block.
 *
 * Backticks are the dangerous character here and nothing else guards them: a
 * handle containing ``` closes the block early and everything after it
 * renders as Discord markdown, which includes any mention the rest of the
 * name happens to contain. The payload also disables mentions outright (see
 * allowed_mentions), so this is the second of two locks rather than the only
 * one.
 */
function digestName(raw, width) {
  let n = String(raw == null ? "" : raw).replace(/[`\r\n]/g, "").trim() || "player";
  if (n.length > width) n = n.slice(0, width - 1) + "…";
  return n.padEnd(width);
}

const digestNum = (n) => Number(n || 0).toLocaleString("en-US");

/*
 * The standings block. Monospaced and padded rather than a Discord table,
 * because a code block is the only thing in a Discord message that keeps
 * columns under each other on a phone.
 *
 * rows: [{ username, score, ... }] already in board order.
 */
// Column widths, used by BOTH the header and the rows. Written out twice is
// how a header ends up sitting one space left of the column it names, which
// is the only kind of bug a monospaced table can have.
const DIGEST_W = { place: 3, name: 14, count: 6, clock: 7, score: 7 };

function digestHeader(mode) {
  const lead = " ".repeat(DIGEST_W.place + 2);
  const name = "PLAYER".padEnd(DIGEST_W.name);
  return mode === "sprint"
    ? `${lead}${name} ${"GUESS".padEnd(DIGEST_W.count)} ${"TIME".padStart(DIGEST_W.clock)} ${"SCORE".padStart(DIGEST_W.score)}`
    : `${lead}${name} ${"SOLVED".padEnd(DIGEST_W.count)} ${"SCORE".padStart(DIGEST_W.score)}`;
}

function digestTable(rows, mode) {
  return rows.map((r, i) => {
    const place = ("#" + (i + 1)).padStart(DIGEST_W.place);
    const name = digestName(r.username, DIGEST_W.name);
    const score = digestNum(r.score).padStart(DIGEST_W.score);
    if (mode === "sprint") {
      // The guess it fell on, recovered from the counters the run carries:
      // exactly one of guess1..5 is 1 on a solve and none on a miss.
      const used = [1, 2, 3, 4, 5].reduce((a, g) => a + (Number(r["guess" + g]) || 0) * g, 0);
      const guesses = (r.wordsGuessed ? String(used) : "X") + "/" + DAILY_GAUNTLET_MAX_GUESSES;
      return `${place}  ${name} ${guesses.padEnd(DIGEST_W.count)} ${formatClock(r.elapsedMs).padStart(DIGEST_W.clock)} ${score}`;
    }
    const solved = `${Number(r.wordsGuessed) || 0}/${DAILY_GAUNTLET_WORD_COUNT}`;
    return `${place}  ${name} ${solved.padEnd(DIGEST_W.count)} ${score}`;
  }).join("\n");
}

/*
 * The whole Discord payload for one mode's digest.
 *
 * allowed_mentions is empty on purpose and is not decoration: usernames are
 * chosen by players, and without it a handle of "@everyone" would ping the
 * server every morning, from the game's own webhook. Empty parse means no
 * mention in this message resolves, whatever it says.
 */
function buildDigest({ mode, dateStr, rows, words }) {
  const isSprint = mode === "sprint";
  const n = puzzleNumber(dateStr, isSprint ? SPRINT_EPOCH : TRIFECTA_EPOCH);
  const name = isSprint ? "Sprint" : "Trifecta";
  const title = `${isSprint ? "\u{1F579}️" : "\u{1F525}"} Lexathon ${name}${n ? " #" + n : ""}`;
  const list = (words || []).filter(Boolean).map((w) => String(w).toUpperCase());
  const answer = list.length
    ? (isSprint ? `The word was **${list[0]}**` : `The words were **${list.join("** · **")}**`)
    : "";
  const body = ["```", digestHeader(mode), digestTable(rows, mode), "```"].join("\n");
  return {
    username: "Lexathon",
    allowed_mentions: { parse: [] },
    embeds: [{
      title,
      url: "https://lexathon.gg",
      color: isSprint ? 0x7a4a73 : 0x5c5ca8,
      description: [answer, body].filter(Boolean).join("\n"),
      footer: { text: prettyDigestDate(dateStr) },
    }],
  };
}

// "Monday 3 November 2026", in UTC so the date string is read as itself
// rather than shifted into the server's zone.
function prettyDigestDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// A webhook URL that is not one is a configuration mistake, not a thing to
// POST to. "off" is the documented way to park a digest without deleting the
// secret, which defineSecret requires to exist for the deploy to succeed.
function isDiscordWebhook(url) {
  return typeof url === "string" && /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url);
}

/*
 * 9:10am Eastern, every day, for yesterday.
 *
 * Not on the hour: Cloud Scheduler puts everything written as :00 into the
 * same minute, and nothing here is time-critical enough to join that queue.
 *
 * Posting is CLAIMED before it happens. A scheduled function can be retried,
 * and the thing being retried here reaches a channel other people are
 * reading — two identical leaderboards an hour apart is the failure nobody
 * can undo. The claim is released again if the POST fails, so a Discord
 * outage costs the day's post rather than every future one.
 */
exports.postDailyDigest = onSchedule({
  schedule: "10 9 * * *",
  timeZone: "America/New_York",
  secrets: [DISCORD_SPRINT_WEBHOOK, DISCORD_TRIFECTA_WEBHOOK],
}, async () => {
  const dateStr = shiftDateStr(getTodayDateStr(), -1);
  const jobs = [
    { mode: "sprint", url: DISCORD_SPRINT_WEBHOOK.value(), tiebreak: "elapsedMs", dir: "asc",
      puzzle: db.collection("sprintPuzzles").doc(dateStr), words: (d) => [d.word] },
    { mode: "daily", url: DISCORD_TRIFECTA_WEBHOOK.value(), tiebreak: "wordsGuessed", dir: "desc",
      puzzle: db.collection("dailyPuzzles").doc(dateStr), words: (d) => d.words || [] },
  ];

  for (const job of jobs) {
    const label = `${job.mode} ${dateStr}`;
    if (!isDiscordWebhook(job.url)) { console.log(`digest ${label}: no webhook configured, skipped`); continue; }

    const snap = await db.collection("runs")
      .where("mode", "==", job.mode).where("puzzleDate", "==", dateStr)
      .orderBy("score", "desc").orderBy(job.tiebreak, job.dir)
      .limit(10).get();
    // Nobody played. A daily "nobody played" post is a daily reminder that
    // nobody played, which is not what a leaderboard channel is for.
    if (snap.empty) { console.log(`digest ${label}: no runs, nothing to post`); continue; }

    const claimRef = db.collection("digestPosts").doc(`${job.mode}_${dateStr}`);
    const claimed = await db.runTransaction(async (tx) => {
      if ((await tx.get(claimRef)).exists) return false;
      tx.set(claimRef, { mode: job.mode, puzzleDate: dateStr, at: FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) { console.log(`digest ${label}: already posted`); continue; }

    try {
      const pSnap = await job.puzzle.get();
      const payload = buildDigest({
        mode: job.mode, dateStr, rows: snap.docs.map((d) => d.data()),
        words: pSnap.exists ? job.words(pSnap.data()) : [],
      });
      const res = await fetch(job.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Discord returned ${res.status} ${(await res.text()).slice(0, 200)}`);
      console.log(`digest ${label}: posted ${snap.size} row(s)`);
    } catch (e) {
      // Hand the day back so tomorrow's run, or a manual retry, can post it.
      await claimRef.delete().catch(() => {});
      console.error(`digest ${label}: post failed, claim released`, e);
    }
  }
});

async function getOrCreateTodaysPuzzle(tx, puzzleRef, today) {
  const snap = await tx.get(puzzleRef);
  if (snap.exists) return snap.data();
  // Fallback for the rare case the 00:00 Eastern schedule hasn't run yet
  // (the first day after deploy, or a missed trigger) — generate it lazily so
  // the feature doesn't hard-fail for whoever hits this first that day.
  //
  // Still honours the Sprint exclusion. The scheduled path draws Sprint first
  // and hands its word in; here the order is whichever mode a player opened
  // first, so the word is read back instead. Done before any write, because a
  // transaction cannot read after it writes.
  const sprintSnap = await tx.get(db.collection("sprintPuzzles").doc(today));
  const exclude = sprintSnap.exists
    ? new Set([String(sprintSnap.data().word || "").toUpperCase()])
    : new Set();
  const puzzle = { words: pickDailyWords(exclude), wordCount: DAILY_GAUNTLET_WORD_COUNT, generatedAt: FieldValue.serverTimestamp() };
  tx.set(puzzleRef, puzzle);
  return puzzle;
}

// Marathon's month of words. Lazily created the same way the other two are,
// so the first player of a month is not blocked by a schedule that has not
// fired. No exclusion against the Daily or Sprint: fifty words over a month
// will overlap a few of the month's dailies by chance, and that is fine —
// meeting a word twice weeks apart is not learning the answer, and excluding
// thirty-odd days of other modes' words up front would mean generating them
// up front too.
async function getOrCreateThisMonthsMarathon(tx, ref, month) {
  const snap = await tx.get(ref);
  if (snap.exists) return snap.data();
  const puzzle = {
    words: pickMarathonWords(null),
    wordCount: MARATHON_WORD_COUNT,
    generatedAt: FieldValue.serverTimestamp(),
  };
  tx.set(ref, puzzle);
  return puzzle;
}

function marathonAttemptRef(uid, month) {
  return db.collection("marathonAttempts").doc(uid).collection("months").doc(month);
}

// What the client is allowed to know about its own marathon. The month's
// words never appear: the player is told only which position they are on and
// what their own guesses scored. `order` is theirs and is safe — it is a
// permutation of indices into a list they cannot read.
function publicMarathonState(attempt, currentWord) {
  return {
    month: attempt.month,
    wordIndex: attempt.wordIndex,
    wordCount: attempt.wordCount,
    score: attempt.score,
    wordsSolved: attempt.wordsSolved || 0,
    status: attempt.status,
    guesses: (attempt.history && attempt.history[attempt.wordIndex] && attempt.history[attempt.wordIndex].guesses) || [],
    // Only ever the word already finished and revealed, never the live one.
    revealedWord: currentWord || null,
  };
}

// Sprint's mirror of the above, with the exclusion running the other way: if
// a player opened the Daily first today and generated its seven lazily, the
// Sprint word must not be one of them.
async function getOrCreateTodaysSprint(tx, sprintRef, today) {
  const snap = await tx.get(sprintRef);
  if (snap.exists) return snap.data();
  const daySnap = await tx.get(db.collection("dailyPuzzles").doc(today));
  const taken = new Set(
    daySnap.exists && Array.isArray(daySnap.data().words)
      ? daySnap.data().words.map((w) => String(w).toUpperCase())
      : [],
  );
  let drawn = pickSprintWord(null);
  for (let i = 0; i < 20 && taken.has(drawn.word); i++) drawn = pickSprintWord(null);
  const sprint = { ...drawn, generatedAt: FieldValue.serverTimestamp() };
  tx.set(sprintRef, sprint);
  return sprint;
}

function sprintAttemptRef(uid, date) {
  return db.collection("sprintAttempts").doc(uid).collection("days").doc(date);
}

// Shape returned to the client. The word itself is never in here while the
// attempt is live — only the guesses already made and their colours. Once the
// attempt is finished the answer is allowed out, so a player who missed can
// be shown what it was.
function publicSprintState(attempt, answer) {
  const out = {
    date: attempt.date,
    guesses: attempt.guesses || [],
    solved: !!attempt.solved,
    score: attempt.score || 0,
    status: attempt.status,
    elapsedMs: attempt.elapsedMs == null ? null : attempt.elapsedMs,
    // The player's own start time, so a board resumed after a reload can show
    // a clock that has been running rather than one starting from zero. Not a
    // secret — it is their own timestamp and tells them nothing about the
    // word — and the number that actually ranks them is still computed server
    // side from this same value.
    startedAtMs: attempt.startedAtMs == null ? null : attempt.startedAtMs,
  };
  if (attempt.status === "finished" && answer) out.answer = String(answer).toUpperCase();
  return out;
}

function dailyAttemptRef(uid, date) {
  return db.collection("dailyAttempts").doc(uid).collection("days").doc(date);
}

// Shape returned to the client — never includes the target words, only
// each guess made so far and its color feedback.
function publicAttemptState(attempt) {
  return { date: attempt.date, wordIndex: attempt.wordIndex, wordCount: attempt.wordCount, score: attempt.score, status: attempt.status, history: attempt.history };
}

exports.startDailyGauntlet = onCall(readableFailures("Starting today's Puzzle", async (request) => {
  const uid = GAUNTLET_REQUIRES_ACCOUNT ? requireNonGuest(request) : requireAuth(request);
  const today = getTodayDateStr();
  const ref = dailyAttemptRef(uid, today);
  const puzzleRef = db.collection("dailyPuzzles").doc(today);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return { attempt: publicAttemptState(snap.data()) };

    const puzzle = await getOrCreateTodaysPuzzle(tx, puzzleRef, today);
    // One history slot per word, counted from the words themselves rather
    // than read off the stored wordCount. A puzzle document missing that
    // field made wordCount undefined, and the admin SDK is not configured
    // with ignoreUndefinedProperties, so the tx.set below threw a plain
    // Error - which is to say it reached the player as "internal" and told
    // nobody anything. The words are the thing actually being played, so
    // counting them is both safer and more obviously correct.
    const wordCount = Array.isArray(puzzle.words) && puzzle.words.length
      ? puzzle.words.length
      : DAILY_GAUNTLET_WORD_COUNT;
    const attempt = {
      date: today,
      wordIndex: 0,
      wordCount,
      score: 0,
      status: "active",
      history: Array.from({ length: wordCount }, () => ({ guesses: [], solved: false })),
    };
    tx.set(ref, attempt);
    return { attempt: publicAttemptState(attempt) };
  });
}));

exports.guessDailyWord = onCall(readableFailures("Submitting that Daily Puzzle guess", async (request) => {
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
    if (solved) {
      earned = SCORE_POINTS[guessNumber - 1];
      wordFinished = true;
    } else if (guessNumber >= DAILY_GAUNTLET_MAX_GUESSES) {
      // Out of guesses on this word. The answer is revealed and play moves to
      // the next one; it is not the end of the run.
      wordFinished = true;
    }

    const newScore = attempt.score + earned;
    const newWordIndex = wordFinished ? wordIndex + 1 : wordIndex;
    // Everyone plays every word. Only running out of words ends the run.
    //
    // This used to stop at the first miss. pickDailyWords builds each puzzle as
    // a ramp - three from the easy third of the list, four from the middle,
    // three from the hardest, in that order - so stopping at the first miss put
    // the hard tier in front of roughly a quarter of players, and made the board
    // sort mostly by how far you survived rather than how well you guessed. It
    // also meant the per-word difficulty numbers the archive publishes were
    // drawn from whoever was still alive, which flattered the hardest words.
    const gauntletFinished = wordFinished && newWordIndex >= attempt.wordCount;
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
      let wordsGuessed = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, currentStreak = 0, bestStreak = 0, missed = 0;
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
          missed++;
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
        // One per missed word, not 0-or-1: a run can now miss every word. This
        // is the same thing `fails` means for a standard run - words played
        // and not guessed - which is what the Profile's win rate divides by
        // `wordsPlayed` to get.
        fails: missed, kobeCount: 0, bestStreak,
        // Three words, three samples for the word library.
        wordLog: buildWordLog(newHistory.map((entry, i) => ({
          word: puzzle.words[i], guesses: entry.guesses.length, solved: entry.solved,
        }))),
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
}));

// ============================================================================
// SPRINT — one word a day, everyone the same word. Fewest guesses wins; the
// tie is broken by how long the solve took.
//
// Architecturally this is the Daily Puzzle with the word count set to one and
// a clock added, and that is on purpose: the Daily's shape (answer in a
// collection no client may read, attempt owned and readable by its player,
// every write through the Admin SDK, a /runs document on finish that the
// existing onRunCreated payout picks up) has already survived production.
//
// THE CLOCK. Both ends are stamped server-side, because the time is a
// competitive tiebreaker and a client clock is a suggestion. They use
// Date.now() rather than FieldValue.serverTimestamp(), which is not a
// shortcut: a server-timestamp sentinel resolves at commit and cannot be read
// back inside the transaction that writes it, so two of them cannot be
// subtracted to get a duration. Date.now() runs on the function's own clock —
// still out of the client's reach — and instances are NTP-synced, so the skew
// between the call that starts the clock and the one that stops it is well
// under the precision anyone can perceive here.
//
// Stored raw and sorted raw, displayed to a tenth. Rounding to whole seconds
// would blunt the fact that a slow connection loses ties it should win, but
// rounding can be applied later over raw data and the reverse cannot.
// ============================================================================

exports.startSprint = onCall(readableFailures("Starting today's Sprint", async (request) => {
  const uid = requireAuth(request); // guests included, same as the Daily
  const today = getTodayDateStr();
  const ref = sprintAttemptRef(uid, today);
  const sprintRef = db.collection("sprintPuzzles").doc(today);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      // Resuming. The answer only comes back out if they already finished.
      const existing = snap.data();
      let answer = null;
      if (existing.status === "finished") {
        const s = await tx.get(sprintRef);
        answer = s.exists ? s.data().word : null;
      }
      return { attempt: publicSprintState(existing, answer) };
    }

    // Draws the word if the 00:00 schedule has not fired yet. Note this runs
    // before any write in this transaction, which Firestore requires.
    await getOrCreateTodaysSprint(tx, sprintRef, today);

    const attempt = {
      date: today,
      guesses: [],
      solved: false,
      score: 0,
      status: "active",
      startedAtMs: null,
      solvedAtMs: null,
      elapsedMs: null,
    };
    tx.set(ref, attempt);
    return { attempt: publicSprintState(attempt, null) };
  });
}));

exports.guessSprintWord = onCall(readableFailures("Submitting that Sprint guess", async (request) => {
  const uid = requireAuth(request);
  const raw = (request.data && request.data.guess) || "";
  const guess = String(raw).toUpperCase().trim();
  if (!/^[A-Z]{5}$/.test(guess)) throw new HttpsError("invalid-argument", "Guess must be a 5-letter word.");
  if (!DAILY_ALL_VALID_WORDS.has(guess)) throw new HttpsError("invalid-argument", "Not in word list.");

  const today = getTodayDateStr();
  const ref = sprintAttemptRef(uid, today);
  const sprintRef = db.collection("sprintPuzzles").doc(today);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [attemptSnap, sprintSnap, userSnap] = await Promise.all([tx.get(ref), tx.get(sprintRef), tx.get(userRef)]);
    if (!attemptSnap.exists) throw new HttpsError("failed-precondition", "Start today's Sprint first.");
    if (!sprintSnap.exists) throw new HttpsError("not-found", "Today's Sprint word is missing.");
    const attempt = attemptSnap.data();
    const sprint = sprintSnap.data();
    const username = userSnap.exists ? userSnap.data().username : null;
    const equipped = userSnap.exists ? userSnap.data().equipped : null;
    if (attempt.status !== "finished" && attempt.status !== "active") throw new HttpsError("failed-precondition", "Today's Sprint is in an unknown state.");
    if (attempt.status === "finished") throw new HttpsError("failed-precondition", "Today's Sprint is already finished.");

    const prior = Array.isArray(attempt.guesses) ? attempt.guesses : [];
    if (prior.length >= DAILY_GAUNTLET_MAX_GUESSES) throw new HttpsError("failed-precondition", "No guesses left today.");

    const target = String(sprint.word).toUpperCase();
    const colors = gradeGuess(guess, target);
    const solved = colors.every((c) => c === 2);
    const guessNumber = prior.length + 1; // 1-indexed, for scoring
    const newGuesses = [...prior, { guess, colors }];

    // The clock starts on the first guess and never restarts. Written only
    // when it is still null, so a retried call cannot reset it.
    const now = Date.now();
    const startedAtMs = attempt.startedAtMs == null ? now : attempt.startedAtMs;

    const finished = solved || guessNumber >= DAILY_GAUNTLET_MAX_GUESSES;
    const score = solved ? SCORE_POINTS[guessNumber - 1] : 0;
    const elapsedMs = solved ? Math.max(0, now - startedAtMs) : null;

    tx.update(ref, {
      guesses: newGuesses,
      solved,
      score,
      status: finished ? "finished" : "active",
      startedAtMs,
      solvedAtMs: solved ? now : null,
      elapsedMs,
    });

    if (finished) {
      // Same payout path as every other mode. The deterministic id blocks a
      // second submission for the day — a repeat write lands on the same doc,
      // and onRunCreated's payoutApplied guard makes the retry a no-op.
      const g = [0, 0, 0, 0, 0];
      if (solved) g[guessNumber - 1] = 1;
      const runRef = db.collection("runs").doc(`sprint_${uid}_${today}`);
      tx.set(runRef, {
        uid, username, equipped, score, isWipeout: false, lostScore: 0,
        wordsGuessed: solved ? 1 : 0, wordsPlayed: 1,
        guess1: g[0], guess2: g[1], guess3: g[2], guess4: g[3], guess5: g[4],
        fails: solved ? 0 : 1, kobeCount: 0, bestStreak: solved ? 1 : 0,
        // Null rather than absent when unsolved: the board orders on this
        // field, and Firestore drops documents missing an ordered field from
        // the result entirely.
        elapsedMs,
        // One word, one sample — and the best sample in the game: everybody
        // meets the same word, nobody can skip it, and nobody is racing.
        wordLog: buildWordLog([{ word: target, guesses: guessNumber, solved }]),
        mode: "sprint", puzzleDate: today,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    return {
      colors, solved, finished, score, elapsedMs,
      guessNumber,
      answer: finished ? target : null, // safe now — the attempt is over either way
    };
  });
}));

// ============================================================================
// MARATHON — one set of fifty words per calendar month, at your own pace.
//
// The two things that make this different from the Daily Puzzle, beyond
// length:
//
// IT IS SCORED WHILE IT IS STILL RUNNING. A month-long mode whose board only
// populates at the end has no board for most of its life, so each finished
// word writes its own /runs document and the existing onRunCreated payout
// applies it immediately. That also means points arrive as you play rather
// than thirty days later, and the board — which reads denormalised fields on
// the user doc, the same way the weekly and daily boards do — is live.
//
// EVERYONE GETS THE SAME WORDS IN A DIFFERENT ORDER. The month's fifty are
// one list, stored easy-to-hard; each player walks it through their own
// permutation, shuffled within difficulty bands so the ramp survives. Two
// players comparing notes cannot spoil each other, because "word 12" is not
// the same word for them.
//
// Joining late is not catered for, deliberately: there is one marathon a
// month and it starts when the month does.
// ============================================================================

exports.generateMarathonPuzzle = onSchedule({ schedule: "5 0 1 * *", timeZone: "America/New_York" }, async () => {
  const month = getMonthKeyStr();
  const ref = db.collection("marathonPuzzles").doc(month);
  const stats = await loadWordStats();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Never overwrite a month already in progress — people are partway
    // through it, and changing the words under them would void their score.
    if (snap.exists) return;
    tx.set(ref, { words: pickMarathonWords(stats), wordCount: MARATHON_WORD_COUNT, generatedAt: FieldValue.serverTimestamp() });
  });
});

exports.startMarathon = onCall(readableFailures("Starting this month's Marathon", async (request) => {
  const uid = requireAuth(request); // guests included, same as Sprint and the Daily
  const month = getMonthKeyStr();
  const ref = marathonAttemptRef(uid, month);
  const puzzleRef = db.collection("marathonPuzzles").doc(month);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return { attempt: publicMarathonState(snap.data(), null) };

    const puzzle = await getOrCreateThisMonthsMarathon(tx, puzzleRef, month);
    const wordCount = Array.isArray(puzzle.words) && puzzle.words.length
      ? puzzle.words.length
      : MARATHON_WORD_COUNT;
    const attempt = {
      month,
      wordIndex: 0,
      wordCount,
      score: 0,
      wordsSolved: 0,
      status: "active",
      // Stored rather than re-derived on every guess: it is this player's
      // month and it must not be able to change halfway through, whatever
      // happens to the seeding code later.
      order: marathonOrderFor(uid, month, wordCount),
      history: Array.from({ length: wordCount }, () => ({ guesses: [], solved: false })),
    };
    tx.set(ref, attempt);
    return { attempt: publicMarathonState(attempt, null) };
  });
}));

exports.guessMarathonWord = onCall(readableFailures("Submitting that Marathon guess", async (request) => {
  const uid = requireAuth(request);
  const raw = (request.data && request.data.guess) || "";
  const guess = String(raw).toUpperCase().trim();
  if (!/^[A-Z]{5}$/.test(guess)) throw new HttpsError("invalid-argument", "Guess must be a 5-letter word.");
  if (!DAILY_ALL_VALID_WORDS.has(guess)) throw new HttpsError("invalid-argument", "Not in word list.");

  const month = getMonthKeyStr();
  const ref = marathonAttemptRef(uid, month);
  const puzzleRef = db.collection("marathonPuzzles").doc(month);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const [attemptSnap, puzzleSnap, userSnap] = await Promise.all([tx.get(ref), tx.get(puzzleRef), tx.get(userRef)]);
    if (!attemptSnap.exists) throw new HttpsError("failed-precondition", "Start this month's Marathon first.");
    if (!puzzleSnap.exists) throw new HttpsError("not-found", "This month's Marathon is missing.");
    const attempt = attemptSnap.data();
    const puzzle = puzzleSnap.data();
    const username = userSnap.exists ? userSnap.data().username : null;
    const equipped = userSnap.exists ? userSnap.data().equipped : null;
    if (attempt.status !== "active") throw new HttpsError("failed-precondition", "This month's Marathon is already finished.");

    const wordIndex = attempt.wordIndex;
    const wordEntry = attempt.history[wordIndex];
    if (wordEntry.guesses.length >= DAILY_GAUNTLET_MAX_GUESSES) throw new HttpsError("failed-precondition", "No guesses left on this word.");

    // The player's own permutation decides which of the month's words this
    // position actually is. Falls back to the canonical order for an attempt
    // written before `order` existed, rather than throwing on it.
    const order = Array.isArray(attempt.order) && attempt.order.length === attempt.wordCount
      ? attempt.order
      : attempt.history.map((_, i) => i);
    const target = String(puzzle.words[order[wordIndex]]).toUpperCase();

    const colors = gradeGuess(guess, target);
    const solved = colors.every((c) => c === 2);
    const guessNumber = wordEntry.guesses.length + 1;
    const newHistory = attempt.history.map((entry, i) =>
      (i === wordIndex ? { ...entry, guesses: [...entry.guesses, { guess, colors }], solved } : entry));

    let earned = 0;
    let wordFinished = false;
    if (solved) {
      earned = SCORE_POINTS[guessNumber - 1];
      wordFinished = true;
    } else if (guessNumber >= DAILY_GAUNTLET_MAX_GUESSES) {
      wordFinished = true;
    }

    const newScore = attempt.score + earned;
    const newSolved = (attempt.wordsSolved || 0) + (solved ? 1 : 0);
    const newWordIndex = wordFinished ? wordIndex + 1 : wordIndex;
    const marathonFinished = wordFinished && newWordIndex >= attempt.wordCount;

    tx.update(ref, {
      history: newHistory,
      score: newScore,
      wordsSolved: newSolved,
      wordIndex: newWordIndex,
      status: marathonFinished ? "finished" : "active",
    });

    if (wordFinished) {
      // One /runs document per finished WORD, not per month. That is what
      // makes the board live and the points arrive as you play; onRunCreated
      // does the rest, exactly as it does for every other mode. The id is
      // deterministic on the position, so a retry lands on the same document
      // and its payoutApplied guard makes it a no-op.
      const g = [0, 0, 0, 0, 0];
      if (solved) g[guessNumber - 1] = 1;
      const runRef = db.collection("runs").doc(`marathon_${uid}_${month}_${wordIndex}`);
      tx.set(runRef, {
        uid, username, equipped, score: earned, isWipeout: false, lostScore: 0,
        wordsGuessed: solved ? 1 : 0, wordsPlayed: 1,
        guess1: g[0], guess2: g[1], guess3: g[2], guess4: g[3], guess5: g[4],
        fails: solved ? 0 : 1, kobeCount: 0, bestStreak: solved ? 1 : 0,
        // One doc per word, so one sample per word. Marathon is closed in
        // the nav right now; writing this anyway means reopening it does not
        // also mean remembering to wire it up.
        wordLog: buildWordLog([{ word: target, guesses: guessNumber, solved }]),
        mode: "marathon", marathonKey: month,
        // The running totals this word leaves the player on, so onRunCreated
        // can set the board fields outright instead of incrementing them —
        // an increment would double-count the moment a trigger is retried.
        marathonScore: newScore, marathonWords: newWordIndex,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    return {
      colors, solved, wordFinished, marathonFinished,
      earned, score: newScore, wordIndex: newWordIndex, wordsSolved: newSolved,
      revealedWord: wordFinished ? target : null,
    };
  });
}));

// ============================================================================
// CLASH SUDDEN DEATH — when a Clash match's timer runs out tied, instead of
// immediately calling it a tie, both players race on the SAME secret word,
// each with a normal 5-guess board (mirrors regular Clash word-guessing —
// same DAILY_GAUNTLET_MAX_GUESSES limit, same gradeGuess). Whoever guesses
// it correctly FIRST wins immediately, even mid-guess for the other side.
// If both exhaust all 5 guesses without either solving it, a new round
// starts with a fresh word; after SUDDEN_DEATH_MAX_ROUNDS unresolved rounds
// it falls back to a true tie. The word is graded here, never in the
// browser, for the same reason the Daily Puzzle is — a devtools-savvy
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
// word server-validated one Sudden Death/Daily Puzzle use: the word list is
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
// Schema (matches/{matchId}, mode:'ffa'): up to 6 flat player slots —
// p0Uid/p0Name/p0Equipped/p0Mmr/p0Score/p0WordIndex/p0Skips, same for
// p1-p5 — rather than a nested players map or array, so each player's
// client can update its own slot's gameplay fields independently via a
// plain updateDoc (mirrors hostScore/guestScore in 1v1) without any
// read-modify-write race. Joining a slot, however, DOES have a real race
// (two players both grabbing "the last open slot" at once) — so unlike
// match creation, joining/starting/finishing all go through callables
// (Admin SDK, transactional) instead of raw client writes; see
// firestore.rules, which denies clients write access to every field below
// except pNScore/pNWordIndex/pNSkips/chat for exactly that reason.
//
// There is no pNBoard. FFA's standings list shows rank/name/word/skips/score
// and no mini-boards, so syncing a 5x5 grid on every guess was writing data
// nothing rendered — and since all players share ONE document, that write
// rate is the ceiling on how many players the mode can hold. Dropping it took
// FFA from ~1 write per guess to ~1 per word solved, which is what makes six
// cost less than four used to. 1v1 keeps hostBoard/guestBoard: its
// tug-of-war track actually draws them.
// pNMmr holds the player's FFA rating (ffaMmr), not their Clash one.
// ============================================================================

// Every slot index a match can have, derived from FFA_MAX_PLAYERS so raising
// the cap never leaves a hardcoded list behind.
const FFA_SLOT_INDEXES = Array.from({ length: FFA_MAX_PLAYERS }, (_, i) => i);

// Returns the occupied slots (3-6 of them) as a normalized array, in slot
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

// FFA carries its own rating, separate from 1v1 Clash's `mmr`. It used to
// write straight into `mmr`, which made the two modes one pooled number and
// left the FFA leaderboard with nothing of its own to rank on — ranking it by
// `mmr` would have been a literal second copy of the Clash tab, so it ranked
// by raw ffaWins instead, i.e. by volume: 25 wins from 100 matches outranked
// 8 from 10. A 4-way score race and a head-to-head duel are different skills
// and a single number was always a small lie about both.
//
// Unset means "never finished a ranked FFA match", and is deliberately NOT
// backfilled: the field appears the first time a public match pays out, so
// the FFA board lists exactly the players with FFA history and a Clash-only
// grinder is not handed a rating they never played for. Everyone starts at
// FFA_BASE_MMR, same as Clash does.
const FFA_BASE_MMR = 1000;
function ffaRating(userData) {
  const v = Number(userData && userData.ffaMmr);
  return Number.isFinite(v) ? v : FFA_BASE_MMR;
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

    const openIdx = FFA_SLOT_INDEXES.find((i) => !match[`p${i}Uid`]);
    const userData = userSnap.data();
    const newCount = slots.length + 1;
    const update = {
      [`p${openIdx}Uid`]: uid,
      [`p${openIdx}Name`]: userData.username || "Guest",
      [`p${openIdx}Equipped`]: userData.equipped || DEFAULT_EQUIPPED,
      [`p${openIdx}Mmr`]: ffaRating(userData),
      playerCount: newCount,
    };

    let started = false;
    if (newCount >= FFA_MAX_PLAYERS) {
      update.status = "playing";
      update.endTime = Date.now() + FFA_MATCH_MS;
      started = true;
    } else if (match.isPublic && newCount === FFA_MIN_PLAYERS && !match.lobbyDeadline) {
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
        [`p${mine.idx}Mmr`]: FFA_BASE_MMR,
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
  // `return await`, not a bare `return` — a bare one resolves the promise
  // outside this try and the catch below would never see a rejection.
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(matchRef);
      if (!snap.exists) throw new HttpsError("not-found", "Match not found.");
      const match = snap.data();
      if (match.mode !== "ffa") throw new HttpsError("failed-precondition", "Not an FFA match.");
      if (!ffaSlots(match).some((s) => s.uid === uid)) throw new HttpsError("permission-denied", "Not a participant.");
      if (match.status !== "waiting") return { ok: true, alreadyStarted: true }; // idempotent no-op

      const count = match.playerCount || 0;
      if (count < FFA_MIN_PLAYERS) throw new HttpsError("failed-precondition", `Need at least ${FFA_MIN_PLAYERS} players.`);

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
  } catch (e) {
    // Every throw above is a decision this function made on purpose, so it
    // passes through untouched and the lobby still shows its specific reason.
    if (e instanceof HttpsError) throw e;

    // Anything else used to reach the client as the bare word "internal",
    // which told nobody anything — a lobby stuck on "Couldn't start:
    // internal" is undiagnosable from a phone. Log it with the context
    // needed to find it, and forward the real message so the next person
    // to hit this can read the cause off their own screen.
    console.error("startFfaMatch threw", {
      matchId, uid,
      name: e && e.name, code: e && e.code,
      message: e && e.message, stack: e && e.stack,
    });
    throw new HttpsError("internal", `start failed: ${(e && e.message) || String(e)}`);
  }
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
// instead, for future FFA-specific challenges. Rating goes to ffaMmr, which
// is FFA's alone; `mmr` is 1v1 Clash's and this never touches it.
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

    const players = slots.map((s, i) => ({ uid: s.uid, score: s.score, mmr: ffaRating(userSnaps[i].data()) }));
    const leftPlayers = after.leftPlayers || [];
    const { payoutByUid, winners } = computeFfaOutcome(players, leftPlayers);
    const isPublicMatch = after.isPublic === true;
    const eloDeltas = isPublicMatch ? computeFfaEloDeltas(players, leftPlayers) : {};

    const changes = {};
    players.forEach((p, i) => {
      const payout = payoutByUid[p.uid] || 0;
      const eloChange = eloDeltas[p.uid] || 0;
      const newMmr = Math.max(0, p.mmr + eloChange);
      const update = { ffaMmr: newMmr, ffaMatchesPlayed: FieldValue.increment(1) };
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
