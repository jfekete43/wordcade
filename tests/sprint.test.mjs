/*
 * Sprint: one word a day, the same word for everyone, fewest guesses wins,
 * fastest solve breaks the tie.
 *
 * Four things here are load-bearing and none of them fail loudly in
 * production if they break:
 *
 * THE CLOCK. It is the tiebreaker, so it is the thing worth cheating. Both
 * ends are stamped inside the Cloud Function and the start is written once
 * and never rewritten — a second write would let a player restart their own
 * clock by retrying a guess. It also cannot use FieldValue.serverTimestamp():
 * that sentinel resolves at commit and cannot be read back inside the
 * transaction that writes it, so two of them cannot be subtracted.
 *
 * THE ANSWER. One word shared by everybody is the most valuable secret in the
 * game — reading it once wins the whole day. It lives in a collection no
 * client may read, and publicSprintState must not hand it back while the
 * attempt is still live.
 *
 * THE COLLISION. Sprint's word is drawn first and excluded from the Daily's
 * seven. Without that a player who does both learns one answer from the
 * other, and the lazy-generate fallbacks mean the two can be created in
 * either order.
 *
 * THE SCALE. Sprint tops out at 500 against a Stakes run with no ceiling, so
 * it must stay off the shared "best run today" board or one word puts a
 * player on a leaderboard nothing else on it can be compared to.
 *
 * Pure; no emulator and no browser. The functions under test are lifted out
 * of functions/index.js by source and evaluated, the way word-difficulty
 * does, so this runs the shipped code rather than a restatement of it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const grab = (re, what) => {
  const m = fn.match(re);
  if (!m) throw new Error('could not extract ' + what + ' — the anchor moved');
  return m[0];
};

// ---- the pure helpers, lifted and run ------------------------------------
const WORD_DIFFICULTY = JSON.parse(fs.readFileSync(REPO('functions/word-difficulty.json'), 'utf8'));
const DAILY_TARGET_WORDS = JSON.parse(fs.readFileSync(REPO('functions/words.json'), 'utf8')).targetWords;

const helperSrc = [
  grab(/const WORD_STATS_PRIOR = \d+;/, 'WORD_STATS_PRIOR'),
  grab(/const DAILY_GAUNTLET_WORD_COUNT = \d+;/, 'DAILY_GAUNTLET_WORD_COUNT'),
  grab(/function effectiveDifficulty\(word, stats\) \{\n[\s\S]*?\n\}/, 'effectiveDifficulty'),
  grab(/function pickDailyWords\(exclude\) \{\n[\s\S]*?\n\}/, 'pickDailyWords'),
  grab(/function pickSprintWord\(stats\) \{\n[\s\S]*?\n\}/, 'pickSprintWord'),
  grab(/function shiftDateStr\(dateStr, days\) \{\n[\s\S]*?\n\}/, 'shiftDateStr'),
  grab(/function publicSprintState\(attempt, answer\) \{\n[\s\S]*?\n\}/, 'publicSprintState'),
].join('\n\n');
console.log('extracted from functions/index.js:', helperSrc.length, 'chars');

// eslint-disable-next-line no-new-func
const H = new Function('WORD_DIFFICULTY', 'DAILY_TARGET_WORDS',
  `${helperSrc}; return { pickDailyWords, pickSprintWord, shiftDateStr, publicSprintState };`)(
  WORD_DIFFICULTY, DAILY_TARGET_WORDS);

// ---- the word of the day --------------------------------------------------
{
  const seen = new Set();
  let tiers = new Set();
  for (let i = 0; i < 400; i++) {
    const s = H.pickSprintWord(null);
    seen.add(s.word);
    tiers.add(s.tier);
    if (!/^[A-Z]{5}$/.test(s.word)) { ck(false, 'every Sprint word is five uppercase letters', s.word); break; }
  }
  ck(seen.size > 100, 'the Sprint word is not pinned to a handful of words', String(seen.size));
  // Whole list, not a chosen tier. This was a product decision: some mornings
  // open gently and some open on the hardest word in the game.
  eq('and it is drawn from the whole list, so every tier can come up',
     [...tiers].sort(), ['easy', 'hard', 'medium']);
  const all = new Set(DAILY_TARGET_WORDS.map((w) => w.toUpperCase()));
  ck([...seen].every((w) => all.has(w)), 'and always from the real answer list');
}

// ---- the collision that must not happen -----------------------------------
{
  // The exclusion is what stops a player who does both modes learning one
  // answer from the other.
  // Deterministic, deliberately. Excluding ONE word and drawing seven from
  // 2,315 only catches a broken filter about one run in six, so that version
  // of this check passed with the exclusion deleted outright. Banning all but
  // a handful makes the draw's contents provable instead of probable.
  const survivors = DAILY_TARGET_WORDS.slice(0, 9).map((w) => w.toUpperCase());
  const banAllBut = new Set(DAILY_TARGET_WORDS.map((w) => w.toUpperCase()).filter((w) => !survivors.includes(w)));
  for (let i = 0; i < 5; i++) {
    const words = H.pickDailyWords(banAllBut).map((w) => w.toUpperCase());
    const strays = words.filter((w) => !survivors.includes(w));
    if (strays.length) { ck(false, 'the Daily draw contains only words the exclusion left', strays.join(',')); break; }
    if (i === 4) ck(true, 'the Daily draw contains only words the exclusion left');
  }
  // And in bulk, which is the shape the real caller uses.
  const bulk = new Set(DAILY_TARGET_WORDS.slice(0, 1200).map((w) => w.toUpperCase()));
  let leaked = 0;
  for (let i = 0; i < 40; i++) {
    for (const w of H.pickDailyWords(bulk)) if (bulk.has(w.toUpperCase())) leaked++;
  }
  eq('an excluded word never appears in the Daily draw, over 280 draws', leaked, 0);
  // Without an exclusion the Daily still works, which is what the scheduled
  // path relied on before Sprint existed.
  const GCOUNT = Number(fn.match(/const DAILY_GAUNTLET_WORD_COUNT = (\d+);/)[1]);
  ck(H.pickDailyWords(new Set()).length === GCOUNT,
     `and an empty exclusion still yields a full puzzle of ${GCOUNT}`);
  ck(H.pickDailyWords().length === GCOUNT, 'as does no exclusion at all');
}

// ---- the streak -----------------------------------------------------------
eq('yesterday is yesterday', H.shiftDateStr('2026-11-01', -1), '2026-10-31');
eq('across a month boundary', H.shiftDateStr('2026-03-01', -1), '2026-02-28');
eq('across a year boundary', H.shiftDateStr('2027-01-01', -1), '2026-12-31');
// A leap year is the case a hand-rolled subtraction gets wrong.
eq('and across a leap day', H.shiftDateStr('2028-03-01', -1), '2028-02-29');
// DST: America/New_York springs forward on 2026-03-08. Parsed as UTC
// precisely so this is plain arithmetic rather than a 23-hour day.
eq('a DST transition does not eat a day', H.shiftDateStr('2026-03-09', -1), '2026-03-08');

// ---- what the client is allowed to see ------------------------------------
{
  const live = { date: '2026-11-01', guesses: [{ guess: 'CRANE', colors: [0, 1, 0, 0, 2] }], solved: false, score: 0, status: 'active', startedAtMs: 1000, elapsedMs: null };
  const outLive = H.publicSprintState(live, 'SOLVE');
  ck(!('answer' in outLive), 'a live attempt never carries the answer', JSON.stringify(outLive));
  ck(!JSON.stringify(outLive).includes('SOLVE'), 'and the word appears nowhere in it');
  eq('it does carry the guesses already made', outLive.guesses.length, 1);
  // Needed so a reload mid-word shows a clock that has been running.
  eq('and the start stamp, so a resumed board can show a running clock', outLive.startedAtMs, 1000);

  const done = { ...live, status: 'finished', solved: true, score: 150, elapsedMs: 64300 };
  const outDone = H.publicSprintState(done, 'SOLVE');
  eq('once finished the answer is allowed out', outDone.answer, 'SOLVE');
  eq('along with the settled time', outDone.elapsedMs, 64300);
}

// ---- the clock, at source --------------------------------------------------
const guessSrc = grab(/exports\.guessSprintWord = onCall\([\s\S]*?\n\}\)\);/, 'guessSprintWord');

ck(/const now = Date\.now\(\);/.test(guessSrc),
   'the clock reads the function\'s own wall clock, not the client\'s');
// The reason this is not serverTimestamp(): that sentinel cannot be read back
// inside the transaction that writes it, so a duration cannot be computed.
ck(!/startedAtMs: FieldValue\.serverTimestamp|solvedAtMs: FieldValue\.serverTimestamp/.test(guessSrc),
   'and not a server-timestamp sentinel, which cannot be subtracted');
ck(/attempt\.startedAtMs == null \? now : attempt\.startedAtMs/.test(guessSrc),
   'the start is written once and reused after, so a retry cannot restart it');
ck(/now - startedAtMs/.test(guessSrc),
   'elapsed is the difference between the two server stamps');
ck(!/request\.data[\s\S]{0,80}elapsed|data\.elapsedMs|data\.startedAt/.test(guessSrc),
   'and nothing about the timing is taken from the request');

// The guess budget and the scoring ladder are the Daily's, not a second copy.
ck(/prior\.length >= DAILY_GAUNTLET_MAX_GUESSES/.test(guessSrc),
   'the five-guess cap is the shared constant, not a literal');
ck(/SCORE_POINTS\[guessNumber - 1\]/.test(guessSrc),
   'and scoring reuses the shared ladder');
ck(/DAILY_ALL_VALID_WORDS\.has\(guess\)/.test(guessSrc),
   'a guess must be a real word, checked on the server');

// ---- score descending IS guesses ascending --------------------------------
// This is why the board can reuse the existing machinery instead of needing
// an ascending sort nothing else in the game does. If SCORE_POINTS ever stops
// being strictly decreasing, the board silently starts ranking by something
// other than guess count.
{
  const pts = JSON.parse(grab(/const SCORE_POINTS = \[[^\]]*\]/, 'SCORE_POINTS').replace('const SCORE_POINTS = ', ''));
  const strictlyDown = pts.every((v, i) => i === 0 || v < pts[i - 1]);
  ck(strictlyDown, 'the scoring ladder is strictly decreasing, so ordering by score IS ordering by guesses',
     JSON.stringify(pts));
  eq('and it still has one entry per guess', pts.length, 5);
}

// ---- the run document ------------------------------------------------------
ck(/db\.collection\("runs"\)\.doc\(`sprint_\$\{uid\}_\$\{today\}`\)/.test(guessSrc),
   'the run id is deterministic, so a second submission cannot double-count a day');
ck(/mode: "sprint", puzzleDate: today/.test(guessSrc),
   'the run is tagged with its mode and date, which is what the board filters on');
// Firestore drops documents missing a field the query orders by, so an
// unsolved run must carry an explicit null rather than omitting it.
ck(/\n\s*elapsedMs,/.test(guessSrc),
   'and always carries elapsedMs, because a document missing an ordered field falls out of the query');

// ---- scale: Sprint stays off the shared board ------------------------------
const dayGuard = (fn.match(/if \(run\.mode !== [^)]*\) \{/) || [''])[0];
ck(/run\.mode !== "sprint"/.test(dayGuard),
   'a Sprint never lands on the "best run today" board', dayGuard);
ck(/run\.mode !== "daily"/.test(dayGuard),
   'and the Trifecta is still excluded alongside it', dayGuard);

// ---- career counters -------------------------------------------------------
const career = fn.slice(fn.indexOf('Sprint\'s career record'), fn.indexOf('The recurring board'));
ck(career.length > 200, 'the Sprint career block is findable', String(career.length));
for (const f of ['sprintPlayed', 'sprintSolved', 'sprintStreak', 'sprintBestStreak', 'sprintBestTimeMs']) {
  ck(career.includes(f), `onRunCreated maintains ${f}`);
}
// A miss has to end the streak, or the number means nothing.
ck(/update\.sprintStreak = 0;/.test(career), 'a missed word resets the streak');
// Replaying the same date must not count as a second day.
ck(/last === run\.puzzleDate/.test(career), 'and replaying one day cannot inflate it');
// Compared against the run's own date rather than "today", so a trigger that
// fires late cannot break a streak the player kept.
ck(/shiftDateStr\(run\.puzzleDate, -1\)/.test(career),
   'continuity is measured from the run\'s own puzzle date, not from whenever the trigger ran');
// Guesses only counted on a solve: a miss always costs the full five and
// would drag the average toward a number nobody played.
ck(/didSolve \? \(g1 \+ g2 \* 2/.test(career), 'the guess average counts solves only');

// ---- the answer is unreachable ---------------------------------------------
ck(/match \/sprintPuzzles\/\{date\} \{\s*\n\s*allow read, write: if false;/.test(rules),
   'no client can read the Sprint word, in any state');
ck(/match \/sprintAttempts\/\{userId\}\/days\/\{date\} \{\s*\n\s*allow read: if isOwner\(userId\);\s*\n\s*allow write: if false;/.test(rules),
   'a player can read their own attempt but write nothing — the clock lives there');
for (const f of ['sprintPlayed', 'sprintSolved', 'sprintBestTimeMs', 'sprintStreak', 'sprintBestStreak']) {
  ck(new RegExp(`!\\('${f}' in request\\.resource\\.data\\)`).test(rules),
     `a new account cannot arrive with ${f} already set`);
}

// ---- the board's index exists ----------------------------------------------
{
  const idx = JSON.parse(fs.readFileSync(REPO('firestore.indexes.json'), 'utf8'));
  const want = [['mode', 'ASCENDING'], ['puzzleDate', 'ASCENDING'], ['score', 'DESCENDING'], ['elapsedMs', 'ASCENDING']];
  const has = (idx.indexes || []).some((i) => i.collectionGroup === 'runs'
    && i.fields.length === want.length
    && i.fields.every((f, n) => f.fieldPath === want[n][0] && f.order === want[n][1]));
  ck(has, 'the Sprint board has the composite index it queries, or it is empty in production and green here');
}

// ---- the landing page ------------------------------------------------------
// Sprint is the mode a visitor arrives on, and arriving must not call a Cloud
// Function: that is the "second hesitation load" the Gauntlet pull-in was
// removed for. The gate paints from markup; the server is touched on the tap.
ck(/<button class="mode-nav-btn mode-sprint" id="btn-nav-1" data-mode="sprint" aria-current="true"/.test(html),
   'the shipped markup marks Sprint as the landing mode before any script runs');
ck(/id="sprint-card"/.test(html), 'and ships a card rather than a live board');
ck(/id="sprint-card-btn"/.test(html), 'whose button is what actually calls the server');
const bootBlock = html.slice(html.lastIndexOf('setTimeout(() => {'));
ck(/showSprintLanding\(\);/.test(bootBlock), 'boot lands on Sprint');
ck(!/callStartSprint\(\)/.test(bootBlock),
   'and boot does not call startSprint — arriving is not playing');
const landing = html.slice(html.indexOf('function showSprintLanding()'), html.indexOf('window.leaveSprint'));
ck(!/callStartSprint/.test(landing), 'nor does the landing view itself');
// The landing button must NOT be a mode change, and this says why rather
// than just what. showSprintLanding sets isSprintMode before the card is
// tappable, so currentMode() already reads "sprint" — and goToMode's first
// line refuses a change to the mode you are already in. Routed through it the
// button did nothing at all, and the only way to start a Sprint was to visit
// another mode and come back.
{
  const currentSrc = (html.match(/function currentMode\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  if (!currentSrc) throw new Error('could not extract currentMode() from index.html');
  // eslint-disable-next-line no-new-func
  const modeOnLanding = new Function(`
    let isSprintMode = true, isMarathonMode = false, isDailyMode = false,
        isVersusMode = false, isFfaMode = false;
    ${currentSrc}
    return currentMode();
  `)();
  eq('the landing is already IN sprint mode by the time the card is tappable', modeOnLanding, 'sprint');

  const guard = (html.match(/if \(!MODES\[target\][^\n]*\) return;/) || [''])[0];
  ck(/target === currentMode\(\)/.test(guard),
     'and goToMode refuses a change to the mode you are already in', guard);

  const cardFrom = html.indexOf('<div id="sprint-card"');
  const cardTo = html.indexOf('</div>', html.indexOf('id="sprint-card-btn"'));
  ck(cardFrom !== -1 && cardTo > cardFrom, 'the landing card is findable', `${cardFrom}..${cardTo}`);
  const card = html.slice(cardFrom, cardTo);
  ck(!new RegExp(`goToMode\\('${modeOnLanding}'\\)`).test(card),
     'so the landing button does not ask goToMode for the mode it is already in', card.slice(-220));
  ck(/onclick="window\.openSprint\(\)"/.test(card),
     'it calls openSprint directly — starting the mode you are on is not a mode change',
     card.slice(-220));
}

// A restored Stakes run must survive a look at Sprint. The restore moved out
// of leaveSprint into the one body the leave paths and the mode-switch
// fallback share, so this follows it there rather than pinning the line to a
// function it no longer lives in.
{
  const leave = (html.match(/window\.leaveSprint = function\(\) \{[\s\S]*?\n        \}/) || [''])[0];
  ck(/showStandardSurface\(\);/.test(leave), 'leaving Sprint goes back through the shared restore', leave.slice(-200));
  const restore = (html.match(/        function showStandardSurface\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!restore, 'which is findable', restore.slice(0, 60));
  ck(/if \(!targetWord\) window\.startNewRun\(\);/.test(restore),
     'and does not discard a Stakes run that was already in progress', restore);
}


// ---- switching between two server-backed modes --------------------------------
// Every leave path puts the Stakes screen back, which is right when Stakes is
// where you are going. Going anywhere else it was a flash of a game nobody
// asked for - bank, CASH OUT button, a live word - held on screen for the
// length of the round trip the real destination was waiting on.
//
// The fix is cheap for a reason worth writing down: nothing between the tap
// and the first network await is asynchronous, and a browser does not paint
// inside a task, so the Stakes screen the leave path painted has never
// actually reached a frame by the time this takes it back down.
{
  const goSrc = (html.match(/        window\.goToMode = async function\(target\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!goSrc, 'goToMode is findable', goSrc.slice(0, 60));
  const modesSrc = (html.match(/        const MODES = \{\n[\s\S]*?\n        \};/) || [''])[0];
  const curSrc = (html.match(/        function currentMode\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];

  // Trifecta, not Marathon: Marathon is hidden in the table now and goToMode
  // refuses a hidden mode, so a switch to it never starts. That refusal is
  // worth its own case, below, rather than being the case everything else
  // accidentally tests.
  const go = async (target, { from = 'sprint', opens = true, throws = false } = {}) => {
    const log = [];
    const rec = (n) => (...a) => { log.push(n); };
    // eslint-disable-next-line no-new-func
    const body = new Function('log', 'rec', 'FROM', 'TARGET', 'OPENS', 'THROWS', `
      let isDailyMode = false, isSprintMode = false, isMarathonMode = false,
          isVersusMode = false, isFfaMode = false, pendingMode = null;
      if (FROM) eval(({sprint:'isSprintMode',marathon:'isMarathonMode',gauntlet:'isDailyMode',
                       clash:'isVersusMode',ffa:'isFfaMode'})[FROM] + ' = true');
      ${modesSrc}
      ${curSrc}
      const els = {};
      const document = { activeElement: null,
        getElementById: (id) => (els[id] = els[id] || { id, style: {} }) };
      const confirm = () => true;
      const window = {};
      let currentMatchId = 'm', score = 0, targetWord = null;
      const runStats = { played: 0 };
      const saveRunToCloud = rec('saveRunToCloud');
      const renderModeNav = rec('renderModeNav');
      const showModeIntro = async () => { log.push('showModeIntro'); };
      const showStandardSurface = rec('showStandardSurface');
      const enterModeLoading = (t) => { pendingMode = t; log.push('enterModeLoading:' + t); };
      const FLAG_OF = { leaveSprint: 'isSprintMode', leaveMarathon: 'isMarathonMode',
                        leaveDailyGauntlet: 'isDailyMode', leaveVersusMatch: 'isVersusMode',
                        cancelVersusLobby: 'isVersusMode', leaveFfaMatch: 'isFfaMode',
                        cancelFfaLobby: 'isFfaMode' };
      // Recording is not enough: a real leave drops its flag, and the fallback
      // below asks currentMode() whether the open ever landed. A stub that
      // kept the flag up would make every bail look like a success.
      for (const [m, flag] of Object.entries(FLAG_OF)) {
        window[m] = () => { log.push(m); eval(flag + ' = false'); };
      }
      const opener = (t, flag) => async () => {
        log.push('open:' + t);
        if (THROWS) throw new Error('boom');
        // A real open paints nothing until its callable comes back, so a
        // bail leaves every flag exactly where the leave path left it.
        if (OPENS) eval(flag + ' = true');
        log.push('pendingDuringOpen:' + pendingMode);
      };
      window.openSprint = opener('sprint', 'isSprintMode');
      window.openMarathon = opener('marathon', 'isMarathonMode');
      window.openDailyGauntlet = opener('gauntlet', 'isDailyMode');
      window.openClashLobby = opener('clash', 'isVersusMode');
      window.openFfaLobby = opener('ffa', 'isFfaMode');
      ${goSrc}
      return window.goToMode(TARGET)
        .catch((e) => { log.push('threw'); })
        .then(() => ({ log, pendingMode, landedOn: currentMode() }));`);
    return body(log, rec, from, target, opens, throws);
  };

  {
    const o = await go('gauntlet');
    eq('leaving Sprint for Trifecta goes leave, then wait, then open',
       o.log.filter((l) => /^(leaveSprint|enterModeLoading|open):?/.test(l) || l.startsWith('enterModeLoading')),
       ['leaveSprint', 'enterModeLoading:gauntlet', 'open:gauntlet']);
    // The decisive one: the waiting state is up BEFORE the open, because the
    // open is where the round trip is and the round trip is what gets seen.
    ck(o.log.indexOf('enterModeLoading:gauntlet') < o.log.indexOf('open:gauntlet'),
       'and the waiting state is up before the call that waits', o.log.join(' -> '));
    eq('the nav says Trifecta for the whole of the wait', o.log.find((l) => l.startsWith('pendingDuringOpen')), 'pendingDuringOpen:gauntlet');
    eq('and stops saying it once Trifecta is actually there', o.pendingMode, null);
    ck(!o.log.includes('showStandardSurface'),
       'with no detour through the Stakes screen at all', o.log.join(' -> '));
  }
  {
    // A closed mode is unreachable, not merely unlisted. An old invite link,
    // a cached page or a bookmarked onclick would otherwise walk into a lobby
    // nobody can fill — and would do it THROUGH the teardown above, leaving
    // the player on a loading line for a mode that is never coming.
    const o = await go('marathon');
    eq('a closed mode is refused outright', o.log, []);
    eq('without tearing down the mode they are in', o.landedOn, 'sprint');
  }
  {
    const o = await go('endless', { from: 'gauntlet' });
    // Stakes IS what the leave path painted, so there is nothing to wait for.
    ck(!o.log.some((l) => l.startsWith('enterModeLoading')),
       'going back to Stakes raises no waiting state, since it is already there', o.log.join(' -> '));
  }
  {
    // Every bail is silent as far as the screen is concerned: no account, a
    // guest refused the Daily, a callable that failed. Leaving the player on
    // a header for a mode that never arrived is worse than the flash was.
    const o = await go('gauntlet', { opens: false });
    ck(o.log.includes('showStandardSurface'),
       'an open that bails puts the player back on Stakes', o.log.join(' -> '));
    eq('and the nav stops claiming the mode that never arrived', o.pendingMode, null);
    eq('which is where they end up', o.landedOn, 'endless');
  }
  {
    const o = await go('gauntlet', { throws: true });
    eq('an open that throws still clears the nav, because the clear is in a finally',
       o.pendingMode, null);
    ck(o.log.includes('threw'), 'the throw itself is not swallowed', o.log.join(' -> '));
  }
}

// The waiting state takes down everything the mode it replaces would have.
// Derived from the open functions themselves: a header added to a mode later
// cannot be forgotten here, which is the only way this goes wrong.
{
  const enter = (html.match(/        function enterModeLoading\(target\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!enter, 'enterModeLoading is findable', enter.slice(0, 60));
  const hidden = (src) => new Set([...src.matchAll(/getElementById\("([\w-]+)"\)\.style\.display = "none"/g)].map((m) => m[1]));
  const mine = hidden(enter);
  for (const fn of ['openSprint', 'openMarathon', 'openDailyGauntlet']) {
    const src = (html.match(new RegExp('        window\\.' + fn + ' = async function\\([^)]*\\) \\{\\n[\\s\\S]*?\\n        \\}')) || [''])[0];
    ck(!!src, fn + ' is findable', src.slice(0, 50));
    // Modals are not mode chrome. The opens dismiss the main menu because
    // they can be reached from it; goToMode is reached from the nav, which is
    // behind that overlay and untappable while it is up.
    const theirs = [...hidden(src)].filter((id) => !mine.has(id) && !/-modal$/.test(id));
    eq('the waiting state hides everything ' + fn + ' does', theirs, []);
  }
  ck(/showStandardPanels\(false\)/.test(enter), 'and the Stakes panels with them');
  ck(/boardDisplay\.innerHTML = ""/.test(enter),
     'and clears the board, so no word from the mode just left sits under the new name');
  // Clash and FFA raise no play surface of their own - they inherit whatever
  // the leave path left up - so taking the keyboard down here would strand
  // them with nothing to type on.
  ck(!/setSprintPlaySurfaceVisible|setMarathonPlaySurfaceVisible|setGauntletPlaySurfaceVisible/.test(enter),
     'but leaves the play surface alone, which Clash and FFA still inherit', enter);
  ck(/MODES\[target\]\.label/.test(enter) && /MODES\[target\]\.color/.test(enter),
     'and names the mode in its own colour, out of the one table', enter);
}

// ---- coming back to Stakes lands on a board with tiles on it -------------------
// The header said WORD 1 over an empty grid. Several modes empty boardDisplay
// on their way out - a finished Sprint does, and so does the mode-switch
// waiting state - and the way back to Stakes only ever STARTED a run, which
// it correctly skips when one is already going. So the run survived, the
// score survived, and the board did not.
//
// Run, not read: the bug was a function that did the right thing and stopped
// one step early, which reads fine.
{
  const surfaceSrc = (html.match(/        function showStandardSurface\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  const paintSrc = (html.match(/        function paintStandardBoard\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!surfaceSrc && !!paintSrc, 'both halves are findable', (surfaceSrc + paintSrc).slice(0, 50));

  const back = (word, priorGuesses) => {
    const board = { innerHTML: 'LEFT OVER FROM THE LAST MODE', children: [], appendChild(n) { this.children.push(n); } };
    const called = [];
    const el = () => ({ style: {}, innerText: '', set innerHTML(v) {}, get innerHTML() { return ''; } });
    // eslint-disable-next-line no-new-func
    new Function('document', 'boardDisplay', 'targetWord', 'currentWordGuesses', 'maxGuesses',
      'window', 'renderModeNav', 'showStandardPanels', 'loadHomeBoard', 'resetKeyboardColors',
      'renderCompletedGuessRow', 'checkDangerRow', 'updateSkipButton', 'updateWordLabel', 'called', `
        let currentGuess = '', currentRow = 0, isAnimating = false, myMiniBoard = [];
        function createBoard(rows = maxGuesses) {
          boardDisplay.innerHTML = '';
          for (let i = 0; i < rows; i++) boardDisplay.appendChild({ row: i });
        }
        ${paintSrc}
        ${surfaceSrc}
        showStandardSurface();`)(
      { getElementById: el }, board, word, priorGuesses, 5,
      { startNewRun: () => called.push('startNewRun') },
      () => {}, () => {}, () => {}, () => {},
      (row) => called.push('row' + row), () => {}, () => {}, () => {}, called);
    return { board, called };
  };

  {
    // The case in the screenshot: a Stakes run was live underneath Sprint.
    const o = back('CRANE', []);
    ck(!o.called.includes('startNewRun'), 'a live run is not thrown away on the way back',
       o.called.join(','));
    eq('and its board is drawn rather than left empty', o.board.children.length, 5);
    ck(o.board.innerHTML !== 'LEFT OVER FROM THE LAST MODE',
       'so nothing from the mode just left is still on screen', String(o.board.innerHTML));
  }
  {
    // Mid-word: the guesses already made have to come back with it.
    const o = back('CRANE', [{ guess: 'ARISE', colors: ['absent'] }, { guess: 'CRONE', colors: ['correct'] }]);
    eq('a half-played word comes back with its guesses', o.called.filter((c) => /^row/.test(c)), ['row0', 'row1']);
  }
  {
    // No run at all is still a new one, which is what the guard was for.
    const o = back('', []);
    ck(o.called.includes('startNewRun'), 'and with no run at all, one is started', o.called.join(','));
    ck(!o.called.some((c) => /^row/.test(c)), 'with nothing replayed onto it', o.called.join(','));
  }

  // Boot had the only copy of this. Two copies is two ideas of what a resumed
  // board looks like, and only one of them gets fixed next time.
  const boot = html.slice(html.indexOf('// Resume mid-word instead of starting a brand new one'));
  ck(/paintStandardBoard\(\);/.test(boot.slice(0, 400)),
     'and boot resumes through the same painter', boot.slice(0, 300).replace(/\r?\n\s*/g, ' '));
}

