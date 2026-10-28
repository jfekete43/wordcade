/*
 * The board has to be readable, in every theme.
 *
 * Every button on the page is already measured (button-contrast), and every
 * season's title, score and continues counter are measured against that
 * season's background (seasonal-themes). The board itself was measured by
 * nobody — which is the one surface the game is actually played on, and the
 * one the palette change was mostly about.
 *
 * The gap was not theoretical. Repainting the page from black to paper left
 * an absent tile at 2.57:1 between its letter and its fill, and the full
 * browser suite stayed green; the number only came out because it was worked
 * out by hand first. A later repaint would not get that courtesy.
 *
 * Three things are checked, for a plain body, for colorblind mode, and for
 * all eight seasons:
 *
 *   1. A letter is readable on the tile it sits on. Tiles are 30px bold, so
 *      3:1 is the applicable WCAG threshold.
 *   2. A tile is distinguishable from the page behind it. An empty cell that
 *      matches the paper exactly is not a cell.
 *   3. The three verdicts are distinguishable from each other. Right spot,
 *      wrong spot and not-in-the-word are the entire feedback channel.
 *
 * Two different instruments, on purpose. WCAG contrast ratio answers "can you
 * read this", and that is all it answers: it is a function of lightness
 * alone. Asked whether two FILLS are different it reports 1.00:1 for the
 * blue and the amber, which are the most different pair on the screen and
 * were picked for exactly that — they just happen to weigh the same. So
 * telling colours apart is measured as a distance in CIE Lab instead, which
 * counts hue. For scale, on the light palette: paper against white is 6,
 * paper against an absent tile is 19, the closest two verdicts are 53, and
 * the old cyan/magenta pair was 157.
 *
 * The keyboard gets 1 and 3 as well: it carries the same three verdicts, and
 * on a dark page it did it with an opacity trick that does not survive a
 * light one.
 *
 * Needs Playwright, not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const LETTER_MIN = 3.0;   // 30px bold, WCAG contrast ratio
const KEY_MIN = 3.0;      // 16px bold, same
const TILE_VS_PAGE_DE = 10;   // CIE Lab distance; white-on-paper is 6
const VERDICT_DE = 35;        // the closest real pair is 53

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

// The seasons come from the page's own table, so a new one cannot be added
// without this suite noticing.
const SEASONS = [...html.matchAll(/\{ id: "(\w+)",\s+label:/g)].map((m) => m[1]);
if (SEASONS.length < 8) throw new Error('expected the eight seasons, found ' + SEASONS.length);
const STATES = ['', 'colorblind', ...SEASONS.map((s) => 'season-' + s)];

// The real classes, which are the contract between the script and the
// stylesheet. The board is built in JS, so the markup is written here rather
// than extracted — what matters is that these are the class names the game
// actually applies (createBoard, updateCurrentRowDisplay, the grader).
const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}
* { transition: none !important; animation: none !important; }
</style></head><body><div id="board">
  <div class="row">
    <div class="tile" id="t-empty">A</div>
    <div class="tile typed" id="t-typed">B</div>
    <div class="tile correct" id="t-correct">C</div>
    <div class="tile present" id="t-present">D</div>
    <div class="tile absent" id="t-absent">E</div>
  </div>
</div>
<div id="keyboard"><div class="key-row">
  <button class="key" id="k-plain">A</button>
  <button class="key correct" id="k-correct">B</button>
  <button class="key present" id="k-present">C</button>
  <button class="key absent" id="k-absent">D</button>
</div></div></body></html>`;
const tmp = REPO('tests/.board-contrast.tmp.html');
fs.writeFileSync(tmp, page);

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
  const p = await browser.newPage({ viewport: { width: 420, height: 700 } });
  await p.goto('file://' + tmp);
  await p.evaluate(() => document.fonts.ready);

  const measured = await p.evaluate((states) => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    // CIE Lab, so that "is this a different colour" counts hue and not only
    // weight. D65 white point, the same one sRGB is defined against.
    const lab = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const [R, G, B] = [f(r), f(g), f(b)];
      const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
      const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
      const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
      const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      const [fx, fy, fz] = [g2(X), g2(Y), g2(Z)];
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    };
    const dE = (a, b) => {
      const [p, q] = [lab(a), lab(b)];
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    // A tile may be transparent (an unplayed one is), and it may be faded by
    // opacity, so what the eye gets is the composite over whatever is behind.
    const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
    const flatten = (el) => {
      let acc = null;
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const col = parse(cs.backgroundColor);
        const a = col.length === 4 ? col[3] : 1;
        const layer = over(col.slice(0, 3), [255, 255, 255], a * Number(cs.opacity || 1));
        if (a * Number(cs.opacity || 1) >= 0.999) return acc ? acc : layer;
        if (!acc) acc = a > 0 ? layer : null;
      }
      return acc || [255, 255, 255];
    };
    const paint = (el) => {
      const cs = getComputedStyle(el);
      const bg = flatten(el);
      const fg = parse(cs.color).slice(0, 3);
      const o = Number(cs.opacity || 1);
      return { bg, fg, ink: ratio(o < 1 ? over(fg, bg, o) : fg, bg) };
    };
    const out = {};
    for (const st of states) {
      document.body.className = st;
      const page = flatten(document.body);
      const ids = ['t-empty', 't-typed', 't-correct', 't-present', 't-absent',
                   'k-plain', 'k-correct', 'k-present', 'k-absent'];
      const cells = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        const m = paint(el);
        cells[id] = { ink: m.ink, vsPage: dE(m.bg, page), bg: m.bg, fg: m.fg,
                      border: getComputedStyle(el).borderTopColor,
                      style: getComputedStyle(el).borderTopStyle };
      }
      out[st || 'plain'] = {
        cells,
        verdicts: {
          'right vs wrong spot': dE(cells['t-correct'].bg, cells['t-present'].bg),
          'right spot vs absent': dE(cells['t-correct'].bg, cells['t-absent'].bg),
          'wrong spot vs absent': dE(cells['t-present'].bg, cells['t-absent'].bg),
          'key right vs wrong spot': dE(cells['k-correct'].bg, cells['k-present'].bg),
          'key right spot vs absent': dE(cells['k-correct'].bg, cells['k-absent'].bg),
          'key wrong spot vs absent': dE(cells['k-present'].bg, cells['k-absent'].bg),
        },
      };
    }
    document.body.className = '';
    return out;
  }, STATES);

  const LETTERED = { 't-correct': 'right spot', 't-present': 'wrong spot', 't-absent': 'absent' };
  const KEYED = { 'k-plain': 'unused', 'k-correct': 'right spot', 'k-present': 'wrong spot', 'k-absent': 'absent' };

  for (const st of Object.keys(measured)) {
    const m = measured[st];
    // 1. the letter on the tile
    for (const [id, what] of Object.entries(LETTERED)) {
      ck(m.cells[id].ink >= LETTER_MIN, `${st}: the letter on a ${what} tile is readable`,
         m.cells[id].ink.toFixed(2) + ':1');
    }
    for (const [id, what] of Object.entries(KEYED)) {
      ck(m.cells[id].ink >= KEY_MIN, `${st}: a ${what} key is readable`,
         m.cells[id].ink.toFixed(2) + ':1');
    }
    // 2. a tile is not the page
    for (const [id, what] of [['t-absent', 'an absent tile'], ['t-correct', 'a right-spot tile'],
                              ['t-present', 'a wrong-spot tile']]) {
      ck(m.cells[id].vsPage >= TILE_VS_PAGE_DE, `${st}: ${what} stands off the page`,
         'dE ' + m.cells[id].vsPage.toFixed(1));
    }
    // 3. the verdicts are not each other
    for (const [what, d] of Object.entries(m.verdicts)) {
      ck(d >= VERDICT_DE, `${st}: ${what} are told apart`, 'dE ' + d.toFixed(1));
    }
  }

  // An unplayed cell is dashed and a committed one is solid: that is the only
  // thing distinguishing the row you are typing in from the rows below it now
  // that neither carries a fill.
  const plain = measured.plain.cells;
  ck(plain['t-empty'].style === 'dashed', 'an unplayed cell is dashed', plain['t-empty'].style);
  ck(plain['t-typed'].style === 'solid', 'a cell you have typed into is solid', plain['t-typed'].style);
  for (const id of ['t-correct', 't-present', 't-absent']) {
    ck(plain[id].style === 'solid', `a graded cell (${id}) is solid`, plain[id].style);
  }

  // ---- the other surface the palette paints: a player's name on a row ----
  // Not the board, but the same failure and nothing else was watching for it.
  // .effect_none is "Standard Font" — the no-cosmetic default, which is chrome
  // wearing a shop item's name. It is #fff because every equipped banner paints
  // a dark plate under the name. The card went white and the default banner
  // paints nothing, so every default player name went white on white at 1:1 —
  // FFA standings, the Clash plates, the Daily Puzzle feed and archive, the
  // leaderboard and the daily board, all at once, with the whole suite green.
  //
  // Checked as the cross product, because the bug was in one cell of it: every
  // banner against every name effect, on the card the row actually sits on.
  // Gradient-only banners report a transparent background-color, so the
  // effective backdrop is whatever opaque ancestor is behind them — which is
  // the point: that is exactly what the reader sees through the wash.
  const bannerNames = [...new Set([...css.matchAll(/\.(banner_[a-z_]+)\s*\{/g)].map((m) => m[1]))];
  const effectNames = [...new Set([...css.matchAll(/\.(effect_[a-z_]+)\s*\{/g)].map((m) => m[1]))];
  ck(bannerNames.length >= 30, `found the banners to check (${bannerNames.length})`);
  ck(effectNames.length >= 20, `found the name effects to check (${effectNames.length})`);

  const HALO_LEGIBLE = ['effect_void', 'effect_singularity'];
  const nameRows = await p.evaluate(({ banners, effects, HALO_LEGIBLE }) => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const host = document.createElement('div');
    host.id = 'daily-board-container';
    document.body.appendChild(host);
    const out = [];
    for (const bn of banners) {
      for (const ef of effects) {
        host.innerHTML = `<div class="lb-entry ${bn}"><div class="lb-rank">1</div>` +
          `<div class="lb-name-col"><div class="lb-name ${ef}">PLAYER</div></div>` +
          `<div class="lb-score">900</div></div>`;
        const el = host.querySelector('.lb-name');
        const cs = getComputedStyle(el);
        // A gradient-text effect paints the glyphs with the background and
        // makes the colour transparent; those carry their own contrast and
        // cannot be measured this way.
        if (cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue;
        // Void Black and Event Horizon are dark ink made legible by a halo,
        // which is their entire design ("Absorbs all light", "Where the light
        // stops"). Colour-against-backdrop is the wrong instrument for them —
        // the same mistake as asking a contrast ratio whether two fills are
        // different — so they are measured by the check below instead, which
        // pins the halo they depend on.
        if (HALO_LEGIBLE.includes(ef)) continue;
        let n = el, bg = [255, 255, 255];
        while (n) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c.length < 4 || c[3] > 0.99) { bg = c.slice(0, 3); break; }
          n = n.parentElement;
        }
        out.push([bn, ef, ratio(parse(cs.color).slice(0, 3), bg)]);
      }
    }
    host.remove();
    return out;
  }, { banners: bannerNames, effects: effectNames, HALO_LEGIBLE });

  // The two skipped above are not exempt, they are measured differently: their
  // legibility IS the text-shadow, so that is what gets pinned. Delete the halo
  // and they become dark ink on a dark plate at 1.01:1 with nothing to catch it.
  const halos = await p.evaluate((names) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const out = {};
    for (const ef of names) {
      host.innerHTML = `<div class="lb-name ${ef}">PLAYER</div>`;
      const cs = getComputedStyle(host.firstChild);
      out[ef] = { shadow: cs.textShadow, weight: cs.fontWeight };
    }
    host.remove();
    return out;
  }, HALO_LEGIBLE);
  for (const ef of HALO_LEGIBLE) {
    ck(halos[ef] && halos[ef].shadow && halos[ef].shadow !== 'none',
       `${ef} keeps the halo it is read by`, halos[ef] && halos[ef].shadow);
  }

  // The shop's preview monitor is the one surface that deliberately stayed
  // black, because everything it previews was drawn for a dark UI. So the fix
  // that darkens a default name on a white card has to NOT reach inside it —
  // which the rows above cannot show, since they build their own container.
  const preview = await p.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const mon = document.createElement('div');
    mon.id = 'shop-preview-monitor';
    mon.innerHTML = '<div id="preview-banner-box" class="lb-entry banner_default">' +
                    '<div class="lb-name effect_none" id="preview-name-box">HANDLE</div></div>';
    document.body.appendChild(mon);
    const el = mon.querySelector('.lb-name');
    let n = el, bg = [255, 255, 255];
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.length < 4 || c[3] > 0.99) { bg = c.slice(0, 3); break; }
      n = n.parentElement;
    }
    const r = ratio(parse(getComputedStyle(el).color).slice(0, 3), bg);
    mon.remove();
    return r;
  });
  ck(preview >= 4.5, 'a default name still reads inside the black shop preview',
     preview.toFixed(2) + ':1');

  const unreadable = nameRows.filter(([, , r]) => r < 4.5);
  ck(unreadable.length === 0,
     `every name reads on every banner (${nameRows.length} pairs measured)`,
     unreadable.slice(0, 8).map(([b, e, r]) => `${b}+${e} ${r.toFixed(2)}:1`).join(' | '));

  const worst = Object.entries(measured).flatMap(([st, m]) =>
    Object.entries(m.cells).map(([id, c]) => [`${st}/${id}`, c.ink]))
    .sort((a, b) => a[1] - b[1])[0];
  console.log(`\nfaintest letter anywhere: ${worst[0]} at ${worst[1].toFixed(2)}:1\n`);
} finally {
  await browser.close();
  fs.unlinkSync(tmp);
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
