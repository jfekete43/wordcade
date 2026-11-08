/*
 * Sprint's Profile tab.
 *
 * Two numbers on it had been stored by onRunCreated since Sprint shipped and
 * drawn by nothing: sprintBestTimeMs — the one stat the mode is actually
 * about — and sprintGuessTotal, whose counter on the server carries a comment
 * saying it exists so a popup can divide it for an average. This is that
 * popup, two months late.
 *
 * The pills and the distribution are not new: renderSprintStats already drew
 * them for the end-of-round modal and the panel under the board, and this is
 * its third caller. What IS new is that a caller can now say "no row to light
 * up" — the chart highlights the guess you just landed on, and 0 means a miss
 * today, so the Profile tab passing 0 would have lit X on every player who
 * opened it.
 *
 * Both functions are lifted and run against a fake DOM.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(got === want, name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const src = [
  grab(/        function formatSprintTime\(ms\) \{\n[\s\S]*?\n        \}/, 'formatSprintTime'),
  grab(/        const SPRINT_EPOCH = "[^"]*";/, 'SPRINT_EPOCH'),
  grab(/        function sprintNumber\(dateStr\) \{\n[\s\S]*?\n        \}/, 'sprintNumber'),
  grab(/        function renderGuessDistribution\(counts, wrap, dist, lit, accent\) \{\n[\s\S]*?\n        \}/, 'renderGuessDistribution'),
  grab(/        function renderSprintStats\(todayRow, prefix\) \{\n[\s\S]*?\n        \}/, 'renderSprintStats'),
  grab(/        function loadSprintStats\(\) \{\n[\s\S]*?\n        \}/, 'loadSprintStats'),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

// Only the ids the panel writes to. A write to an id that is not here throws
// rather than vanishing, which is what stops a typo in the null-guarded
// `set()` helper from quietly drawing nothing.
const PANEL_IDS = [
  'stat-sprint-best-time', 'stat-sprint-best-when', 'stat-sprint-avg', 'stat-sprint-solved',
  'sprint-prof-stats', 'sprint-prof-dist-wrap', 'sprint-prof-dist',
];
const run = (profile, ids = PANEL_IDS) => {
  const els = {};
  for (const id of ids) els[id] = { id, innerText: '', innerHTML: '', style: {} };
  const doc = { getElementById: (id) => {
    if (!(id in els)) throw new Error('wrote to an element the markup does not have: ' + id);
    return els[id];
  } };
  new Function('document', 'userProfileData', `${src}\nloadSprintStats();`)(doc, profile);
  return els;
};

// Every id the code reaches for is in the real markup. The run above proves
// the code only writes ids this list knows; this proves the list is the
// markup's and not a wish.
for (const id of PANEL_IDS) {
  ck(html.includes(`id="${id}"`), `the markup has #${id}`);
}
ck(/id="profile-sprint"/.test(html), 'and a panel to put them in');
ck(/id="tab-prof-sprint"/.test(html), 'and a tab to reach it by');
// The tab row is meant to read in the same order as the mode nav, which opens
// on Sprint. Derived from the table rather than asserted as a literal.
{
  const order = [...html.matchAll(/id="tab-prof-(\w+)"/g)].map((m) => m[1]);
  eq('Sprint leads the tab row, as it leads the mode nav', order[0], 'sprint');
  const modes = [...grab(/        const MODES = \{\n[\s\S]*?\n        \};/, 'MODES').matchAll(/^ {12}(\w+):/gm)].map((m) => m[1]);
  eq('...which is where the mode table puts it too', modes[0], 'sprint');
}

// ---- the headline ---------------------------------------------------------
{
  const e = run({ sprintBestTimeMs: 4100, sprintBestScore: 500, sprintBestDate: '2026-11-06',
                  sprintPlayed: 9, sprintSolved: 7, sprintGuessTotal: 17 });
  eq('the fastest solve is the headline', e['stat-sprint-best-time'].innerText, '4.1s');
  ck(/^Best 500 pts · Sprint #\d+$/.test(e['stat-sprint-best-when'].innerText),
     'with the best score and the day it happened underneath', e['stat-sprint-best-when'].innerText);
}
{
  const e = run({ sprintBestTimeMs: 615000, sprintSolved: 1, sprintGuessTotal: 1 });
  eq('a long solve reads in minutes', e['stat-sprint-best-time'].innerText, '10:15.0');
}
for (const [label, p] of [
  ['a player who has never solved one', {}],
  ['a stored zero', { sprintBestTimeMs: 0 }],
  ['something that is not a number', { sprintBestTimeMs: 'soon' }],
  ['a negative', { sprintBestTimeMs: -5 }],
]) {
  const e = run(p);
  eq(`${label}: a dash, not a time`, e['stat-sprint-best-time'].innerText, '—');
}
{
  // The date is what turns "best 500" into something comparable. Without one
  // the claim still stands; it just does not say when.
  const e = run({ sprintBestScore: 250 });
  eq('no date means no "Sprint #"', e['stat-sprint-best-when'].innerText, 'Best 250 pts');
  const before = run({ sprintBestScore: 250, sprintBestDate: '2020-01-01' });
  eq('and nor does a day before Sprint existed', before['stat-sprint-best-when'].innerText, 'Best 250 pts');
  const none = run({});
  eq('no best score at all leaves the line blank rather than saying "Best 0 pts"',
     none['stat-sprint-best-when'].innerText, ' ');
}

// ---- the average ----------------------------------------------------------
{
  // Divided by SOLVES, not plays. Six plays, two of them misses; the four
  // solves cost 2+2+3+1. Dividing by plays would read 1.3 and flatter nobody.
  const e = run({ sprintPlayed: 6, sprintSolved: 4, sprintGuessTotal: 8 });
  eq('the average is per solve', e['stat-sprint-avg'].innerText, '2.0');
  eq('and the solve count is its denominator, shown', e['stat-sprint-solved'].innerText, '4');
}
{
  const e = run({ sprintPlayed: 3, sprintSolved: 0, sprintGuessTotal: 0 });
  eq('no solves is a dash, not a division by zero', e['stat-sprint-avg'].innerText, '—');
  eq('and zero solved', e['stat-sprint-solved'].innerText, '0');
}
{
  const e = run({ sprintSolved: 3, sprintGuessTotal: 7 });
  eq('one decimal place, rounded', e['stat-sprint-avg'].innerText, '2.3');
}
{
  const e = run({ sprintSolved: 1200, sprintGuessTotal: 2400 });
  eq('a big solve count is thousands-separated', e['stat-sprint-solved'].innerText, '1,200');
}

// ---- the shared pills and chart ------------------------------------------
{
  const e = run({ sprintPlayed: 10, sprintSolved: 6, sprintStreak: 2, sprintBestStreak: 5,
                  sprintG1: 1, sprintG2: 2, sprintG3: 2, sprintG4: 1, sprintG5: 0 });
  const pills = e['sprint-prof-stats'].innerHTML;
  for (const [what, want] of [['played', '10'], ['win rate', '60'], ['current streak', '2'], ['max streak', '5']]) {
    ck(pills.includes(`<b>${want}</b>`), `the ${what} pill is drawn into the Profile panel`, pills);
  }
  const bars = e['sprint-prof-dist'].innerHTML;
  ck(bars.length > 0, 'and so is the distribution', bars);
  eq('the chart is shown once there is one', e['sprint-prof-dist-wrap'].style.display, 'block');
  // played - solved, by construction: exactly one of G1..G5 moves on a solve.
  ck(/>4</.test(bars), 'the X row is the misses, derived rather than counted', bars);
}
{
  const e = run({ sprintPlayed: 0, sprintSolved: 0 });
  eq('a player who has never played gets no chart at all, rather than an empty one',
     e['sprint-prof-dist-wrap'].style.display, 'none');
}

// ---- nothing is lit up on a screen with no "today" -----------------------
// The reason loadSprintStats passes null rather than 0.
{
  // One entry per bar, in row order, read off the fill's own style - rather
  // than splitting on "</div>", which the nested bars make more fragments
  // than there are rows.
  const litRows = (markup) => [...markup.matchAll(/stat-bar-fill" style="([^"]*)"/g)]
    .map((m) => (/var\(--c-sprint\)/.test(m[1]) ? 1 : 0));
  const e = run({ sprintPlayed: 8, sprintSolved: 6, sprintG1: 1, sprintG2: 2, sprintG3: 3 });
  const lit = litRows(e['sprint-prof-dist'].innerHTML).reduce((a, b) => a + b, 0);
  eq('the Profile chart highlights no row', lit, 0);
  ck(/loadSprintStats[\s\S]*renderSprintStats\(null, "sprint-prof"\)/.test(html),
     'because the tab asks for none by name', '');

  // ...while the screen you just finished on still does. Driven through the
  // renderer directly, since that is the caller being protected.
  const direct = (todayRow) => {
    const els = {};
    for (const id of ['x-stats', 'x-dist', 'x-dist-wrap']) els[id] = { innerHTML: '', style: {} };
    new Function('document', 'userProfileData', 'todayRow',
      `${src}\nrenderSprintStats(todayRow, "x");`)
      ({ getElementById: (id) => els[id] },
       { sprintPlayed: 8, sprintSolved: 6, sprintG1: 1, sprintG2: 2, sprintG3: 3 }, todayRow);
    const rows = litRows(els['x-dist'].innerHTML);
    // Six bars, always: 1 through 5 and X. If this is not six the indices
    // below are measuring something else.
    if (rows.length !== 6) throw new Error('expected six bars, got ' + rows.length);
    return rows;
  };
  const third = direct(3);
  eq('a solve on guess three lights exactly one row', third.reduce((a, b) => a + b, 0), 1);
  eq('...and it is the third', third.indexOf(1), 2);
  const missed = direct(0);
  eq('a miss today lights exactly one row', missed.reduce((a, b) => a + b, 0), 1);
  eq('...and it is the X', missed.indexOf(1), 5);
  eq('and undefined lights none, the same as null', direct(undefined).reduce((a, b) => a + b, 0), 0);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