// ---- the Trifecta card is off the other modes' screens ------------------------
// It sat under the Stakes board pitching a different mode every time you
// chose this one. Off by a flag rather than deleted, like a closed mode: the
// card, its countdown and its standing line are all still here.
{
  ck(/const SHOW_TRIFECTA_CARD = false;/.test(html),
     'the cross-sell card is switched off', (html.match(/const SHOW_TRIFECTA_CARD = \w+;/) || [''])[0]);
  ck(/getElementById\("gauntlet-card"\)\.style\.display = \(visible && SHOW_TRIFECTA_CARD\)/.test(html),
     'and the Stakes panels no longer bring it up with them');
  // The choke point. Several callers paint this card, and gating them one by
  // one is how one gets missed - this one also stops its countdown starting.
  const card = (html.match(/        async function refreshGauntletCard\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(/^\s*\/\/[\s\S]*?if \(!SHOW_TRIFECTA_CARD\) return;/m.test(card)
     || /if \(!SHOW_TRIFECTA_CARD\) return;/.test(card),
     'and the card itself refuses to be painted', card.slice(0, 260));
  ck(/<div id="gauntlet-card" style="display:none;">/.test(html),
     'and it ships hidden, so it is never up before the script runs');
}

// ---- a closed mode takes its tabs with it -------------------------------------
// The nav is handled by renderModeNav; this is everywhere else a mode's name
// appears. Run for real, because the point is which elements it reaches for.
{
  const src = (html.match(/        function applyHiddenModeUi\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!src, 'applyHiddenModeUi is findable', src.slice(0, 60));
  const modesSrc = (html.match(/        const MODES = \{\n[\s\S]*?\n        \};/) || [''])[0];
  const els = {};
  // Every tab the page actually ships, so a mode with no tab is not invented.
  for (const id of ['tab-clash', 'tab-ffa', 'tab-prof-clash', 'tab-prof-ffa',
                    'tab-prof-gauntlet', 'tab-daily']) els[id] = { style: { display: 'LEFT ALONE' } };
  // eslint-disable-next-line no-new-func
  new Function('document', `${modesSrc}
    const MODE_ORDER = Object.keys(MODES);
    ${src}; applyHiddenModeUi();`)({ getElementById: (id) => els[id] || null });

  eq('a closed mode loses its leaderboard tab', els['tab-ffa'].style.display, 'none');
  eq('and its profile tab', els['tab-prof-ffa'].style.display, 'none');
  eq('an open mode keeps its leaderboard tab', els['tab-clash'].style.display, '');
  eq('and its profile tab', els['tab-prof-clash'].style.display, '');
  eq('and so does Trifecta, whose tab is keyed on the mode name it has always had',
     els['tab-prof-gauntlet'].style.display, '');
  // tab-daily is the leaderboard PERIOD, not a mode. Nothing should touch it.
  eq('a tab that is not a mode is left alone entirely', els['tab-daily'].style.display, 'LEFT ALONE');
}

// The nav answers the tap, not the server.
{
  const nav = (html.match(/        function renderModeNav\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(/const here = pendingMode \|\| currentMode\(\);/.test(nav),
     'the nav marks the mode being switched to while it loads', nav.slice(0, 400));
  // currentMode() stays the truth about who owns the screen. Everything that
  // decides behaviour - goToMode's own guard, inAltMode - reads that.
  const alt = (html.match(/function inAltMode\(\) \{[^\n]*\}/) || [''])[0];
  ck(!/pendingMode/.test(alt), 'and nothing that decides behaviour reads it', alt);
  const go2 = (html.match(/        window\.goToMode = async function\(target\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(/target === currentMode\(\)/.test(go2), 'goToMode still guards on currentMode, not the pending one');
}

// ---- the nav scales ---------------------------------------------------------
ck(/grid-template-columns: repeat\(var\(--mode-cols, 4\), minmax\(0, 1fr\)\)/.test(html),
   'the nav takes its column count from a variable rather than a hardcoded four');
// Presence only. The VALUE is checked against the mode table below, which is
// the assertion that cannot go stale — this one hardcoded 5 and broke the
// moment a sixth mode arrived, reporting a layout bug that did not exist.
ck(/<nav class="arcade-menu" aria-label="Game mode" style="--mode-cols: \d+; --mode-cols-narrow: \d+;">/.test(html),
   'and the markup carries it, so the nav is laid out correctly before any script runs');
{
  const modes = (html.match(/const MODES = \{[\s\S]*?\n        \};/) || [''])[0];
  const count = (modes.match(/^\s{12}\w+:/gm) || []).length;
  const hidden = (modes.match(/hidden: true/g) || []).length;
  const declared = Number((html.match(/style="--mode-cols: (\d+);/) || [])[1]);
  eq('the markup declares a column per mode a player can reach', declared, count - hidden);
  // A hidden mode keeps its button so the table alone can bring it back;
  // renderModeNav hides the spares. So there is a button for every mode in
  // the table, not for every column.
  const buttons = ((html.match(/<nav class="arcade-menu"[\s\S]*?<\/nav>/) || [''])[0].match(/<button/g) || []).length;
  eq('and there is still a button for every mode in the table', buttons, count);
  // Four modes across three columns is a row of three and an orphan. The
  // narrow count has to divide them.
  const narrow = Number((html.match(/--mode-cols-narrow: (\d+);/) || [])[1]);
  eq('and the phone wraps them into full rows', (count - hidden) % narrow, 0);
}


const boardSrc = html.slice(html.indexOf('async function loadSprintBoard()'),
  html.indexOf('async function loadSprintBoard()') + 2500);

// ---- the board is not painted into a hidden container -----------------------
// openSprint calls showStandardPanels(false) to clear the Stakes furniture,
// and that hides #daily-board-container outright — the very element this
// board's rows are written into. Without taking the container back, every row
// landed in a hidden element and the board simply never appeared while
// playing. It looked fine on the landing screen, which does not call
// showStandardPanels at all, which is exactly why it survived review.
{
  const open = html.slice(html.indexOf('window.openSprint = async function'), html.indexOf('function startSprintRound'));
  ck(/showStandardPanels\(false\)/.test(open), 'openSprint clears the Stakes panels', open.slice(0, 80));
  ck(/document\.getElementById\("daily-board-container"\)\.style\.display = "block";/.test(boardSrc),
     'and the board takes the container back before writing into it');
  // The tab row switches between the three STAKES boards. Leaving it up over
  // a Sprint board shows "All Time" highlighted above today's standings.
  ck(/document\.getElementById\("home-board-tabs"\)\.style\.display = "none";/.test(boardSrc),
     'and hides the Stakes tab row, which does not apply to this board');
}
// ...and the tab row comes back on every route out, not just this mode's.
{
  const panels = html.slice(html.indexOf('function showStandardPanels(visible)'));
  ck(/if \(visible\) document\.getElementById\("home-board-tabs"\)\.style\.display = "";/.test(panels.slice(0, 900)),
     'showStandardPanels restores the tab row, so any way back to Stakes restores it');
}


// ---- nobody hand-maintains a list of mode flags ----------------------------
// The auth handler asked `!isDailyMode && !isVersusMode && !isFfaMode` before
// putting the Stakes panels back. That list was written before Sprint and
// Marathon existed, so once auth resolved it restored the Stakes tab row and
// card over the Sprint landing that had painted a moment earlier — and the
// restored tabs were then tappable, which repainted the Stakes board over
// Sprint's standings. The screen looked right for about a second.
//
// The bug is the hand-written list, not the missing entry, so what is pinned
// here is that no such list decides whether the Stakes furniture comes back.
{
  const handRolled = [...html.matchAll(/if \(!is\w+Mode(?: && !is\w+Mode)+\)\s*(showStandardPanels\(true\)|refreshGauntletCard\(\))/g)]
    .map((m) => m[0]);
  eq('no hand-written list of mode flags decides whether the Stakes panels return', handRolled, []);
  ck(/function inAltMode\(\) \{ return currentMode\(\) !== "endless"; \}/.test(html),
     'inAltMode is derived from currentMode(), which is the one place that knows the flags');
  ck(/if \(!inAltMode\(\)\) showStandardPanels\(true\);/.test(html),
     'and the auth handler asks it rather than a list of its own');
}

// ---- one container, one owner ------------------------------------------------
// Sprint and Marathon borrow #daily-board-container. Every path that could
// repaint it has to ask first, including the two asynchronous ones: the boot
// query is already in flight before the landing decides which mode it is in,
// and the daily listener outlives the screen it was opened for.
{
  const guards = (html.match(/if \(modeOwnsHomeBoard\(\)\) return;/g) || []).length;
  ck(guards >= 3, 'every repaint path checks whether a mode owns the board', `${guards} guard(s)`);
  // Anchored on the DEFINITION. `window.setHomeBoard` also appears as an
  // onclick in the tab markup thousands of lines earlier, so the bare name
  // slices backwards and hands this an empty string — the third check in this
  // repo to be caught out by a handler name that is also in an attribute.
  const usersFrom = html.indexOf('async function loadUsersBoard()');
  const usersTo = html.indexOf('window.setHomeBoard = function');
  ck(usersFrom !== -1 && usersTo > usersFrom, 'loadUsersBoard is findable', `${usersFrom}..${usersTo}`);
  const users = html.slice(usersFrom, usersTo);
  const awaitAt = users.indexOf('await getDocs');
  const guardAt = users.indexOf('if (modeOwnsHomeBoard()) return;');
  ck(guardAt > awaitAt, 'and loadUsersBoard checks AFTER its await, not only before it',
     `await@${awaitAt} guard@${guardAt}`);
  ck(/function modeOwnsHomeBoard\(\) \{ return isSprintMode \|\| isMarathonMode; \}/.test(html),
     'the owners are named explicitly, because this is not "every mode except Stakes"');
}


// ---- a header shown as flex must be styled as one ---------------------------
// #sprint-header and #marathon-header were both shown with style.display =
// "flex" while sitting outside the rule that gives that row its gap, padding
// and width. The result was "0.0sSCORE: 0" - two fields with nothing between
// them - and it looked like a text bug rather than a missing selector.
//
// The invariant is not "every header": #sudden-death-header is deliberately a
// centred block with its own inline styles. It is "every header the code
// shows as a flex row shares the rule that makes flex rows work".
{
  const flexHeaders = [...html.matchAll(/getElementById\("([a-z-]+-header)"\)\.style\.display = "flex"/g)]
    .map((m) => m[1]);
  ck(flexHeaders.length >= 2, 'the mode headers are findable', flexHeaders.join(' '));
  const rule = (html.match(/^\s*#score-board[^{]*\{/m) || [''])[0];
  ck(/display: flex/.test(html.slice(html.indexOf(rule), html.indexOf(rule) + 400)),
     'and the shared header rule is the flex one', rule.trim());
  const missing = [...new Set(flexHeaders)].filter((h) => !rule.includes('#' + h));
  eq('every header shown as a flex row is in that rule', missing, []);
}


// ---- the header reads score first -------------------------------------------
// The clock is the TIEBREAKER, not the result. Leading with it put the
// secondary number in the primary position, and it disagreed with the board
// row below, which has always been score-then-time.
{
  const hdr = html.slice(html.indexOf('<div id="sprint-header"'),
                         html.indexOf('</div>', html.indexOf('id="sprint-clock"')));
  const scoreAt = hdr.indexOf('id="sprint-score"');
  const clockAt = hdr.indexOf('id="sprint-clock"');
  ck(scoreAt !== -1 && clockAt !== -1, 'the header carries both a score and a clock', `${scoreAt}/${clockAt}`);
  ck(scoreAt < clockAt, 'and the score comes first, matching the board row', `score@${scoreAt} clock@${clockAt}`);
  // 8px ran them together into one string on a phone.
  const gap = (html.match(/#sprint-header, #marathon-header \{ gap: var\(--s-(\d+)\); \}/) || [])[1];
  const shared = (html.match(/display: flex; gap: var\(--s-(\d+)\)/) || [])[1];
  ck(gap && shared && Number(gap) > Number(shared),
     'and the two numbers sit further apart than the shared header gap', `${gap} vs ${shared}`);
}


// ---- the board row reads time, then score -----------------------------------
// Score last, so reading left to right the row ends on the number that decides
// the order, and the clock sits behind it as the detail rather than competing
// with it. The header leads with score for the opposite reason: there it is
// the readout, not the ranking.
{
  // Anchored on the DEFINITION of leaveSprint. The bare name is also an
  // onclick in the end-modal markup thousands of lines earlier, which has
  // sliced a check backwards into an empty string three times in this repo.
  const from = html.indexOf('async function loadSprintBoard()');
  const to = html.indexOf('window.leaveSprint = function');
  ck(from !== -1 && to > from, 'the Sprint board builder is findable', `${from}..${to}`);
  const board = html.slice(from, to);

  const timeAt = board.indexOf('formatSprintTime(r.elapsedMs)');
  const scoreAt = board.indexOf('Number(r.score || 0).toLocaleString()');
  ck(timeAt !== -1 && scoreAt !== -1, 'the row carries both a time and a score', `${timeAt}/${scoreAt}`);
  ck(timeAt < scoreAt, 'and the time comes first, with the score last', `time@${timeAt} score@${scoreAt}`);

  // A single space put two numbers close enough to scan as one value.
  const timeSpan = board.slice(board.lastIndexOf('<span', timeAt), timeAt);
  ck(/margin-right: var\(--s-\d+\)/.test(timeSpan),
     'separated by a real margin rather than a space', timeSpan);
}


// ---- the card knows whether today is already spent ---------------------------
// It said "Play Today's Word" to somebody who had already played it, and only
// admitted otherwise after they tapped. The answer was on the profile the page
// had already loaded the whole time: sprintLastDate is written by onRunCreated
// on BOTH a solve and a miss, so it answers "have I played" rather than "have
// I won" - and reading it costs nothing, which matters on a landing that
// deliberately calls no server.
{
  const lift = (re, what) => {
    const m = html.match(re);
    if (!m) throw new Error('could not extract ' + what);
    return m[0];
  };
  const cardSrc = [
    lift(/        function sprintPlayedToday\(\) \{\n[\s\S]*?\n        \}/, 'sprintPlayedToday'),
    lift(/        function renderSprintCard\(\) \{\n[\s\S]*?\n        \}/, 'renderSprintCard'),
  ].join('\n\n');

  const render = (profile, today) => {
    const els = {
      'sprint-card-body': { innerText: '' },
      'sprint-card-btn': { innerText: '' },
      'sprint-card-stats': { innerText: '' },
    };
    // eslint-disable-next-line no-new-func
    new Function('document', 'userProfileData', 'getTodayDateStr', `
      ${cardSrc}
      renderSprintCard();
    `)({ getElementById: (id) => els[id] || null }, profile, () => today);
    return els;
  };

  const TODAY = '2026-11-02';

  {
    const e = render({ sprintPlayed: 0 }, TODAY);
    ck(/Play Today/.test(e['sprint-card-btn'].innerText), 'an unplayed day offers to play', e['sprint-card-btn'].innerText);
    ck(/five guesses/.test(e['sprint-card-body'].innerText), 'and explains the mode', e['sprint-card-body'].innerText);
    // "Played 0 - 0% solved" reads as a judgement rather than a stat.
    eq('a first-time visitor is shown no career line at all', e['sprint-card-stats'].innerText, '');
  }
  {
    const e = render({ sprintLastDate: TODAY, sprintPlayed: 13, sprintSolved: 12, sprintStreak: 6, sprintBestStreak: 7 }, TODAY);
    ck(/already played/.test(e['sprint-card-body'].innerText), 'a spent day says so', e['sprint-card-body'].innerText);
    ck(/View Today/.test(e['sprint-card-btn'].innerText), 'and the button offers the result, not another go', e['sprint-card-btn'].innerText);
    eq('with the career line beside it',
       e['sprint-card-stats'].innerText, 'Played 13 \u00B7 92% solved \u00B7 Streak 6 (best 7)');
  }
  {
    // Yesterday is not today. The streak survives; the day does not.
    const e = render({ sprintLastDate: '2026-11-01', sprintPlayed: 12, sprintSolved: 11, sprintStreak: 5, sprintBestStreak: 7 }, TODAY);
    ck(/Play Today/.test(e['sprint-card-btn'].innerText),
       'having played YESTERDAY still offers today', e['sprint-card-btn'].innerText);
  }
  {
    // The landing paints before auth resolves, so this runs with no profile.
    const e = render(null, TODAY);
    ck(/Play Today/.test(e['sprint-card-btn'].innerText), 'no profile yet offers to play rather than throwing');
    eq('and shows no career line', e['sprint-card-stats'].innerText, '');
  }
  {
    // The best streak is only worth saying when it is not the one you are on.
    const e = render({ sprintLastDate: TODAY, sprintPlayed: 7, sprintSolved: 7, sprintStreak: 7, sprintBestStreak: 7 }, TODAY);
    eq('a personal best in progress is not also reported as a past one',
       e['sprint-card-stats'].innerText, 'Played 7 \u00B7 100% solved \u00B7 Streak 7');
  }

  // It has to be repainted when the profile lands, or it is permanently the
  // pre-auth version of itself.
  const repaints = (html.match(/renderSprintCard\(\);/g) || []).length;
  ck(repaints >= 3, 'the card is painted on the landing AND again once the profile arrives', `${repaints} call(s)`);
  // And still nothing is fetched to decide any of it.
  const renderFn = lift(/        function renderSprintCard\(\) \{\n[\s\S]*?\n        \}/, 'renderSprintCard');
  ck(!/await|callStartSprint|getDoc|getDocs/.test(renderFn),
     'none of which costs a read', renderFn.slice(0, 120));
}


// ---- the end-of-round statistics ---------------------------------------------
// Four pills and a guess distribution, drawn with the same .stat-pill and
// .stat-bar-* the Profile already uses, so this is one design rather than two.
//
// TWO DESTINATIONS, ONE RENDERER. The same content is drawn into the end modal
// and into the panel under the board, by one function given a prefix rather
// than by two copies. Two copies is how the modal and the panel end up
// disagreeing about a player's streak.
{
  const statsSrc = (html.match(/        function renderSprintStats\(todayRow, prefix\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!statsSrc, 'renderSprintStats is findable, and takes the prefix', statsSrc.slice(0, 60));

  const draw = (profile, todayRow, prefix = 'sprint-end') => {
    // Exactly the three elements the prefix builds, and nothing else. A
    // lookup the prefix did not build - the way a half-done rename shows up -
    // gets null and throws here, rather than quietly writing into whichever
    // real element still answers to the old id.
    const els = {};
    for (const part of ['stats', 'dist-wrap', 'dist']) els[prefix + '-' + part] = { innerHTML: '', style: {} };
    // eslint-disable-next-line no-new-func
    new Function('document', 'userProfileData',
      `${statsSrc}; renderSprintStats(${todayRow}, ${JSON.stringify(prefix)});`)(
      { getElementById: (id) => els[id] || null }, profile);
    return {
      pills: els[prefix + '-stats'].innerHTML,
      dist: els[prefix + '-dist'].innerHTML,
      wrap: els[prefix + '-dist-wrap'].style,
    };
  };

  const P = { sprintPlayed: 12, sprintSolved: 11, sprintStreak: 5, sprintBestStreak: 7,
              sprintG1: 0, sprintG2: 1, sprintG3: 4, sprintG4: 5, sprintG5: 1 };

  {
    const o = draw(P, 4);
    // The four Wordle numbers, in that order.
    const nums = [...o.pills.matchAll(/<b>([^<]*)<\/b>/g)].map((m) => m[1]);
    eq('four pills: played, win rate, current streak, max streak', nums, ['12', '92', '5', '7']);
    ck(/Played/.test(o.pills) && /Win %/.test(o.pills), 'labelled', o.pills.slice(0, 120));
    ck(/Current<br>Streak/.test(o.pills) && /Max<br>Streak/.test(o.pills),
       'with the two streaks on two lines so four fit across a phone');

    // 1-5 and X.
    const rows = [...o.dist.matchAll(/stat-label">([^<]*)</g)].map((m) => m[1]);
    eq('six rows, one per guess count plus a miss row', rows, ['1', '2', '3', '4', '5', 'X']);
    // Derived, not counted: 12 played - 11 solved.
    const counts = [...o.dist.matchAll(/">(\d*)<\/div><\/div><\/div>/g)].map((m) => m[1]);
    eq('and the X row is played minus solved', counts[5], '1');

    // The row you just landed on is the one lit, which is the entire reason
    // this chart is worth showing on the screen where you finished.
    const bars = o.dist.split('stat-bar-fill');
    ck(/var\(--c-sprint\)/.test(bars[4]), "today's row is highlighted", bars[4].slice(0, 90));
    ck(!/var\(--c-sprint\)/.test(bars[3]) && !/var\(--c-sprint\)/.test(bars[5]),
       'and only that row', bars[3].slice(0, 80));
    // The tallest bar is full width; everything else is relative to it.
    ck(/width: 100%/.test(o.dist), 'the tallest bar fills the row', o.dist.slice(0, 160));
  }
  {
    // A miss lands on X, not on a guess row.
    const o = draw({ ...P, sprintPlayed: 13, sprintSolved: 11 }, 0);
    const bars = o.dist.split('stat-bar-fill');
    ck(/var\(--c-sprint\)/.test(bars[6]), 'a missed word highlights the X row instead', bars[6].slice(0, 90));
  }
  {
    // Before the counters are deployed there is nothing to draw, and an
    // all-zero chart under a heading reads as broken rather than empty.
    const o = draw({ sprintPlayed: 0, sprintSolved: 0 }, 0);
    eq('with no history at all the whole distribution section is hidden', o.wrap.display, 'none');
    const nums = [...o.pills.matchAll(/<b>([^<]*)<\/b>/g)].map((m) => m[1]);
    eq('but the pills still render, at zero rather than NaN', nums, ['0', '0', '0', '0']);
  }
  {
    // A player who has played but whose per-guess counters predate the
    // deploy: X alone is still a distribution worth drawing.
    const o = draw({ sprintPlayed: 3, sprintSolved: 1 }, 0);
    ck(o.wrap.display !== 'none', 'a miss-only history still draws', JSON.stringify(o.wrap));
  }
  {
    // The panel under the board is not a summary of the modal, it is the same
    // screen in a second place, so it has to come out character for character
    // the same - including which row is lit, which is the only part that
    // depends on today.
    const modal = draw(P, 4, 'sprint-end');
    const panel = draw(P, 4, 'sprint-panel');
    eq('the panel under the board draws the modal\'s pills', panel.pills, modal.pills);
    eq('and the modal\'s distribution, today\'s row and all', panel.dist, modal.dist);
    eq('and reveals its chart on the same condition', panel.wrap.display, modal.wrap.display);
  }
  {
    // Each destination hides its OWN chart. Reaching for the wrap by a fixed
    // id would leave one of the two sections standing empty under a heading.
    const panel = draw({ sprintPlayed: 0, sprintSolved: 0 }, 0, 'sprint-panel');
    eq('with nothing to draw the panel hides the panel\'s chart', panel.wrap.display, 'none');
  }
}

// The counters it reads have to be maintained, and a client cannot seed them.
{
  const career = fn.slice(fn.indexOf("Sprint's career record"), fn.indexOf("The recurring board"));
  for (let i = 1; i <= 5; i++) {
    ck(new RegExp(`update\\.sprintG${i} = FieldValue\\.increment\\(g${i}\\)`).test(career),
       `onRunCreated counts a solve on guess ${i}`, career.slice(0, 80));
  }
  for (let i = 1; i <= 5; i++) {
    ck(new RegExp(`!\\('sprintG${i}' in request\\.resource\\.data\\)`).test(rules),
       `a new account cannot arrive with sprintG${i} already set`);
  }
}

// Share leads. In a one-word-a-day mode it is the only action that brings
// anyone else in; the other two are navigation.
{
  const modal = html.slice(html.indexOf('<div id="sprint-end-modal"'), html.indexOf('<!-- MAIN MENU MODAL -->'));
  const buttons = [...modal.matchAll(/<button class="(btn-\w+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
  eq('exactly one primary action in the end modal',
     buttons.filter(([c]) => c === 'btn-primary').length, 1);
  eq('and it is Share', (buttons.find(([c]) => c === 'btn-primary') || [])[1], 'Share Result');
}


// ---- the screen you land on after finishing ----------------------------------
// "Today's Leaderboard" dismisses the end modal, and what was left behind it
// was a header, one row and then the site blurb - the emptiest screen in the
// game, reached by finishing the thing the game is about. The stats and the
// share button live under the standings as well, so there is something there.
{
  const panel = html.slice(html.indexOf('<div id="sprint-done-panel"'),
                           html.indexOf('<!-- Trifecta headline card'));
  ck(panel.length > 100 && panel.length < 2000, 'the panel is findable', 'length ' + panel.length);

  // Under the board, not over it. The button that gets you here promised the
  // leaderboard, so the standings stay the first thing on the screen - which
  // is the one thing the modal could not do.
  ck(html.indexOf('<button id="home-board-more"') < html.indexOf('<div id="sprint-done-panel"'),
     'and sits below the standings rather than above them');

  for (const id of ['sprint-panel-stats', 'sprint-panel-dist-wrap', 'sprint-panel-dist']) {
    ck(new RegExp('id="' + id + '"').test(panel), 'it carries ' + id + ', which the renderer writes into');
  }
  ck(/STATISTICS/.test(panel) && /GUESS DISTRIBUTION/.test(panel),
     'under the same two headings as the modal');
  ck(/id="sprint-panel-dist-wrap"[^>]*display:none/.test(panel),
     'with its chart hidden until the renderer finds one to draw');
  ck(/<div id="sprint-done-panel" style="display:none;"/.test(panel),
     'and the whole panel hidden until the word is done');
  // It is a card like the others on that screen, not loose text under the
  // board: the shared shell is what makes it read as part of the page.
  const shell = (html.match(/^[^\n]*#sprint-done-panel[^\n]*$/m) || [''])[0];
  ck(/#daily-board-container/.test(shell) && /#sprint-card/.test(shell),
     'and takes the same card shell as the board and the card above it', shell.trim().slice(0, 120));
}

// Its own share button, which has to be the one that reports back.
{
  const panel = html.slice(html.indexOf('<div id="sprint-done-panel"'),
                           html.indexOf('<!-- Trifecta headline card'));
  ck(/id="btn-sprint-share-panel"/.test(panel), 'the panel has a share button of its own');
  ck(/class="btn-primary" id="btn-sprint-share-panel"/.test(panel),
     'styled as the primary action, since on this screen it is the only one');
  // The helper flashes COPIED! or COPY FAILED on the button it is handed.
  // Handed none, it would flash the modal's - which by then is hidden, so a
  // successful copy would look like nothing happening.
  ck(/shareSprintResult\('btn-sprint-share-panel'\)/.test(panel),
     'and names itself, so the label that reports the copy is the one on screen');

  const share = html.slice(html.indexOf('window.shareSprintResult = function'),
                           html.indexOf('// Today\'s Sprint board.'));
  ck(/window\.shareSprintResult = function\(btnId\)/.test(share),
     'shareSprintResult takes the button to report on');
  ck(/getElementById\(btnId \|\| "btn-sprint-share"\)/.test(share),
     "defaulting to the modal's, which is still how the modal calls it",
     (share.match(/getElementById\(btnId[^)]*\)/) || [''])[0]);
}

// When it is up. Nobody maintains a list of the screens that have to take it
// down - the list is derived from the source, so a seventh way out of Sprint
// is caught by this rather than by a player staring at a dead button.
{
  const JS = html.slice(html.indexOf('<script type="module">'));
  // The nearest preceding top-level declaration owns a line. Brace matching
  // would be prettier and is not safe here: loadLeaderboardData is indented
  // twenty spaces and never closes at eight, so a body scan swallows the four
  // functions after it.
  const starts = [...JS.matchAll(/^        (?:function (\w+)|window\.(\w+) = (?:async )?function)/gm)]
    .map((m) => ({ name: m[1] || m[2], at: m.index }));
  const owner = (i) => { let best = null; for (const f of starts) { if (f.at < i) best = f; else break; } return best && best.name; };
  const owners = (re) => [...JS.matchAll(re)].map((m) => owner(m.index)).sort();

  const shows = owners(/sprint-done-panel"\)\.style\.display = "block"/g);
  const hides = owners(/sprint-done-panel"\)\.style\.display = "none"/g);
  eq('the panel goes up in exactly one place', shows, ['showSprintDonePanel']);

  // And is filled on the way up, in the same body. Raised without being
  // rendered it is two headings over nothing, which is worse than the bare
  // screen it replaced - and that is exactly what happens if a second caller
  // reaches for the display property instead of calling through here.
  const raiser = JS.slice(JS.indexOf('        function showSprintDonePanel('),
                          JS.indexOf('        function showSprintEndModal('));
  ck(/renderSprintStats\([^)]*"sprint-panel"\)/.test(raiser),
     'and the one place that raises it draws into it first', raiser.slice(0, 200));
  ck(raiser.indexOf('renderSprintStats') < raiser.indexOf('= "block"'),
     'in that order, so it is never briefly on screen holding the last result');

  // Its share button returns early without an attempt, so the panel standing
  // on a screen with no attempt is a button that silently does nothing. Every
  // path that drops the attempt therefore has to drop the panel with it.
  ck(/if \(!sprintAttempt\) return;/.test(html), 'sharing does nothing without an attempt to share');
  // `let sprintAttempt = null` is the declaration, not a path out.
  const clears = owners(/(?<!let )sprintAttempt = null;/g);
  ck(clears.length >= 2, 'there is more than one way out of Sprint', clears.join(', '));
  eq('and every one of them takes the panel down', clears.filter((n) => !hides.includes(n)), []);
  // Entering is the same problem from the other side: the panel describes a
  // finished word, and the attempt openSprint starts may be half played.
  ck(hides.includes('openSprint'),
     'as does starting a word, which the panel would otherwise describe as done');
  // Marathon paints the same board area, and reaches it from the main menu
  // without passing through leaveSprint.
  ck(hides.includes('openMarathon') && hides.includes('leaveMarathon'),
     'and so does Marathon, which lands on the same board', hides.join(', '));
}


// ---- a day already finished loads its own result -----------------------------
// The gate said "You have already played today's word" over a button that led
// to the result. That is a tap between the player and the only thing on that
// screen they came back for, so the landing fetches it itself.
//
// The cost is the one thing to watch: this is the only Cloud Function the
// landing calls, boot says in as many words that it calls none, and the reason
// is that awaiting a cold-startable callable in front of the home screen is
// what used to leave the page sitting on an Stakes board for seconds.
{
  const src = (html.match(/        async function autoOpenSprintResult\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!src, 'autoOpenSprintResult is findable', src.slice(0, 60));

  // The real function, run against stubs. The stub records the gate's state at
  // the moment it is called, which is the only way to tell a label set BEFORE
  // the await from one set after it - and only the former is visible.
  const run = async (state) => {
    const calls = [];
    const btn = { innerText: "View Today's Result", disabled: false };
    const doc = { getElementById: (id) => (id === 'sprint-card-btn' ? btn : null) };
    const win = { openSprint: async (opts) => {
      calls.push({ opts, labelWhileLoading: btn.innerText, disabledWhileLoading: btn.disabled });
    } };
    // eslint-disable-next-line no-new-func
    const body = new Function('isSprintMode', 'sprintAttempt', 'sprintOpening', 'sprintPlayedToday',
                              'document', 'window', 'renderSprintCard',
      `${src}; return autoOpenSprintResult();`);
    await body(state.inSprint, state.attempt || null, !!state.opening, () => !!state.played,
               doc, win, () => calls.push('render'));
    return { calls, opens: calls.filter((c) => c && c.opts !== undefined), btn };
  };

  {
    const o = await run({ inSprint: true, played: true });
    eq('a day already finished is loaded without being asked', o.opens.length, 1);
    eq('and loaded silently, so there is no modal to dismiss on arrival',
       o.opens[0].opts, { silent: true });
    ck(/Loading/.test(o.opens[0].labelWhileLoading),
       'with the gate saying what it is doing while it waits', o.opens[0].labelWhileLoading);
    eq('and not tappable, so a tap cannot start a second one', o.opens[0].disabledWhileLoading, true);
    // The open may have failed, in which case the gate is still the only way
    // in. A gate left disabled on its loading label is a dead end.
    eq('but tappable again afterwards either way', o.btn.disabled, false);
  }
  {
    const o = await run({ inSprint: true, played: false });
    eq('a day not yet played is left as the offer it is', o.opens.length, 0);
  }
  {
    const o = await run({ inSprint: true, played: true, attempt: { status: 'finished' } });
    eq('a result already open is not fetched a second time', o.opens.length, 0);
  }
  {
    const o = await run({ inSprint: true, played: true, opening: true });
    // Both profile paths call this, and the second can land while the first
    // is still in the air. Two startSprint calls is two clocks.
    eq('nor is one already on its way', o.opens.length, 0);
  }
  {
    const o = await run({ inSprint: false, played: true });
    // The profile arrives whenever it arrives; by then the player may have
    // tapped STAKES, and yanking them back would be worse than a tap.
    eq('and a player who has moved on is left where they are', o.opens.length, 0);
  }
}

// What "silently" means, at source.
{
  const open = html.slice(html.indexOf('        window.openSprint = async function'),
                          html.indexOf('        function startSprintRound()'));
  ck(/window\.openSprint = async function\(opts\)/.test(open), 'openSprint takes the options');
  ck(/const silent = !!\(opts && opts\.silent\);/.test(open),
     'and reads them defensively, since the gate calls it with none');
  ck(/if \(!silent\) await showModeIntro\("sprint"\);/.test(open),
     'the intro card is skipped: it BLOCKS on a tap, and nobody tapped');
  ck(/if \(!silent\) alert\(/.test(open),
     'and so is the alert, which would otherwise pop over a page being read');
  ck(/if \(silent\) showSprintDonePanel\(sprintAttempt\);\r?\n\s*else showSprintEndModal\(sprintAttempt, true\);/.test(open),
     'arriving lands on the panel; finishing a word still opens the modal', open.slice(-400));
  // A tap on the gate while the automatic load is in the air must not start a
  // second attempt - and the flag has to clear on the failure path too, or the
  // gate is dead for the rest of the session.
  ck(/if \(sprintOpening\) return;/.test(open), 'a second open while one is in flight is refused');
  ck(/sprintOpening = true;/.test(open) && /\} finally \{\r?\n\s*sprintOpening = false;/.test(open),
     'and the flag clears in a finally, so a failed load does not wedge the gate');
}

// What the player actually ends up looking at, with the real openSprint run.
// The checks above pin the branch at source; this one runs it, because the
// outcome that matters is which of two screens is on top, and that is the sum
// of a dozen display properties rather than one line of source.
{
  const src = (html.match(/        window\.openSprint = async function\(opts\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!src, 'openSprint is findable', src.slice(0, 60));
  // The two that decide the outcome are lifted and run for real; everything
  // else openSprint touches is view plumbing and is recorded, not simulated.
  const panelSrc = (html.match(/        function showSprintDonePanel\(attempt\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  const statsSrc2 = (html.match(/        function renderSprintStats\(todayRow, prefix\) \{\n[\s\S]*?\n        \}/) || [''])[0];

  const open = async (opts, attempt) => {
    const els = new Map();
    const el = (id) => { if (!els.has(id)) els.set(id, { id, innerHTML: '', style: {} }); return els.get(id); };
    const called = [];
    const rec = (name) => (...a) => called.push(name);
    // eslint-disable-next-line no-new-func
    const body = new Function('document', 'currentUser', 'callStartSprint', 'userProfileData',
      'showModeIntro', 'renderModeNav', 'showStandardPanels', 'loadSprintBoard', 'boardDisplay',
      'resetKeyboardColors', 'setSprintPlaySurfaceVisible', 'setSprintClock', 'setSprintScoreLabel',
      'setSprintWorth', 'showSprintEndModal', 'startSprintRound', 'called', 'OPTS', `
        let isSprintMode = false, sprintAttempt = null, sprintOpening = false;
        const window = {};
        ${statsSrc2}
        ${panelSrc}
        ${src}
        return window.openSprint(OPTS).then(() => ({ isSprintMode, sprintAttempt }));`);
    const out = await body(
      { getElementById: el }, { uid: 'u' },
      async () => ({ data: { attempt } }),
      { sprintPlayed: 9, sprintSolved: 8, sprintStreak: 3, sprintBestStreak: 5, sprintG3: 8 },
      rec('showModeIntro'), rec('renderModeNav'), rec('showStandardPanels'), rec('loadSprintBoard'),
      { innerHTML: '' }, rec('resetKeyboardColors'), rec('setSprintPlaySurfaceVisible'),
      rec('setSprintClock'), rec('setSprintScoreLabel'), rec('setSprintWorth'),
      rec('showSprintEndModal'), rec('startSprintRound'), called, opts);
    return { called, out, disp: (id) => (els.get(id) || { style: {} }).style.display,
             html_: (id) => (els.get(id) || {}).innerHTML };
  };

  const done = { status: 'finished', solved: true, score: 300, elapsedMs: 41000,
                 guesses: [{ guess: 'AAAAA', colors: [0, 0, 0, 0, 0] },
                           { guess: 'BBBBB', colors: [0, 0, 0, 0, 0] },
                           { guess: 'CRANE', colors: [2, 2, 2, 2, 2] }] };

  {
    const o = await open({ silent: true }, done);
    eq('a silent open raises the panel under the board', o.disp('sprint-done-panel'), 'block');
    ck(!o.called.includes('showSprintEndModal'),
       'and opens no modal over it, which is the whole point', o.called.join(', '));
    ck(!o.called.includes('showModeIntro'), 'nor an intro card nobody asked for', o.called.join(', '));
    eq('the gate it replaces is taken down', o.disp('sprint-card'), 'none');
    ck(/stat-bar-fill/.test(o.html_('sprint-panel-dist')) && /stat-pill/.test(o.html_('sprint-panel-stats')),
       'and the panel it put up has the stats in it', o.html_('sprint-panel-stats').slice(0, 80));
    eq('with the board loaded under it, since that is the screen', o.called.filter((c) => c === 'loadSprintBoard').length, 1);
  }
  {
    // Finishing a word is still a result you just got.
    const o = await open(undefined, done);
    ck(o.called.includes('showSprintEndModal'), 'an ordinary open still opens the modal', o.called.join(', '));
    // And leaves the panel to it. There is one raiser (pinned above) and the
    // modal calls it, so openSprint reaching for the display property here
    // would be a second one - which is the shape that drifts.
    eq('leaving the panel to the modal rather than raising a second copy itself',
       o.disp('sprint-done-panel'), 'none');
  }
  {
    // Defensive: sprintLastDate says finished, the server says otherwise.
    const o = await open({ silent: true }, { status: 'in_progress', guesses: [] });
    ck(o.called.includes('startSprintRound'), 'a day not actually finished resumes the word instead',
       o.called.join(', '));
    ck(o.disp('sprint-done-panel') !== 'block', 'and raises no result panel over a live board',
       String(o.disp('sprint-done-panel')));
  }
}

// Both profile paths go through one body, so neither can miss a step.
{
  const auth = html.slice(html.indexOf('onAuthStateChanged(auth, async (user) => {'),
                          html.indexOf('// Tap-to-join invite links'));
  ck(!/\brenderSprintCard\(\)/.test(auth),
     'the sign-in handler no longer paints the card by hand');
  eq('both profile paths call the one body instead',
     (auth.match(/applyProfileToLanding\(\);/g) || []).length, 2);
  const body = (html.match(/        function applyProfileToLanding\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  for (const step of ['applyEquippedCosmetics', 'renderSprintCard', 'autoOpenSprintResult']) {
    ck(new RegExp(step + '\\(\\)').test(body), 'and that body does ' + step, body.slice(0, 200));
  }
}

// The gate itself stays free. It is painted on every landing, signed in or
// not, and the whole reason boot pays nothing is that this costs nothing.
{
  const card = (html.match(/        function renderSprintCard\(\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!/autoOpenSprintResult|callStartSprint|await/.test(card),
     'rendering the gate still fetches nothing', card.slice(0, 120));
}


// ---- the local mirror keeps the chart honest ---------------------------------
// onRunCreated writes the real counters, but its result takes a moment to come
// back, so reflectSprintLocally mirrors the finished run into userProfileData
// for the modal that opens immediately after. Every Sprint field was mirrored
// there except the per-guess one - which meant the chart drawn seconds later
// was missing the very run that produced it, and on a player's FIRST Sprint
// meant no chart at all, since the section hides when every bar is zero.
{
  const mirrorSrc = (html.match(/        function reflectSprintLocally\(result\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  ck(!!mirrorSrc, 'reflectSprintLocally is findable', mirrorSrc.slice(0, 60));

  const mirror = (profile, result) => {
    // eslint-disable-next-line no-new-func
    new Function('userProfileData', 'getTodayDateStr', 'result', `${mirrorSrc}; reflectSprintLocally(result);`)(
      profile, () => '2026-11-03', result);
    return profile;
  };

  {
    const p = mirror({}, { solved: true, guessNumber: 3, score: 150, elapsedMs: 40000 });
    eq('a solve on guess 3 moves that row', p.sprintG3, 1);
    eq('and only that row', [p.sprintG1, p.sprintG2, p.sprintG4, p.sprintG5],
       [undefined, undefined, undefined, undefined]);
    eq('alongside the counters that were already mirrored', [p.sprintPlayed, p.sprintSolved, p.sprintStreak], [1, 1, 1]);
  }
  {
    // A first-ever Sprint has to produce a drawable chart, or the player sees
    // the heading-less version on the one screen built to show it off.
    const p = mirror({}, { solved: true, guessNumber: 5, score: 10, elapsedMs: 34700 });
    const counts = [1, 2, 3, 4, 5].map((i) => Number(p['sprintG' + i]) || 0);
    counts.push(Math.max(0, (p.sprintPlayed || 0) - (p.sprintSolved || 0)));
    ck(counts.some((c) => c > 0), 'so a first-ever solve gives the distribution something to draw', JSON.stringify(counts));
  }
  {
    // A miss moves no guess row; it is the derived X that accounts for it.
    const p = mirror({}, { solved: false, guessNumber: 5, score: 0, elapsedMs: null });
    eq('a miss moves no guess row', [1, 2, 3, 4, 5].map((i) => p['sprintG' + i]).filter(Boolean), []);
    eq('and shows up as played-not-solved, which is the X row', [p.sprintPlayed, p.sprintSolved], [1, undefined]);
  }
  {
    // Out-of-range guess numbers must not invent a sprintG0 or sprintG6.
    const p = mirror({}, { solved: true, guessNumber: 9, score: 10, elapsedMs: 1 });
    eq('an impossible guess number creates no stray counter',
       // \d, not just the prefix: sprintGuessTotal starts the same way and is
       // a legitimate field, so the loose pattern failed on correct code.
       Object.keys(p).filter((k) => /^sprintG\d$/.test(k)), []);
  }
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
