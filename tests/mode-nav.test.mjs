/*
 * The mode nav, and the mode you are in being named on screen.
 *
 * Every mode except Stakes used to collapse the nav to a single "leave"
 * button and hide the other two, each of the six entry/exit paths flipping
 * innerText and display on three hard-coded buttons inline. From inside a
 * Trifecta there was no way to see that Clash and FFA existed. Worse, the mode
 * you were IN was the only one never named anywhere: Stakes had no header at
 * all, so a new player landed on an unlabelled board flanked by buttons for
 * three other modes — which is how one of them reported that "one of today's
 * words" was obscure while playing a mode that has no daily words.
 *
 * The nav is a table plus one renderer now, and goToMode is the single way in
 * or out of any mode. Both halves run as the real extracted source:
 *   1. renderModeNav against the real markup and stylesheet, in a browser.
 *   2. source-level checks that nothing writes the nav behind its back, that
 *      every mode route goes through goToMode, and that the labels, the bank
 *      button and the intro card say what they are supposed to.
 *
 * Needs Playwright, not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// Slices between anchors that are not themselves under test.
function between(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`${label}: start anchor not found`);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`${label}: end anchor not found`);
  return src.slice(a + startAnchor.length, b);
}
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

// The palette lives in one place, so read it from there rather than restating
// it. A repaint should not be able to make this suite pass while the nav and
// the blurb drift apart — the point of the checks below is that they AGREE,
// not that they hold any particular hex.
const TOKENS = Object.fromEntries([...html.matchAll(/(--c-[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)]
  .map((m) => [m[1], m[2].toLowerCase()]));
const rgbOf = (tok) => {
  let h = TOKENS[tok];
  if (!h) throw new Error('no such token: ' + tok);
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  return `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
};

const css = grab(/<style>[\s\S]*?<\/style>/, 'stylesheet').replace(/<\/?style>/g, '');
const nav = grab(/    <nav class="arcade-menu"[\s\S]*?<\/nav>/, 'nav');
const endlessHeader = grab(/    <div id="endless-header">[\s\S]*?\n    <\/div>/, 'endless header');
const scoreBoard = grab(/    <div id="score-board">[\s\S]*?\n    <\/div>/, 'score board');
// The table and the renderer, lifted whole.
const modesSrc = 'const MODES = {' + between(html, 'const MODES = {', '\n        };', 'MODES') + '\n};\n'
  // Lifted from the file rather than restated, so the slot order the renderer
  // walks is the same one the page ships with.
  + grab(/const MODE_ORDER = [^\n]*/, 'MODE_ORDER');
const renderSrc = 'function renderModeNav() {' + between(html, 'function renderModeNav() {', '\n        }', 'renderModeNav') + '\n}';
// Lifted, not restated. A hand-written copy of currentMode() in the harness
// went stale the moment a fifth mode was added: the copy still knew four
// flags, so the new mode could never be "current" here and the suite blew up
// on an undefined colour instead of reporting a missing mode.
const currentSrc = 'function currentMode() {' + between(html, 'function currentMode() {', '\n        }', 'currentMode') + '\n}';
// Lifted too: the phone column count is a decision now, not a number, and a
// restatement here is exactly the drift this file exists to catch.
const narrowSrc = 'function narrowModeCols(n) {'
  + between(html, 'function narrowModeCols(n) {', '\n        }', 'narrowModeCols') + '\n}';
