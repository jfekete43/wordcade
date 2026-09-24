/*
 * Placement badges and the Profile modal's tab switching.
 *
 * The badges replaced a 📊 emoji. Drawn SVG rather than emoji because an emoji
 * renders in whatever style the viewer's OS ships — a different design
 * language from the rest of the arcade UI, and different on every device. The
 * mapping has four boundaries (3rd/4th and 10th/11th) that are easy to put
 * one off, and the SVG has to be inert markup since it is concatenated into an
 * innerHTML string next to player-supplied text.
 *
 * The tab switcher replaced two inline handlers that each had to name the
 * other panel — a shape that does not survive a third tab, and whose failure
 * mode (two panels open, or none) is exactly what is asserted here.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const badgeSrc = grab(/        const PLACE_BADGES = \{\n[\s\S]*?\n        \};/);
const mapSrc = grab(/        function placeBadge\(place\) \{\n[\s\S]*?\n        \}/);
const tabSrc = grab(/        window\.setProfileTab = function\(name\) \{\n[\s\S]*?\n        \};/);
console.log('extracted from index.html:', badgeSrc.length + mapSrc.length + tabSrc.length, 'chars');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// ---- badges --------------------------------------------------------------
const { PLACE_BADGES, placeBadge } = new Function(
  `${badgeSrc}\n${mapSrc}\nreturn { PLACE_BADGES, placeBadge };`)();

const names = Object.fromEntries(Object.entries(PLACE_BADGES).map(([k, v]) => [v, k]));
const which = (place) => names[placeBadge(place)];

ck(which(1) === 'gold', '1st gets gold', which(1));
ck(which(2) === 'silver', '2nd gets silver', which(2));
ck(which(3) === 'bronze', '3rd gets bronze', which(3));
ck(which(4) === 'top10', '4th is off the podium and gets the star', which(4));
ck(which(10) === 'top10', '10th is the last star', which(10));
ck(which(11) === 'plain', '11th drops to the plain marker', which(11));
ck(which(500) === 'plain', 'a distant placing still gets a badge', which(500));
// Defensive: the callers pass a count-derived number, but a failed lookup or a
// corrupt field must not produce a broken img.
for (const junk of [0, -1, null, undefined, NaN, 'abc', Infinity]) {
  ck(which(junk) === 'plain', `a junk placement (${String(junk)}) falls back to the plain badge`, which(junk));
}
ck(new Set(Object.values(PLACE_BADGES)).size === 5, 'all five badges are distinct artwork');

for (const [key, svg] of Object.entries(PLACE_BADGES)) {
  ck(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), `${key}: is a self-contained svg element`);
  // Concatenated into innerHTML beside player-supplied text, so it must carry
  // nothing executable of its own.
  ck(!/<script|\son\w+\s*=|javascript:/i.test(svg), `${key}: carries no script or event handler`);
  ck(!svg.includes('`'), `${key}: no backtick that would break the template literal it sits in`);
  const open = (svg.match(/<svg/g) || []).length, close = (svg.match(/<\/svg>/g) || []).length;
  ck(open === 1 && close === 1, `${key}: exactly one svg root`, `${open}/${close}`);
}
// Each badge defines its own gradient ids; two different badges sharing one id
// would silently take the first definition in the document.
const ids = Object.values(PLACE_BADGES).flatMap((s) => [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
ck(new Set(ids).size === ids.length, 'no gradient or filter id is reused across badges', ids.join(','));

// ---- profile tabs --------------------------------------------------------
// Read the tab list out of setProfileTab itself rather than hard-coding it:
// a hard-coded copy went stale the moment a fourth tab was added, and the
// new tab would then have escaped every case below instead of failing one.
const TABS = JSON.parse(tabSrc.match(/for \(const tab of (\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
ck(TABS.length >= 3, 'the tab list was read out of the source', TABS.join(','));
const els = {};
for (const tab of TABS) {
  els['profile-' + tab] = { style: { display: 'none' } };
  els['tab-prof-' + tab] = { classes: new Set(), classList: null };
  els['tab-prof-' + tab].classList = { toggle: (c, on) => on ? els['tab-prof-' + tab].classes.add(c) : els['tab-prof-' + tab].classes.delete(c) };
}
let loadedGauntlet = 0;
const setProfileTab = new Function('document', 'loadGauntletStats', `
  const window = {};
  ${tabSrc}
  return window.setProfileTab;
`)({ getElementById: (id) => els[id] }, () => { loadedGauntlet++; });

const shown = () => TABS.filter((tab) => els['profile-' + tab].style.display !== 'none');
const active = () => TABS.filter((tab) => els['tab-prof-' + tab].classes.has('active'));

for (const tab of TABS) {
  setProfileTab(tab);
  ck(JSON.stringify(shown()) === JSON.stringify([tab]), `${tab}: exactly one panel is visible`, shown().join(','));
  ck(JSON.stringify(active()) === JSON.stringify([tab]), `${tab}: exactly one tab is marked active`, active().join(','));
}
// Switching away and back must not leave two panels open — the failure the old
// pairwise handlers were one tab away from.
setProfileTab('clash'); setProfileTab('gauntlet'); setProfileTab('standard');
ck(shown().length === 1 && shown()[0] === 'standard', 'after switching around, still exactly one panel', shown().join(','));

const before = loadedGauntlet;
setProfileTab('clash');
ck(loadedGauntlet === before, 'the Gauntlet reads are not paid for by other tabs');
setProfileTab('gauntlet');
ck(loadedGauntlet === before + 1, 'opening the Gauntlet tab loads its stats');
// Not memoised on purpose: finishing a Gauntlet does not reload the page, and
// today's placement moves as other people finish, so a cached panel would go
// stale for the rest of the session.
setProfileTab('standard'); setProfileTab('gauntlet');
ck(loadedGauntlet === before + 2, 'reopening the tab re-reads rather than serving stale numbers', String(loadedGauntlet - before));

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
