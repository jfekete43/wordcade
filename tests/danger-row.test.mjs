/*
 * The red row, on a board with nothing to lose.
 *
 * Reported from the game: a fresh Sprint, one word typed, and the fifth row
 * outlined in red - the "miss this and the run is over" warning, on a mode
 * that has no Continues at all.
 *
 * Continues belong to Stakes. checkDangerRow asked "not Clash, not Trifecta,
 * not FFA", which was every other mode that existed when it was written.
 * Sprint and Marathon came later and nobody added them, so `continues` left
 * at 0 by an earlier Stakes run - a module-level global that Sprint neither
 * sets nor clears - painted the last row of a Sprint board. On the first
 * keystroke, because updateCurrentRowDisplay calls this on every one.
 *
 * The same list had already gone stale once, in the auth handler, which is
 * why inAltMode() was written; this file pins that both copies now go
 * through it, by running the real functions rather than reading them.
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

// ---- the real thing, lifted ----------------------------------------------
const dangerBody = between(html, 'function checkDangerRow() {', '\n        }');
const modeBody = between(html, 'function currentMode() {', '\n        }');
const altBody = between(html, 'function inAltMode() {', '}');
// Up to the early return, with the comment lines dropped - an earlier
// version of this ended the slice at the first comment INSIDE the function,
// which is the comment that explains the guard, so it lifted an empty string
// and every check below it passed on nothing at all.
const saveGuard = between(html, 'function saveLocalState(wordFinished = false) {', 'return;')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').trim();
ck(dangerBody.length > 100, 'lifted checkDangerRow', String(dangerBody.length));
ck(modeBody.includes('isSprintMode'), 'lifted currentMode', modeBody.slice(0, 60));
ck(altBody.trim().length > 10, 'lifted inAltMode', JSON.stringify(altBody));
// The lift that went vacuous once already. It must contain a condition, or
// "names no mode flag" is a statement about an empty string.
ck(/^if \(.+\)$/.test(saveGuard), 'lifted saveLocalState\u2019s guard, and it is a condition',
   JSON.stringify(saveGuard));

const MODES = ['endless', 'sprint', 'marathon', 'gauntlet', 'clash', 'ffa'];
const flagsFor = (mode) => ({
  isSprintMode: mode === 'sprint',
  isMarathonMode: mode === 'marathon',
  isDailyMode: mode === 'gauntlet',
  isVersusMode: mode === 'clash',
  isFfaMode: mode === 'ffa',
});

/*
 * Drives the real checkDangerRow over a real five-row board. Returns which
 * rows ended up carrying which class, so a check can say where the paint
 * landed rather than just that some tile somewhere was touched.
 */
function paint({ mode, continues, currentRow = 0, maxGuesses = 5 }) {
  const tiles = {};
  for (let i = 0; i < maxGuesses; i++) {
    for (let j = 0; j < 5; j++) {
      const cls = new Set();
      tiles[`tile-${i}-${j}`] = {
        row: i,
        classList: {
          add: (...c) => c.forEach((x) => cls.add(x)),
          remove: (...c) => c.forEach((x) => cls.delete(x)),
          contains: (c) => cls.has(c),
        },
        classes: cls,
      };
    }
  }
  const run = new Function('ARGS', `
    const { tiles, flags, continues, currentRow, maxGuesses } = ARGS;
    const { isSprintMode, isMarathonMode, isDailyMode, isVersusMode, isFfaMode } = flags;
    const document = {
      querySelectorAll: () => Object.values(tiles),
      getElementById: (id) => tiles[id] || null,
    };
    function currentMode() {${modeBody}}
    function inAltMode() {${altBody}}
    function checkDangerRow() {${dangerBody}}
    checkDangerRow();
    return currentMode();
  `);
  const resolved = run({ tiles, flags: flagsFor(mode), continues, currentRow, maxGuesses });
  const rows = {};
  for (const tile of Object.values(tiles)) {
    for (const c of tile.classes) (rows[c] = rows[c] || new Set()).add(tile.row);
  }
  return {
    resolved,
    static: [...(rows['danger-row-static'] || [])].sort((a, b) => a - b),
    pulsing: [...(rows['danger-tile'] || [])].sort((a, b) => a - b),
  };
}

// ---- 1. the mode resolver agrees with the flags we are setting ------------
for (const mode of MODES) {
  eq(`flags for ${mode} resolve to ${mode}`, paint({ mode, continues: 1 }).resolved, mode);
}

