/*
 * Coming back to Stakes resumes the run. It does not start a new one.
 *
 * The report: leave a Stakes run mid-run, go to Clash, search for a public
 * match, cancel the search - and you land back on Stakes with no score.
 *
 * cancelVersusLobby ended with window.startNewRun(), and startNewRun is the
 * END-of-run action. It zeroes score, continues, wordsGuessed and runStats
 * AND calls clearLocalState(), so the run went in memory and on disk in the
 * same breath. Nothing to recover, at any run size. cancelFfaLobby and
 * leaveDailyGauntlet had the identical line.
 *
 * leaveSprint and leaveMarathon never did: both go through
 * showStandardSurface(), whose guard - "Only start a run if there is not one
 * already" - is about precisely this. Two of the five return paths were
 * fixed and three were not, which is why it looked mode-specific.
 *
 * What makes resuming correct rather than lucky: saveLocalState() refuses to
 * write while Clash, FFA or the Trifecta is on, so the save is still the
 * Stakes run even after a full Clash match. The in-memory word is not - the
 * single startRound() writes targetWord for Clash too - so the save is what
 * gets trusted.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('missing ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('missing end of ' + a);
  return src.slice(i + a.length, j);
};
const fn = (name, open, close = '\n        }') =>
  open + between(html, open, close) + close.trim();

// ---- the real sources, lifted ---------------------------------------------
const loadSrc   = fn('loadLocalState', 'function loadLocalState() {');
const resumeSrc = fn('resumeStandardRun', 'function resumeStandardRun() {');
ck(loadSrc.length > 200, 'lifted loadLocalState', String(loadSrc.length));
ck(resumeSrc.length > 80, 'lifted resumeStandardRun', String(resumeSrc.length));

/*
 * Runs the return-to-Stakes path against a simulated save.
 * `saved` is what is on disk; `mem` is what the mode you were just in left
 * in the globals. Returns what Stakes is holding afterwards.
 */
function resume({ saved, mem = {}, isVersusMode = false, isFfaMode = false }) {
  const store = {};
  if (saved !== null) store.wordcade_save = JSON.stringify(saved);
  const calls = [];
  const run = new Function('store', 'calls', 'mem', 'isVersusMode', 'isFfaMode', `
    const localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
    const console = { error() {} };
    let score = mem.score ?? 0, continues = mem.continues ?? 1, wordsGuessed = mem.wordsGuessed ?? 0;
    let targetWord = mem.targetWord ?? "", currentWordGuesses = mem.currentWordGuesses ?? [];
    let runStats = mem.runStats ?? { played: 0 };
    const window = {
      // The real one, in its effects: zeroes the run and deletes the save.
      startNewRun() {
        calls.push('startNewRun');
        score = 0; continues = 1; wordsGuessed = 0; runStats = { played: 0 };
        targetWord = "ZZZZZ";
        localStorage.removeItem("wordcade_save");
      },
    };
    function startRound() { calls.push('startRound'); targetWord = "FRESH"; currentWordGuesses = []; }
    function showStandardSurface() {
      calls.push('showStandardSurface');
      // index.html: "if (!targetWord) window.startNewRun(); else paintStandardBoard();"
      if (!targetWord) window.startNewRun(); else calls.push('paintStandardBoard');
    }
    ${loadSrc}
    ${resumeSrc}
    resumeStandardRun();
    return { score, continues, wordsGuessed, targetWord, currentWordGuesses, runStats,
             calls, savedStill: "wordcade_save" in store };
  `);
  return run(store, calls, mem, isVersusMode, isFfaMode);
}

// ---- 1. the exact report --------------------------------------------------
{
  // Mid-run: 1,240 banked-in-progress, two continues, a word part-guessed.
  // Clash was only SEARCHED, never played, so the globals are still Stakes'.
  const saved = { score: 1240, continues: 2, wordsGuessed: 14,
                  runStats: { played: 14 }, targetWord: 'CRANE',
                  currentWordGuesses: [{ guess: 'SLATE', colors: [0, 0, 1, 0, 2] }] };
  const r = resume({ saved, mem: { score: 1240, continues: 2, targetWord: 'CRANE' } });
  eq('cancelling a Clash search keeps the score', r.score, 1240);
  eq('and the continues', r.continues, 2);
  eq('and the words already solved', r.wordsGuessed, 14);
  eq('and the word that was in progress', r.targetWord, 'CRANE');
  eq('and the guesses already made against it', r.currentWordGuesses.length, 1);
  ck(r.savedStill, 'and the save is still on disk');
  ck(!r.calls.includes('startNewRun'), 'nothing started a new run', r.calls.join(','));
}

