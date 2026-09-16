/*
 * The "today's Gauntlet is already done" screen.
 *
 * A Gauntlet is one run per day, so once it's finished there is nothing left
 * to type. Dismissing the end modal used to leave an empty board and a live
 * keyboard above a header still reading "WORD 1/10 · SCORE: 0" — a screenful
 * of dead space above the standings the player came back to see.
 *
 * setGauntletPlaySurfaceVisible(false) takes that surface down, and true puts
 * it back. The risk in a hide/restore pair like this is the restore: the
 * values are written literally ("flex", "grid", "flex"), so if a stylesheet
 * default ever changes, the element comes back with the wrong layout and
 * nothing would obviously break until someone looked. These cases run the real
 * function against the real markup and stylesheet, and compare the restored
 * layout against a pristine copy of each element rather than against the
 * literals.
 *
 * Needs Playwright (see pwa.test.mjs), not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const css = grab(/<style>[\s\S]*?<\/style>/).replace(/<\/?style>/g, '');
const fnSrc = grab(/        function setGauntletPlaySurfaceVisible\(visible\) \{\n[\s\S]*?\n        \}/);
// The real elements, lifted whole so this can't drift from what ships.
const header = grab(/    <div id="daily-header"[\s\S]*?\n    <\/div>/);
const legend = grab(/    <div id="legend">[\s\S]*?\n    <\/div>/);
const keyboard = grab(/    <div id="keyboard">[\s\S]*?\n    <\/div>/);
console.log('extracted from index.html:', fnSrc.length + header.length + legend.length + keyboard.length, 'chars');

// openDailyGauntlet shows the header before either branch runs, so the harness
// does the same — otherwise it stays at its markup default of display:none and
// the layout measurements below are taken against a collapsed element.
const page_html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
${header.replace('id="daily-header" style="display:none;"', 'id="daily-header" style="display:flex;"')}
${legend}
<div id="board"></div>
${keyboard}
<div id="gauntlet-feed-container" style="display:block;"><div id="gauntlet-feed-list">board</div></div>
<script>${fnSrc}
window.setGauntletPlaySurfaceVisible = setGauntletPlaySurfaceVisible;</script>
</body></html>`;
const tmp = path.join(REPO('tests'), '.done-surface.tmp.html');
fs.writeFileSync(tmp, page_html);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }

const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);
const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('file://' + tmp);
  // The stylesheet's own values, read off pristine clones before anything is
  // toggled — this is what the restore must reproduce.
  const pristine = await page.evaluate(() => {
    const out = {};
    for (const id of ['legend', 'board', 'keyboard']) out[id] = getComputedStyle(document.getElementById(id)).display;
    return out;
  });
  ck(Object.values(pristine).every(Boolean), 'read the stylesheet defaults', JSON.stringify(pristine));
  ck(await page.evaluate(() => document.getElementById('daily-header').getBoundingClientRect().height > 0),
     'the harness has the header on screen, as openDailyGauntlet leaves it');

  const snapshot = () => page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return { display: getComputedStyle(el).display, height: el.getBoundingClientRect().height };
    };
    return {
      legend: vis('legend'), board: vis('board'), keyboard: vis('keyboard'),
      progress: vis('daily-progress-text'), complete: vis('daily-complete-text'),
      feed: vis('gauntlet-feed-container'),
    };
  });

  // --- finished ---------------------------------------------------------
  await page.evaluate(() => window.setGauntletPlaySurfaceVisible(false));
  let s = await snapshot();
  ck(s.keyboard.display === 'none', 'the keyboard comes down when the run is over', s.keyboard.display);
  ck(s.board.display === 'none', 'the empty board comes down', s.board.display);
  ck(s.legend.display === 'none', 'the colour legend comes down', s.legend.display);
  ck(s.complete.display !== 'none' && s.progress.display === 'none',
     'the header reads COMPLETE instead of "WORD 1/10"', JSON.stringify([s.progress.display, s.complete.display]));
  ck(s.keyboard.height === 0 && s.board.height === 0 && s.legend.height === 0,
     'none of them leaves height behind — this is the dead space that was reported',
     JSON.stringify([s.keyboard.height, s.board.height, s.legend.height]));
  ck(s.feed.display !== 'none' && s.feed.height > 0, 'the standings are still there');

  // --- back to playing --------------------------------------------------
  await page.evaluate(() => window.setGauntletPlaySurfaceVisible(true));
  s = await snapshot();
  ck(s.legend.display === pristine.legend, 'the legend restores to its stylesheet display', `${s.legend.display} vs ${pristine.legend}`);
  ck(s.board.display === pristine.board, 'the board restores to its stylesheet display', `${s.board.display} vs ${pristine.board}`);
  ck(s.keyboard.display === pristine.keyboard, 'the keyboard restores to its stylesheet display', `${s.keyboard.display} vs ${pristine.keyboard}`);
  ck(s.keyboard.height > 0, 'the keyboard is actually usable again', String(s.keyboard.height));
  ck(s.progress.display !== 'none' && s.complete.display === 'none',
     'the header goes back to "WORD 1/10"', JSON.stringify([s.progress.display, s.complete.display]));

  // --- idempotent, and survives a round trip ----------------------------
  await page.evaluate(() => {
    window.setGauntletPlaySurfaceVisible(false); window.setGauntletPlaySurfaceVisible(false);
    window.setGauntletPlaySurfaceVisible(true); window.setGauntletPlaySurfaceVisible(true);
  });
  s = await snapshot();
  ck(s.keyboard.display === pristine.keyboard && s.keyboard.height > 0,
     'repeated toggles leave the keyboard in one piece', s.keyboard.display);

  // --- the layout the player actually sees ------------------------------
  await page.evaluate(() => window.setGauntletPlaySurfaceVisible(false));
  const gap = await page.evaluate(() => {
    const head = document.getElementById('daily-header').getBoundingClientRect();
    const feed = document.getElementById('gauntlet-feed-container').getBoundingClientRect();
    return Math.round(feed.top - head.bottom);
  });
  ck(gap < 60, 'the standings sit just below the header, with no screenful of gap', gap + 'px');
} finally {
  await browser.close();
  fs.unlinkSync(tmp);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