// Every mode the page ships, in the table's own order.
const MODE_KEYS = (modesSrc.match(/^\s{12}(\w+):/gm) || []).map((m) => m.trim().replace(':', ''));
// A mode can be closed without being deleted. The nav draws the open ones;
// the table still carries the rest, and currentMode() still knows them, so
// the two lists are kept apart here the same way the page keeps them apart.
const HIDDEN = new Set([...modesSrc.matchAll(/^\s{12}(\w+):[^\n]*hidden: true/gm)].map((m) => m[1]));
const OPEN_KEYS = MODE_KEYS.filter((m) => !HIDDEN.has(m));
const MODE_LABELS = Object.fromEntries((modesSrc.match(/^\s{12}(\w+):\s*\{\s*label:\s*"([^"]+)"/gm) || [])
  .map((m) => { const g = m.match(/(\w+):\s*\{\s*label:\s*"([^"]+)"/); return [g[1], g[2]]; }));
if (MODE_KEYS.length < 2) throw new Error('could not read the MODES table');
// The flags currentMode() actually reads, parsed out of currentMode() itself,
// along with the mode each one selects. Hand-listing these is what broke the
// harness twice: it knew four flags, then five, while the page had one more
// each time, and the failure arrived as a ReferenceError rather than as a
// report of the missing mode. Declared from the source, it cannot drift.
const FLAG_FOR = Object.fromEntries([...currentSrc.matchAll(/if \((\w+)\) return "(\w+)";/g)]
  .map((m) => [m[2], m[1]]));
const FALLBACK_MODE = (currentSrc.match(/return "(\w+)";\s*\n\}/) || [])[1];
const FLAG_DECL = Object.values(FLAG_FOR).map((f) => `let ${f} = false;`).join(' ');
if (!Object.keys(FLAG_FOR).length || !FALLBACK_MODE) throw new Error('could not read currentMode()\'s flags');
// Every mode in the table is either flag-selected or the fallback; a mode
// that is neither can never be entered.
for (const m of MODE_KEYS) {
  if (!FLAG_FOR[m] && m !== FALLBACK_MODE) throw new Error(`mode "${m}" is in MODES but currentMode() can never return it`);
}
console.log('extracted from index.html:', (modesSrc + renderSrc + nav).length, 'chars');

// ===== 1. the renderer, in a browser, against the shipped markup ===========
const page_html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style>
<!-- .arcade-menu button animates all its properties over 0.2s, so a
     getComputedStyle taken in the same tick as the class change reads a colour
     part-way through the fade. That is the harness racing the renderer rather
     than a bug in it. -->
<style>* { transition: none !important; animation: none !important; }</style>
</head><body>
${nav}
${endlessHeader}
${scoreBoard}
<script>
${FLAG_DECL}
${modesSrc}
const VISIBLE_MODES = MODE_ORDER.filter((m) => !MODES[m].hidden);
${currentSrc}
${narrowSrc}
${renderSrc}
const FLAG_FOR = ${JSON.stringify(FLAG_FOR)};
// Declared here because renderModeNav reads it. Switching to a mode that
// needs the server leaves the nav with a tap to answer and no flag to answer
// it from, so the nav marks the mode on its way in.
let pendingMode = null;
window.setFlags = (o) => {
  for (const f of Object.values(FLAG_FOR)) eval(f + ' = false');
  const want = Object.keys(o).find((k) => o[k]);
  if (want && FLAG_FOR[want]) eval(FLAG_FOR[want] + ' = true');
  pendingMode = null;
  // Every slot shown first, so hiding the spares is something the renderer
  // has to DO. Left at the markup's own display:none, a renderer that stopped
  // hiding them would still look correct here.
  document.querySelectorAll('.arcade-menu button').forEach((b) => { b.style.display = ''; });
  renderModeNav();
};
window.readCols = () => {
  const cs = getComputedStyle(document.querySelector('.arcade-menu'));
  return { cols: cs.getPropertyValue('--mode-cols').trim(),
           narrow: cs.getPropertyValue('--mode-cols-narrow').trim(),
           tracks: cs.gridTemplateColumns.split(' ').length };
};
window.setPending = (m) => { pendingMode = m; renderModeNav(); };
window.readNav = () => MODE_ORDER.map((_, n) => n + 1).map((i) => {
  const b = document.getElementById("btn-nav-" + i);
  const cs = getComputedStyle(b);
  return { label: b.innerText.trim(), mode: b.dataset.mode, color: cs.color,
           bg: cs.backgroundColor, current: b.getAttribute("aria-current") === "true",
           shown: cs.display !== "none" };
});
window.currentModeIs = () => currentMode();
</script></body></html>`;
const tmp = REPO('tests/.mode-nav.tmp.html');
fs.writeFileSync(tmp, page_html);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('file://' + tmp);
await page.waitForTimeout(120);

// Built from the table rather than listed, so a new mode without a colour
// fails as a missing custom property here instead of as a TypeError.
const RGB = Object.fromEntries(MODE_KEYS.map((m) => [m, rgbOf(m === 'gauntlet' ? '--c-gauntlet' : '--c-' + m)]));

// The column caps, read from the stylesheet rather than restated. A nav that
// shrinks type instead of wrapping is how MARATHON came to spill 20px out of
// its own button on every phone width.
// The phone cap is no longer a number in the stylesheet: four modes across
// three columns is a row of three and an orphan, so the cap is computed from
// how many modes are open and handed to CSS as a second custom property.
const CAP_PHONE = Number((nav.match(/--mode-cols-narrow: (\d+);/) || [])[1]);
const CAP_FOLD = Number((css.match(/max-width: 319px\)[\s\S]*?min\(var\(--mode-cols, \d+\), (\d+)\)/) || [])[1]);
if (!CAP_PHONE || !CAP_FOLD) throw new Error('could not read the nav column caps');
ck(OPEN_KEYS.length % CAP_PHONE === 0,
   'the phone wraps the open modes into full rows rather than leaving an orphan',
   `${OPEN_KEYS.length} modes, ${CAP_PHONE} columns`);

const QUIET = rgbOf('--c-ink-4');
const ON_ACCENT = rgbOf('--c-on-accent');

// The markup alone, before renderModeNav has ever run. A nav that is only
// correct once a script has run shows four blank buttons on a slow load.
const atRest = await page.evaluate(() => window.readNav());
eq('the shipped markup already reads as the Sprint default',
   atRest.filter((b) => b.shown).map((b) => b.label), OPEN_KEYS.map((m) => MODE_LABELS[m]));
eq('and ships a hidden slot for each closed mode, so reopening needs no markup',
   atRest.length - atRest.filter((b) => b.shown).length, MODE_KEYS.length - OPEN_KEYS.length);
ck(atRest.filter((b) => !b.shown).every((b) => !b.mode),
   'and those spares carry no mode until one is put in them',
   JSON.stringify(atRest.filter((b) => !b.shown).map((b) => b.mode)));
// Colour used to identify the three modes you were NOT in. It identifies the
// one you ARE in now: the current slot is filled in its own colour and the
// other three are quiet and identical, which is the whole point of the
// four-up row — the mode you are playing is finally the one that is marked.
// Sprint is the landing mode, so the markup marks Sprint. This is the
// assertion that pins the landing page: change which button ships with
// aria-current and this fails rather than silently moving the front door.
eq('and the Sprint slot is already the marked one',
   atRest.filter((b) => b.current).map((b) => b.mode), ['sprint']);
ck(atRest.find((b) => b.current).bg === RGB.sprint
   && atRest.find((b) => b.current).color === ON_ACCENT,
   'filled in its own colour, before any script runs',
   atRest.find((b) => b.current).bg + ' / ' + atRest.find((b) => b.current).color);
ck(atRest.filter((b) => !b.current).every((b) => b.color === QUIET),
   'and the others are quiet and identical',
   atRest.filter((b) => !b.current).map((b) => b.mode + ':' + b.color).join(' '));

const N = OPEN_KEYS.length;
for (const mode of OPEN_KEYS) {
  const nav = await page.evaluate((m) => { window.setFlags({ [m]: true }); return window.readNav(); }, mode);
  const here = await page.evaluate(() => window.currentModeIs());
  eq(`in ${mode}, currentMode() agrees with the flags`, here, mode);
  // The whole point: four slots, always shown, and the mode you are in is
  // the marked one rather than the missing one.
  const open = nav.filter((b) => b.shown);
  ck(open.length === N, `in ${mode}, all ${N} open slots are shown`,
     JSON.stringify(nav.map((b) => b.mode + ':' + b.shown)));
  ck(nav.filter((b) => !b.shown).length === MODE_KEYS.length - N,
     `in ${mode}, the renderer puts the spare slots back down`,
     JSON.stringify(nav.map((b) => b.mode + ':' + b.shown)));
  const cols = await page.evaluate(() => window.readCols());
  eq(`in ${mode}, the grid is as wide as the open modes`, cols.cols, String(N));
  eq(`in ${mode}, the mode you are in IS a button, and it is the marked one`,
     nav.filter((b) => b.current).map((b) => b.mode), [mode]);
  eq(`in ${mode}, every open mode is reachable`,
     open.map((b) => b.mode).sort(), [...OPEN_KEYS].sort());
  ck(open.every((b) => b.label === MODE_LABEL(b.mode)), `in ${mode}, each slot is labelled with its mode`,
     open.map((b) => b.mode + '=' + b.label).join(' '));
  // Colour travels with the mode, not with the button id. It now arrives as
  // a FILL on the current slot rather than as ink on the other three.
  ck(nav.find((b) => b.current).bg === RGB[mode],
     `in ${mode}, the marked slot is filled in that mode's colour`,
     nav.find((b) => b.current).bg + ' want ' + RGB[mode]);
  ck(open.filter((b) => !b.current).every((b) => b.color === QUIET),
     `in ${mode}, the others stay quiet`,
     open.filter((b) => !b.current).map((b) => b.mode + ':' + b.color).join(' '));
  ck(new Set(open.map((b) => b.mode)).size === N, `in ${mode}, no mode appears twice`, open.map((b) => b.mode).join(','));
  // A closed mode must not be drawn anywhere, under any flag state.
  ck(open.every((b) => !HIDDEN.has(b.mode)), `in ${mode}, no closed mode is on the nav`,
     open.map((b) => b.mode).join(','));
}
function MODE_LABEL(m) { return MODE_LABELS[m]; }

// ---- the tap is answered before the server is ---------------------------------
// Sprint, Marathon and the Daily all need a round trip before they own the
// screen. Marking the mode only once a flag flips means the nav still says
// SPRINT a second after MARATHON was pressed, which reads as a missed tap on
// a phone - so the nav marks where you are GOING while it is going there.
// Open modes only: goToMode refuses a closed one, so a switch to a closed
// mode never starts and there would be nothing for the nav to mark.
//
// Derived from OPEN_KEYS rather than written out. The pairs used to name
// sprint and gauntlet, and closing the Trifecta turned this from a check
// into a crash - nav.find(current) came back undefined for a button the nav
// correctly no longer draws. Every open mode now gets a turn as both ends.
const SWITCHES = OPEN_KEYS.flatMap((from, i) => {
  const to = OPEN_KEYS[(i + 1) % OPEN_KEYS.length];
  return from === to ? [] : [[from, to]];
});
ck(SWITCHES.length === OPEN_KEYS.length && OPEN_KEYS.length >= 3,
   'every open mode is both left and entered somewhere in the pairs below',
   SWITCHES.map((x) => x.join('->')).join(' '));
for (const [from, to] of SWITCHES) {
  const nav = await page.evaluate(([f, t]) => {
    window.setFlags({ [f]: true });   // still in the old mode: no flag has flipped
    window.setPending(t);
    return window.readNav();
  }, [from, to]);
  eq(`switching ${from} -> ${to}, the nav marks the mode being entered`,
     nav.filter((b) => b.current).map((b) => b.mode), [to]);
  ck(nav.find((b) => b.current).bg === RGB[to],
     `and fills it in ${to}'s own colour, so the wait is that mode's`,
     nav.find((b) => b.current).bg + ' want ' + RGB[to]);
  ck(nav.find((b) => b.mode === from).color === QUIET,
     `while ${from}, which no longer owns the screen, goes quiet`,
     nav.find((b) => b.mode === from).color);
  // Exactly one marked slot: a nav showing both the mode you left and the one
  // you are entering is worse than one showing the wrong one.
  eq(`and exactly one slot is marked during the switch`, nav.filter((b) => b.current).length, 1);
}
{
  // And when it lands, the flag is the only thing speaking again. Driven
  // through an OPEN mode read off the table rather than a named one: this
  // said `gauntlet`, and closing the Trifecta turned it into an assertion
  // that a button the nav correctly no longer draws is lit.
  const landed = OPEN_KEYS[OPEN_KEYS.length - 1];
  const nav = await page.evaluate((m) => { window.setFlags({ [m]: true }); return window.readNav(); }, landed);
  eq('once the mode arrives the nav is back on the flags alone',
     nav.filter((b) => b.current).map((b) => b.mode), [landed]);
}

// Order is stable, so a slot does not jump between modes as you move around.
const orders = {};
for (const mode of MODE_KEYS) {
  orders[mode] = (await page.evaluate((m) => { window.setFlags({ [m]: true }); return window.readNav(); }, mode))
    .filter((b) => b.shown).map((b) => b.mode);
}
// Stronger than it used to be: "stable" meant the relative order survived
// while the SET changed. Now a mode's button never moves at all — including
// when a closed mode sits between two open ones in the table, which must
// close the gap rather than leave a dead slot in the middle of the row.
const ORDER = OPEN_KEYS;
eq('a mode\'s slot never moves, in any mode', orders,
   Object.fromEntries(MODE_KEYS.map((m) => [m, ORDER])));

// The nav must still fit on a phone now that no slot is ever hidden.
// The harness injects index.html's whole stylesheet, which carries
// body { overflow-x: hidden } — so scrollWidth > innerWidth can NEVER fire
// here and the old check was green against real overflow. Measure each
// button's own label against its own box instead, which is what actually
// breaks, and include the fold-cover width the old list skipped.
for (const width of [280, 320, 360, 390, 428]) {
  const p = await browser.newPage({ viewport: { width, height: 844 } });
  await p.goto('file://' + tmp);
  await p.waitForTimeout(100);
  const r = await p.evaluate(() => {
    // Only the slots that are actually laid out. A spare for a closed mode
    // is display:none, so it has no box to overflow and no row to sit on —
    // measuring it reported a 6px spill on an empty button and counted a
    // third row that is not on the screen.
    const btns = [...document.querySelectorAll('.arcade-menu button')]
      .filter((b) => getComputedStyle(b).display !== 'none');
    const spill = btns.map((b) => {
      const cs = getComputedStyle(b);
      const inner = b.getBoundingClientRect().width
        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      const rr = document.createRange(); rr.selectNodeContents(b);
      return +(rr.getBoundingClientRect().width - inner).toFixed(1);
    });
    return {
      spill, worst: Math.max(...spill),
      rows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size,
    };
  });
  ck(r.worst <= 0, `${width}px: no nav label spills out of its own button`, r.spill.join(' '));
  // Below 320px the stylesheet drops to two columns, so the row count is
  // whatever MODE_KEYS needs at two-up; at and above it, every mode is on
  // one row. Derived rather than stated: this is the assertion that caught
  // the nav still laying out four-up after a fifth mode was added.
  // The stylesheet caps columns at 2 below 320px and at 3 below 600px, so
  // the row count follows from the mode count rather than being a constant.
  // Both numbers are read out of the CSS, so a breakpoint moved there fails
  // here instead of silently re-laying out the front door.
  const cap = width < 320 ? CAP_FOLD : width <= 600 ? CAP_PHONE : N;
  const wantRows = Math.ceil(N / Math.min(N, cap));
  ck(r.rows === wantRows,
     `${width}px: the nav is ${wantRows} row(s) for ${N} modes at ${Math.min(N, cap)} across`, String(r.rows));
  await p.close();
}
await browser.close();
fs.unlinkSync(tmp);

// ===== 2. source-level: nothing writes the nav behind the renderer ========
// The old bug was six places each setting innerText/display on three buttons.
ck(!/getElementById\("btn-(mode|daily|ffa)"\)/.test(html),
   'the three hard-coded nav button ids are gone entirely');
const navWrites = [...html.matchAll(/getElementById\("btn-nav-"/g)].length;
ck(navWrites === 1, 'exactly one place in the file touches a nav slot', String(navWrites));

// Every way into a mode goes through goToMode, so the leave/confirm rules
// cannot be half-applied by a second entry point.
ck(/onclick="window\.goToMode\(this\.dataset\.mode\)"/.test(html), 'the nav routes through goToMode');
ck(/id="gauntlet-card-btn" onclick="window\.goToMode\('gauntlet'\)"/.test(html),
   "the home screen's Trifecta card routes through it too (it used to call openDailyGauntlet directly, which double-confirmed)");
ck(!/window\.toggleMode\(\)|window\.toggleFfaMode\(\)/.test(html),
   'the old per-button toggles are gone, including from the invite-link path');

// ===== 3. the mode you are in is named, and the button states its purpose ==
ck(/<div id="endless-header">/.test(html), 'Stakes has a header of its own');
const eh = endlessHeader;
ck(/STAKES/.test(eh), 'and it says STAKES');
ck(/endless-word-index/.test(eh), 'and shows which word you are on');
// Membership, not the whole selector list. Pinned as an exact string, this
// broke every time a mode was ADDED to the rule - which is the correct
// change - and reported it as Stakes inventing its own layout.
const headerRule = (html.match(/^\s*#score-board[^{]*\{/m) || [''])[0];
ck(/#endless-header/.test(headerRule),
   'it shares the layout rules with the other headers rather than inventing its own',
   headerRule.trim());
// Shown and hidden with the score board at every mode switch.
const show = [...html.matchAll(/getElementById\("endless-header"\)\.style\.display = "(\w+)"/g)].map((m) => m[1]);
ck(show.length >= 6 && show.includes('none') && show.includes('flex'),
   'the Stakes header is toggled at every mode switch', show.join(','));

const bank = grab(/<button class="cash-out-btn"[^>]*>[^<]*<\/button>/, 'bank button');
ck(/Bank/.test(bank) && !/Cash Out/.test(bank), 'the button says Bank, not Cash Out', bank);
// Pinned to the property rather than the expression: the label must show the
// value it is HANDED, never the global `score`. Reading the global is what
// made it impossible for the animation to drive it, and is the whole reason
// the button sat a word behind. The live-score behaviour itself is section 5b.
const bankFn = between(html, 'function updateBankLabel(displayScore) {', '\n        }', 'updateBankLabel');
ck(!/\bscore\b/.test(bankFn.replace(/displayScore/g, '')),
   'the Bank label shows what it is handed and never reads the global score', bankFn.trim().slice(0, 90));
ck(!/>Cash Out</.test(html) && !/Cashed Out!/.test(html),
   'no player-facing surface still says Cash Out');

// Standard is called Stakes everywhere a player can read it — but NOT in the
// stored mode value, which the boards, the archive and every run doc key on.
const facing = html
  .replace(/<!--[\s\S]*?-->/g, '')            // comments
  .replace(/(^|\s)\/\/[^\n]*/g, '')            // line comments, trailing ones included
  .replace(/\/\*[\s\S]*?\*\//g, '')           // block comments
  .replace(/showStandardPanels/g, '')         // an identifier, not a label
  .replace(/Standard (Background|Font)/g, ''); // shop cosmetics, unrelated
const leftovers = [...facing.matchAll(/.{0,40}\bStandard\b.{0,40}/g)].map((m) => m[0].trim());
ck(leftovers.length === 0, 'no player-facing copy still calls the mode Standard',
   leftovers.slice(0, 3).join(' || '));
ck(/mode: "standard"/.test(html) || /"standard"/.test(html),
   'the STORED mode value is untouched — renaming it would orphan every run doc');
ck(/setProfileTab\('standard'\)">Stakes</.test(html),
   "the profile tab is relabelled without moving the panel id it keys on");

// ===== 4. one card per mode, replacing the five-slide tour ================
ck(!/onboarding-slide|ONBOARDING_SLIDE_COUNT/.test(html), 'the five-slide welcome tour is gone');
ck(/<div id="mode-intro-modal"/.test(html), 'there is a single mode intro card');
const intro = between(html, 'const MODE_INTRO = {', '\n        };', 'MODE_INTRO');
for (const mode of ['endless', 'gauntlet', 'clash', 'ffa']) {
  ck(new RegExp(mode + ':\\s*\\{').test(intro), `${mode} has an intro card`);
}
// Short on purpose: the tour was five screens of reading before a first guess.
const texts = [...intro.matchAll(/text: "([^"]*)"/g)].map((m) => m[1]);
eq('every mode has intro text', texts.length, MODE_KEYS.length);
ck(texts.every((x) => x.length <= 260), 'each card stays to a few lines',
   texts.map((x) => x.length).join(','));
ck(/localStorage\.getItem\(modeIntroKey\(mode\)\)/.test(html), 'a card is shown once per mode');
ck(/new URLSearchParams\(location\.search\)\.has\("join"\)/.test(between(html, 'function showModeIntro(mode)', '\n        }\n', 'showModeIntro')),
   'and never on top of a tap-to-join invite, which is mid-flow already');
for (const m of ['await showModeIntro("gauntlet")', 'await showModeIntro("clash")',
                 'await showModeIntro("ffa")', 'await showModeIntro("endless")']) {
  ck(html.includes(m), `entering is gated on the card: ${m}`);
}

// ===== 5. nothing changes mode on its own ================================
//
// The page used to land you on the Trifecta after boot: refreshGauntletCard
// called maybeLandOnGauntlet, which called goToMode("gauntlet"), with a notice
// on screen apologising for the jump. It read as a second page load, and the
// fetch that drove it enrolled every signed-in visitor in that day's Trifecta
// whether they played or not.
//
// It is gone, and the nav is the only way between modes. These pin that from
// the nav's side: a switch nobody asked for is the failure, wherever it is
// written.
ck(!/maybeLandOnGauntlet/.test(html), 'the landing function is gone');

const cardFn = between(html, 'async function refreshGauntletCard() {', '\n        }', 'refreshGauntletCard');
ck(cardFn.length > 200, 'the card function was actually found', `${cardFn.length} chars`);
ck(!/goToMode/.test(cardFn), 'the Trifecta card renders, it does not move you');

// The other place an automatic switch would live: the moment auth resolves.
const authBody = between(html, 'onAuthStateChanged(auth, async (user) => {', '\n        });', 'auth handler');
ck(authBody.length > 200, 'the auth handler was actually found', `${authBody.length} chars`);
ck(!/goToMode/.test(authBody), 'and signing in does not move you either');

// Every remaining way into a mode is something the player did. onclick covers
// the nav buttons and the card button; the invite path is a URL they opened.
const calls = [...html.matchAll(/goToMode\(/g)].length;
const byClick = [...html.matchAll(/onclick="window\.goToMode\(/g)].length;
const isDefinition = /window\.goToMode = async function/.test(html);
ck(isDefinition, 'goToMode is still defined');
ck(byClick >= 2, 'and is reached by tapping something', `${byClick} onclick sites of ${calls} total`);

// ===== 5b. the Bank button cannot fall behind the score ==================
// It did. Both labels lived inside updateScoreBoard, and the SOLVE path never
// calls it — it animates the score itself and hand-writes continues. So from
// the first word you solved, the button showed the score you had before that
// word, and only caught up on a miss. It read "Bank 0 pts" next to "SCORE: 50".
//
// Run as the real extracted source against a fake clock, so this is the
// behaviour and not a grep for a function name.
const animSrc = 'function animateScore(start, end) {' + between(html, 'function animateScore(start, end) {', '\n        }', 'animateScore') + '\n}';
const bankSrc = 'function updateBankLabel(displayScore) {' + between(html, 'function updateBankLabel(displayScore) {', '\n        }', 'updateBankLabel') + '\n}';
const runAnim = new Function('start', 'end', `
  let bankText = null, scoreText = null;
  const ticks = [];
  const document = { getElementById: (id) => id === 'btn-cash-out'
    ? { set innerText(v) { bankText = v; } } : null };
  const scoreDisplay = { set innerText(v) { scoreText = v; } };
  const isVersusMode = false;
  let fns = [];
  const setInterval = (fn) => { fns.push(fn); return 1; };
  const clearInterval = () => { fns = []; };
  ${bankSrc}
  ${animSrc}
  animateScore(start, end);
  // Drive the fake clock to completion, recording what each tick showed.
  for (let i = 0; i < 500 && fns.length; i++) { fns[0](); ticks.push([scoreText, bankText]); }
  return { bankText, scoreText, ticks };
`);

const solve = runAnim(0, 50);
eq('after a +50 solve the button shows 50, not 0', solve.bankText, 'Bank 50 pts');
eq('and the score shows 50 too', solve.scoreText, '50');
ck(solve.ticks.every(([sc, bk]) => bk === 'Bank ' + sc + ' pts'),
   'the button and the score are never out of step, on any frame of the animation',
   JSON.stringify(solve.ticks.slice(0, 3)));

const big = runAnim(12400, 12900);
eq('a later solve lands on the new total', big.bankText, 'Bank 12,900 pts');
ck(big.ticks.every(([sc, bk]) => bk === 'Bank ' + sc + ' pts'), 'thousands separators agree too',
   JSON.stringify(big.ticks.slice(-2)));
ck(big.ticks.length > 1, 'the animation really ran rather than short-circuiting', String(big.ticks.length));

// The invariant that keeps it fixed: every place the score reaches the screen
// writes the button in the same breath.
const scoreWrites = [...html.matchAll(/scoreDisplay\.innerText = [^\n]*\n([\s\S]{0,400}?)(?=\n\s*\}|\n\s*function )/g)];
ck(scoreWrites.length >= 2, 'the score reaches the screen in more than one place', String(scoreWrites.length));
ck(scoreWrites.every((m) => /updateBankLabel\(/.test(m[1])),
   'and every one of them updates the Bank button too');

// What the word number actually prints. Checking only that startRound calls it
// let an off-by-one through: "WORD 0" on a fresh run passed every check here.
const wordSrc = 'function updateWordLabel() {' + between(html, 'function updateWordLabel() {', '\n        }', 'updateWordLabel') + '\n}';
const runWord = new Function('played', `
  let text = null;
  const document = { getElementById: (id) => id === 'endless-word-index'
    ? { set innerText(v) { text = v; } } : null };
  const runStats = { played };
  ${wordSrc}
  updateWordLabel();
  return text;
`);
eq('a fresh run is on word 1, not word 0', runWord(0), '1');
eq('after one solve you are on word 2', runWord(1), '2');
eq('after three finished words you are on word 4', runWord(3), '4');
eq('a long run reads as a number', runWord(1234), '1,235');
eq('a corrupt counter does not print NaN', runWord('nonsense'), '1');

// The word number names the word on the board, so it advances with the board.
ck(/createBoard\(\); resetKeyboardColors\(\); checkDangerRow\(\); updateSkipButton\(\);[\s\S]{0,200}?updateWordLabel\(\);/.test(html),
   'startRound advances the word number, so it names the word actually on screen');

// ===== 6. the homepage blurb describes the modes, in the modes' colours ===
// Colour-coordinated with the nav on purpose: a name read down here should be
// recognisable as the button up there. The two sets of hex values live in
// different places (a CSS rule and inline styles), so they are compared rather
// than trusted.
// Anchored on the section and on the next heading's TEXT, not on a styled
// element: the old anchor was a byte-exact copy of the h2's whole style
// attribute, so a type pass that touched nothing this suite cares about
// broke the extraction outright. An anchor has to be something that is not
// itself under test.
const blurb = between(html, '<section id="site-intro">', 'Support the project', 'homepage blurb');
ck(/this is your place/.test(blurb), 'the Wordle line reads as asked');
ck(/today's Wordle/.test(blurb), 'and still makes the Wordle comparison, which is how people find this');
const MODE_TOKENS = MODE_KEYS.map((m) => m === 'gauntlet' ? '--c-gauntlet' : '--c-' + m);
// What a reader actually sees. A closed mode's line is parked in a <template>
// rather than deleted, which is inert and unindexed — so it is stripped here
// before asking what the page says.
const blurbShown = blurb.replace(/<template[\s\S]*?<\/template>/g, '');
// Derived from the table rather than listed. The list here carried the mode
// NAMES as well as their colours, so renaming a mode failed this as a missing
// colour, which is not what went wrong.
const TOK_FOR = (m) => '--c-' + (m === 'endless' ? 'endless' : m);
for (const m of OPEN_KEYS) {
  const tok = TOK_FOR(m);
  const g = blurbShown.match(new RegExp('<strong style="color:var\\(' + tok + '\\);">([^<]+)</strong>'));
  ck(!!g, `the blurb names the ${m} mode in its own colour (${tok})`,
     (blurbShown.match(new RegExp('<strong[^>]*' + tok + '[^>]*>[^<]*</strong>')) || ['missing'])[0]);
  if (g) eq(`and calls it what the nav calls it`, g[1].toUpperCase(), MODE_LABELS[m]);
}
for (const m of MODE_KEYS.filter((x) => HIDDEN.has(x))) {
  const tok = TOK_FOR(m);
  ck(!new RegExp('<strong style="color:var\\(' + tok + '\\);">').test(blurbShown),
     `a closed mode is not pitched on the front page (${m})`, blurbShown.slice(0, 0));
  // Parked, not deleted — the wording is there for the day it reopens.
  ck(new RegExp('<strong style="color:var\\(' + tok + '\\);">').test(blurb),
     `but its line is kept for when it reopens (${m})`, blurb.slice(0, 0));
}
// And those colours are the mode table's, not a second opinion.
const tableTokens = [...between(html, 'const MODES = {', '\n        };', 'MODES')
  .matchAll(/color: "var\((--c-[\w-]+)\)"/g)].map((m) => m[1]);
eq('the blurb colours are the nav colours', tableTokens, MODE_TOKENS);
// Named colours only. A hex here would be a fifth copy of a value that is
// already in three places, and the one the next repaint forgets.
ck(!/color: "#/.test(between(html, 'const MODES = {', '\n        };', 'MODES')),
   'the mode table names tokens rather than restating hex values');
// Four lines, not four paragraphs: this block was trimmed once already for
// being too much text on a game you are meant to click and play.
const items = [...blurb.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
eq('one line per mode', items.length, MODE_KEYS.length);
ck(items.every((x) => x.length <= 130), 'each stays to a line', items.map((x) => x.length).join(','));

// Leaving the Trifecta says where it puts you. It said "Back to Arcade",
// which names nothing the player can see anywhere else in the app.
ck(!/Back to Arcade/.test(html), 'no button still offers to go "Back to Arcade"');
// Scoped to buttons that name a MODE — "Back to List" and "Back to Game" are
// ordinary navigation inside the archive and the shop, not mode switches.
const backs = [...html.matchAll(/>Back to (\w+)</g)].map((m) => m[1]);
ck(!backs.some((x) => x === 'Arcade' || x === 'Standard'),
   'no "back" button names a mode that does not exist', backs.join(','));
ck(backs.filter((x) => x === 'Stakes').length >= 3,
   'the three that do name a mode all say Stakes, where they actually land you', backs.join(','));

// ===== 6b. the Trifecta's length, and the waiting that came with it ======
const fnSrc = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const GCOUNT = Number(fnSrc.match(/const DAILY_GAUNTLET_WORD_COUNT = (\d+);/)[1]);
eq('the Trifecta is three words', GCOUNT, 3);
// And drawn from one pool. The split used to be a ramp - one word from each
// difficulty third, ordered easiest first - which is what the archive's Tier
// column reported. Three words is too short for that to read as a curve
// rather than as "the last one is the nasty one", so difficulty no longer
// touches the draw at all.
//
// Checked here as a NEGATIVE on the source, because the behavioural version
// belongs in word-difficulty.test.mjs, where the real word list is: a draw
// that sorts, or reads a difficulty, is a ramp again whatever it is called.
const pickSrc = (fnSrc.match(/function pickDailyWords\(exclude\) \{[\s\S]*?\n\}/) || [''])[0];
ck(!!pickSrc, 'pickDailyWords takes an exclusion and nothing else', pickSrc.slice(0, 60));
ck(!/effectiveDifficulty|WORD_DIFFICULTY|\.sort\(|want\b/.test(pickSrc),
   'and reads no difficulty, so the three words are one pool', pickSrc.slice(0, 220));

// The two enforced waits. Both run AFTER the server has graded the guess, so
// they are presentation, not protection — see the note at the call site and
// guessDailyWord's own transaction, which is what actually enforces the guess
// budget. animateRowReveal lands its last tile at 750ms (5 x 150 stagger +
// a 150 flip), so the per-guess beat must cover that and little else.
const perGuess = Number(between(html, 'currentRow++; currentGuess = ""; isAnimating = false; checkDangerRow();', '\n        }', 'per-guess wait').match(/\}, (\d+)\);/)[1]);
ck(perGuess >= 750, 'the per-guess beat still covers the tile reveal', String(perGuess));
ck(perGuess <= 850, 'but is not padded well past it', String(perGuess));
const betweenWords = Number(html.match(/setTimeout\(startDailyRound, (\d+)\)/)[1]);
ck(betweenWords <= 600, 'the gap between words is trimmed', String(betweenWords));
// Roughly 3.7 guesses a word is a normal run; this is the dead time it buys.
const deadMs = GCOUNT * 3.7 * perGuess + GCOUNT * betweenWords;
ck(deadMs < 30000, 'a whole Trifecta spends under 30s waiting on animations',
   `${Math.round(deadMs / 1000)}s`);

// Nothing about the delay may claim to be a security control, because it is
// not one and writing that down would mislead whoever next tries to trim it.
const guessFn = fnSrc.slice(fnSrc.indexOf('exports.guessDailyWord'));
ck(/attempt\.status !== "active"/.test(guessFn.slice(0, 2000)), 'the server rejects a guess on a finished attempt');
ck(/guesses\.length >= DAILY_GAUNTLET_MAX_GUESSES/.test(guessFn.slice(0, 2000)),
   'and enforces the guess budget itself, which is what the client timer never did');

// You can stop and come back — said where players will see it, and true.
ck(/pick up where you left off/.test(between(html, 'const MODE_INTRO = {', '\n        };', 'MODE_INTRO')),
   'the Trifecta intro card says you can stop and resume');
const startDaily = between(html, 'function startDailyRound() {', '\n        }', 'startDailyRound');
ck(/wordEntry\.guesses\.forEach/.test(startDaily) && /currentRow = wordEntry\.guesses\.length/.test(startDaily),
   'and resuming really does replay the guesses already made on that word, so the claim is true');

// Every surface agrees on the number. The canonical sentence is checked for
// agreement in docs-consistency; this is the count itself.
ck(!/\ball ten\b/i.test(html.replace(/<!--[\s\S]*?-->/g, '').replace(/(^|\s)\/\/[^\n]*/g, '')),
   'no player-facing copy still says all ten');

// ===== 7. the donation note stays under every mode ========================
ck(/<section id="site-intro"/.test(html), 'the support note is on the page');
ck(/Support the project/.test(html), 'and still says what it is');
ck(!/getElementById\("site-intro"\)/.test(html) && !/#site-intro\s*\{[^}]*display:\s*none/.test(html),
   'nothing ever hides it, so it sits under Stakes, the Trifecta, Clash and FFA alike');
const panels = between(html, 'function showStandardPanels(visible) {', '\n        }', 'showStandardPanels');
ck(!/site-intro/.test(panels), 'the mode-switch panel toggle does not touch it either');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