// ---- 2. after an actual Clash match, where the globals ARE polluted -------
{
  // startRound() writes targetWord for Clash too, so the in-memory word is
  // Clash's. The save is untouched, because saveLocalState refuses to write
  // in Clash - that is the whole reason this reads the save and not memory.
  const saved = { score: 800, continues: 1, wordsGuessed: 9, runStats: { played: 9 },
                  targetWord: 'PLUMB', currentWordGuesses: [] };
  const r = resume({ saved, mem: { score: 0, continues: 0, targetWord: 'CLASHWORD' } });
  eq('a played Clash match does not cost the Stakes run either', r.score, 800);
  eq("and Clash's word does not end up on the Stakes board", r.targetWord, 'PLUMB');
}

// ---- 3. the save written right after a solve ------------------------------
{
  // saveLocalState(true) writes targetWord: "" when a word is finished. An
  // empty word reads to showStandardSurface as "no run at all", which would
  // start a new one and zero the score this just restored - so the run has to
  // be handed its next word first.
  const saved = { score: 2500, continues: 3, wordsGuessed: 20,
                  runStats: { played: 20 }, targetWord: '', currentWordGuesses: [] };
  const r = resume({ saved, mem: { targetWord: 'CLASHWORD' } });
  eq('a run saved between words keeps its score', r.score, 2500);
  eq('and its continues', r.continues, 3);
  ck(r.calls.includes('startRound'), 'and is given a fresh word to play',
     r.calls.join(','));
  ck(!r.calls.includes('startNewRun'), 'rather than a fresh RUN', r.calls.join(','));
  eq('which is what lands on the board', r.targetWord, 'FRESH');
}

// ---- 4. no save: a new run is correct -------------------------------------
{
  const r = resume({ saved: null, mem: { targetWord: 'CLASHWORD' } });
  ck(r.calls.includes('startNewRun'), 'with nothing saved, a new run IS right',
     r.calls.join(','));
  eq('and it starts from zero', r.score, 0);
}

// ---- 5. the precondition the helper documents -----------------------------
{
  // loadLocalState refuses to read while isVersusMode or isFfaMode is set, so
  // a caller that resumes BEFORE clearing its flag gets "no run" and silently
  // starts a new one - the original bug wearing a different hat.
  const saved = { score: 999, continues: 1, wordsGuessed: 1, runStats: { played: 1 },
                  targetWord: 'ABIDE', currentWordGuesses: [] };
  const stillIn = resume({ saved, isVersusMode: true });
  ck(stillIn.calls.includes('startNewRun'),
     'resuming before the mode flag is cleared would lose the run',
     stillIn.calls.join(','));
  // ...which is why every caller clears it first. Checked in the source.
  const sites = [
    ['cancelVersusLobby', 'window.cancelVersusLobby = function() {', 'isVersusMode = false'],
    ['cancelFfaLobby',    'window.cancelFfaLobby = function() {',    'isFfaMode = false'],
    ['leaveDailyGauntlet','window.leaveDailyGauntlet = function() {','isDailyMode = false'],
  ];
  for (const [name, open, flag] of sites) {
    const body = between(html, open, '\n        }');
    const iFlag = body.indexOf(flag);
    const iCall = body.indexOf('resumeStandardRun()');
    ck(iCall >= 0, `${name} resumes rather than starting a new run`,
       (body.match(/[^\n]*startNewRun[^\n]*/) || ['no resume call'])[0].trim());
    ck(iFlag >= 0 && iFlag < iCall, `${name} clears its mode flag first`,
       `flag at ${iFlag}, resume at ${iCall}`);
  }
}

// ---- 6. and the paths that were already right stay right ------------------
{
  for (const [name, open] of [['leaveSprint', 'window.leaveSprint = function() {'],
                              ['leaveMarathon', 'window.leaveMarathon = function() {']]) {
    const body = between(html, open, '\n        }');
    ck(/showStandardSurface\(\)/.test(body), `${name} still goes through showStandardSurface`);
    ck(!/startNewRun\(\)/.test(body), `${name} still does not start a new run`);
  }
  // Live call sites only - the explanation above resumeStandardRun names the
  // function it replaced, and a bare search would find the paragraph.
  const live = html.split('\n')
    .filter((l) => /startNewRun\(\)/.test(l))
    .filter((l) => !/^\s*(\/\/|\*)/.test(l.trim()));
  eq('startNewRun has exactly three live callers left', live.length, 3);
  const what = live.map((l) => l.trim());
  ck(what.some((l) => /id="btn-new-run"/.test(l)), 'the New Run button', JSON.stringify(what));
  ck(what.some((l) => /if \(!targetWord\)/.test(l)), 'showStandardSurface, when there is no run', JSON.stringify(what));
  ck(what.some((l) => /!loadLocalState\(\)/.test(l)), 'and resumeStandardRun, when nothing is saved', JSON.stringify(what));
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
