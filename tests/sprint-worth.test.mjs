/*
 * What solving on the next guess is worth, shown while you still have the
 * chance to take it.
 *
 * Until this existed the scoring ladder was invisible. A first-guess solve
 * pays 500 and a fifth pays 10 — fifty times less — and that steepness is the
 * whole basis of the scoring, yet the number only ever appeared after it had
 * already been decided. Nothing on screen said what a wrong guess cost.
 *
 * The property that makes the display trustworthy, and the thing this file
 * mostly exists to defend:
 *
 *   THE NUMBER SHOWN IS THE NUMBER BANKED. Solving does not move it, only its
 *   label. That holds only while the client's ladder and the server's agree —
 *   functions/index.js says "Must match index.html's scorePoints exactly" in a
 *   comment, and until now nothing enforced it. A drift there would not look
 *   like a bug; it would look like the game quietly paying less than it
 *   offered.
 *
 * Pure; no emulator or browser. The functions are lifted from index.html and
 * run against a fake element, so this exercises the shipped code.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error('could not extract ' + what + ' — the anchor moved');
  return m[0];
};

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ---- the two ladders must agree ---------------------------------------------
const CLIENT = JSON.parse(grab(/const scorePoints = \[[^\]]*\]/, 'scorePoints').replace('const scorePoints = ', ''));
const SERVER = JSON.parse((fn.match(/const SCORE_POINTS = (\[[^\]]*\])/) || [])[1]);
eq('the client ladder matches the server ladder exactly', CLIENT, SERVER);
ck(CLIENT.every((v, i) => i === 0 || v < CLIENT[i - 1]),
   'and it is strictly decreasing, so a later guess is always worth less', JSON.stringify(CLIENT));

// ---- the helpers, lifted and run ---------------------------------------------
const src = [
  grab(/const scorePoints = \[[^\]]*\];/, 'scorePoints'),
  grab(/        function sprintWorth\(guessesMade\) \{\n[\s\S]*?\n        \}/, 'sprintWorth'),
  grab(/        function setSprintScoreLabel\(text\) \{\n[\s\S]*?\n        \}/, 'setSprintScoreLabel'),
  grab(/        function setSprintWorth\(to, animate\) \{\n[\s\S]*?\n        \}/, 'setSprintWorth'),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const makeHarness = (reduceMotion = false) => {
  const els = {
    'sprint-score': { innerText: '500' },
    'sprint-score-label': { innerText: 'WORTH' },
  };
  const document = {
    getElementById: (id) => els[id] || null,
    body: { classList: { contains: (c) => c === 'reduce-motion' && reduceMotion } },
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'setInterval', 'clearInterval', 'Date', `
    let sprintWorthTimer = null;
    ${src}
    return { sprintWorth, setSprintWorth, setSprintScoreLabel };
  `)(document, setInterval, clearInterval, Date);
  return { els, ...api };
};

// ---- the ladder ---------------------------------------------------------------
{
  const h = makeHarness();
  eq('before any guess, the whole 500 is on the table', h.sprintWorth(0), CLIENT[0]);
  eq('after one wrong guess it is the second rung', h.sprintWorth(1), CLIENT[1]);
  eq('after four, the last rung', h.sprintWorth(4), CLIENT[4]);
  // Past the end there is nothing left to win, and the display must not read
  // `undefined` or fall back to the top of the ladder.
  eq('and once the guesses are gone it is zero', h.sprintWorth(5), 0);
  eq('still zero beyond that', h.sprintWorth(99), 0);
}

// ---- the number shown is the number banked ------------------------------------
// The server awards SCORE_POINTS[guessNumber - 1] for a solve on guessNumber.
// The client offers sprintWorth(guessesMade) BEFORE that guess is made, so
// guessesMade === guessNumber - 1. These are the same rung or the display is
// lying about what is on offer.
{
  const h = makeHarness();
  for (let guessNumber = 1; guessNumber <= CLIENT.length; guessNumber++) {
    const offered = h.sprintWorth(guessNumber - 1);
    const awarded = SERVER[guessNumber - 1];
    eq(`solving on guess ${guessNumber} pays exactly what was offered`, offered, awarded);
  }
}

// ---- setting it ----------------------------------------------------------------
{
  const h = makeHarness();
  h.setSprintWorth(250, false);
  eq('setting without animation lands immediately', h.els['sprint-score'].innerText, '250');
  h.setSprintWorth(0, false);
  eq('including zero', h.els['sprint-score'].innerText, '0');
  h.setSprintWorth(1500, false);
  eq('and a four-figure number is grouped for reading', h.els['sprint-score'].innerText, '1,500');
}

// ---- reduce motion --------------------------------------------------------------
{
  const h = makeHarness(true);
  h.setSprintWorth(500, false);
  h.setSprintWorth(150, true); // asks to animate
  eq('reduce-motion goes straight to the number rather than counting',
     h.els['sprint-score'].innerText, '150');
}

// ---- the drop ---------------------------------------------------------------------
{
  const h = makeHarness(false);
  h.setSprintWorth(500, false);
  h.setSprintWorth(250, true);
  // Mid-flight it must be somewhere between, not already landed — otherwise
  // the animation is not happening and the "cost" never reads.
  const mid = Number(h.els['sprint-score'].innerText.replace(/[^0-9]/g, ''));
  ck(mid <= 500 && mid >= 250, 'the count starts between the two values', String(mid));
  await new Promise((r) => setTimeout(r, 700));
  eq('and settles exactly on the target', h.els['sprint-score'].innerText, '250');
}
{
  // A second change arriving mid-count must not leave two timers fighting
  // over one element.
  const h = makeHarness(false);
  h.setSprintWorth(500, false);
  h.setSprintWorth(250, true);
  h.setSprintWorth(50, true);
  await new Promise((r) => setTimeout(r, 700));
  eq('a change mid-count wins outright rather than racing the one before it',
     h.els['sprint-score'].innerText, '50');
}

// ---- the label ---------------------------------------------------------------------
{
  const h = makeHarness();
  h.setSprintScoreLabel('SCORE');
  eq('the label can be changed', h.els['sprint-score-label'].innerText, 'SCORE');
}
ck(/<span id="sprint-score-label">WORTH<\/span>/.test(html),
   'the markup ships reading WORTH, which is what is true before a solve');
// Two labels for one slot, rather than one label that quietly changes meaning.
ck(/setSprintScoreLabel\("SCORE"\)/.test(html), 'and it becomes SCORE once the word is done');
ck(/setSprintScoreLabel\("WORTH"\)/.test(html), 'and WORTH again when a round starts');

// ---- solving must not move the number -------------------------------------------
// The whole claim of the feature. If this call ever passes `true`, the number
// animates on a solve — to the value it already held — which is a flicker that
// says the figure was never trustworthy.
{
  const solved = html.slice(html.indexOf('if (result.solved) {'), html.indexOf('} else if (result.finished) {'));
  ck(/setSprintWorth\(result\.score, false\)/.test(solved),
     'a solve sets the figure without animating: it is already the right one', solved.slice(0, 200));
  const finished = html.slice(html.indexOf('} else if (result.finished) {'), html.indexOf('currentGuess = "";', html.indexOf('} else if (result.finished) {')));
  ck(/setSprintWorth\(0, true\)/.test(finished),
     'running out animates down to zero, which is the one case the figure should move', finished.slice(0, 220));
}

// ---- one writer ---------------------------------------------------------------------
// The label and the figure have to agree. Two places writing the figure is how
// they stop agreeing.
{
  const writers = (html.match(/getElementById\("sprint-score"\)/g) || []).length;
  eq('exactly one place in the file writes the figure', writers, 1);
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