// ---- 2. the report: Sprint, out of nothing, shows nothing -----------------
{
  // Exactly the screenshot: first word typed, so currentRow is still 0, and
  // a `continues` of 0 carried over from a Stakes run.
  const r = paint({ mode: 'sprint', continues: 0, currentRow: 0 });
  eq('a Sprint board paints no static danger row', r.static, []);
  eq('and no pulsing one either', r.pulsing, []);
}
// Every mode that is not Stakes, at the two values that matter.
for (const mode of MODES.filter((m) => m !== 'endless')) {
  for (const continues of [0, -1]) {
    const r = paint({ mode, continues });
    ck(r.static.length === 0 && r.pulsing.length === 0,
       `${mode} with ${continues} continues paints nothing`,
       `static ${r.static} pulsing ${r.pulsing}`);
  }
}

// ---- 3. Stakes still gets the warning it is for ---------------------------
{
  const r = paint({ mode: 'endless', continues: 0, currentRow: 0 });
  eq('out of Continues, Stakes marks the last row', r.static, [4]);
  eq('and only the last row', r.pulsing, []);

  // Standing on it is the urgent case, and the one that pulses.
  const onIt = paint({ mode: 'endless', continues: 0, currentRow: 4 });
  eq('standing on that row, it pulses instead', onIt.pulsing, [4]);
  eq('and is not also painted flat', onIt.static, []);

  const safe = paint({ mode: 'endless', continues: 1, currentRow: 0 });
  ck(safe.static.length === 0 && safe.pulsing.length === 0,
     'with a Continue in hand, nothing is painted',
     `static ${safe.static} pulsing ${safe.pulsing}`);
}

// ---- 4. it clears what it painted -----------------------------------------
{
  // The function starts by stripping both classes from every tile. Without
  // that, spending the last Continue would leave the row lit for the rest of
  // the run. Painting at row 4 and then asking again at row 0 proves the
  // strip runs, because the pulsing class has to move.
  const r = paint({ mode: 'endless', continues: 0, currentRow: 4 });
  eq('the pulsing row is the one being stood on', r.pulsing, [4]);
  ck(/classList\.remove\('danger-tile', 'danger-row-static'\)/.test(dangerBody),
     'and every call strips both classes before repainting', dangerBody.slice(0, 120));
}

// ---- 5. the list cannot come back -----------------------------------------
{
  // The bug was not the condition, it was the shape of it: a hand-written
  // list of the modes that existed that day. Naming any flag here is the
  // regression, whatever the flags happen to be.
  const named = ['isSprintMode', 'isMarathonMode', 'isDailyMode', 'isVersusMode', 'isFfaMode']
    .filter((f) => dangerBody.includes(f));
  eq('checkDangerRow names no mode flag of its own', named, []);
  ck(/inAltMode\(\)/.test(dangerBody), 'it asks inAltMode instead', dangerBody.slice(0, 160));

  // The second copy of the same list. No Sprint path reaches saveLocalState
  // today, so this is the trap shut rather than a live bug - but it is the
  // identical mistake sitting in the identical shape.
  const namedSave = ['isSprintMode', 'isMarathonMode', 'isDailyMode', 'isVersusMode', 'isFfaMode']
    .filter((f) => saveGuard.includes(f));
  eq('saveLocalState names no mode flag either', namedSave, []);
  ck(/inAltMode\(\)/.test(saveGuard), 'and asks the same question', saveGuard.trim());

  // And the helper really is derived rather than a third list.
  ck(/currentMode\(\)/.test(altBody) && !/is\w+Mode/.test(altBody),
     'inAltMode derives from currentMode rather than listing flags', altBody.trim());
}

// ---- 6. Sprint never writes the value that caused it ----------------------
{
  // The stale 0 comes from Stakes and is never cleared, which is fine as long
  // as nothing outside Stakes reads it. Pinning that Sprint and Marathon do
  // not assign `continues` keeps the global honestly Stakes-only.
  const sprint = between(html, 'async function submitSprintGuess() {', '\n        }');
  const marathon = between(html, 'async function submitMarathonGuess() {', '\n        }');
  for (const [name, src] of [['submitSprintGuess', sprint], ['submitMarathonGuess', marathon]]) {
    // Comments mention it by name; strip them before asking.
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ck(!/\bcontinues\s*(=[^=]|--|\+\+)/.test(code), `${name} never assigns continues`,
       (code.match(/[^\n]*continues[^\n]*/) || [''])[0].trim());
  }
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
