/*
 * No page may scroll sideways on a phone.
 *
 * This exists because three separate things were broken at once and none of
 * them were noticed until someone opened the site on a phone:
 *
 *   - Every hand-written page had a .container that is width:100% PLUS 25px
 *     of padding and a 2px border with no box-sizing, so it rendered 404px
 *     wide inside a 350px slot. strategy.html was 183px over.
 *   - The generated archive pages inherited that template and added wide
 *     tables on top of it.
 *   - index.html's on-screen keyboard floored each key at ~36px, because a
 *     flex item's default min-width:auto stops it shrinking below its own
 *     content. Ten of those plus gaps overflowed every phone at 375px or
 *     under — iPhone SE 2/3 and 6/7/8 among them.
 *
 * All three produce the same symptom and the same one-line check, so the
 * check lives here and covers every page at once. A horizontal scrollbar on
 * a game you play with your thumbs is not a cosmetic problem.
 *
 * Needs Playwright, not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

// 280 fold cover · 320 iPhone SE 1 · 360 common Android · 375 iPhone SE 2/3,
// 6/7/8 · 390 iPhone 12-15 · 414 Plus/XR · 428 Pro Max.
const WIDTHS = [280, 320, 360, 375, 390, 414, 428];
const PAGES = ['index.html', 'how-to-play.html', 'strategy.html', 'faq.html',
               'about.html', 'privacy.html', 'terms.html'];

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);

const t = [];
const ok = (name, cond, detail = '') => t.push({ name, cond, detail });

const measure = async (html, width) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(html);
  await page.waitForTimeout(140);
  const m = await page.evaluate(() => {
    // How far the widest text inside an element exceeds its own content box.
    // A shrunken button whose label spills into the gap does not widen the
    // document, so overflow alone would not catch it.
    const spill = (el) => {
      const cs = getComputedStyle(el);
      const inner = el.getBoundingClientRect().width
        - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().width - inner;
    };
    const keys = [...document.querySelectorAll('.key')];
    return {
      viewport: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      keySpill: keys.length ? Math.round(Math.max(...keys.map(spill)) * 10) / 10 : null,
      keyW: keys.length ? Math.round(keys[0].getBoundingClientRect().width * 10) / 10 : null,
      keyH: keys.length ? Math.round(keys[0].getBoundingClientRect().height) : null,
    };
  });
  await page.close();
  return m;
};

// ---- 1. nothing scrolls sideways, anywhere -------------------------------
for (const file of PAGES) {
  const html = fs.readFileSync(REPO(file), 'utf8').replace(/\r\n/g, '\n');
  const bad = [];
  for (const w of WIDTHS) {
    const m = await measure(html, w);
    if (m.doc > m.viewport + 1) bad.push(`${w}px +${m.doc - m.viewport}`);
  }
  ok(`${file}: no horizontal overflow at any phone width`, bad.length === 0, bad.join(', '));
}

// The generated archive pages come out of the renderer, not the repo.
const R = await import('../tools/gauntlet-archive-render.mjs');
const WORDS = ['ARISE', 'HOUSE', 'MEDIA', 'GRAPE', 'TOKEN', 'FLINT', 'WRYLY', 'ABYSS', 'QUELL', 'NYMPH'];
const runs = Array.from({ length: 30 }, (_, i) => ({ username: 'PLAYER_NAME_' + i, score: 4000 - i * 97, wordsGuessed: 10 - (i % 11) }));
const attempts = runs.map(() => WORDS.map(() => ({ guesses: [1, 2, 3], solved: true })));
const generated = {
  'gauntlet day page': R.renderDayPage({ date: '2026-09-24', words: WORDS, runs, attempts, prev: '2026-09-23', next: null }),
  'gauntlet hub page': R.renderHubPage(Array.from({ length: 12 }, (_, i) => ({ date: `2026-09-${String(24 - i).padStart(2, '0')}`, players: 47, perfect: 2, topScore: 4250 }))),
};
for (const [label, html] of Object.entries(generated)) {
  const bad = [];
  for (const w of WIDTHS) {
    const m = await measure(html, w);
    if (m.doc > m.viewport + 1) bad.push(`${w}px +${m.doc - m.viewport}`);
  }
  ok(`${label}: no horizontal overflow at any phone width`, bad.length === 0, bad.join(', '));
}

// ---- 2. the keyboard specifically ----------------------------------------
const home = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const kb = {};
for (const w of WIDTHS) kb[w] = await measure(home, w);

ok('every key label fits inside its own button',
   WIDTHS.filter((w) => w <= 385).every((w) => kb[w].keySpill <= 0),
   WIDTHS.map((w) => `${w}:${kb[w].keySpill}`).join(' '));
ok('keys actually shrink as the screen narrows',
   kb[280].keyW < kb[320].keyW && kb[320].keyW < kb[375].keyW,
   `280:${kb[280].keyW} 320:${kb[320].keyW} 375:${kb[375].keyW}`);
ok('keys stay a usable height even at 280px', kb[280].keyH >= 40, String(kb[280].keyH));

// The whole point of scoping the fix to 385px: a phone where it already fit
// must render identically. 390/414/428 all sit above the breakpoint.
ok('390, 414 and 428 are untouched by the narrow-screen rules',
   kb[390].keyH === 52 && kb[414].keyH === 52 && kb[428].keyH === 52
   && kb[390].keyW === kb[414].keyW,
   `390:${kb[390].keyW}x${kb[390].keyH} 414:${kb[414].keyW}x${kb[414].keyH} 428:${kb[428].keyW}x${kb[428].keyH}`);
ok('the narrow rules are bounded, not global',
   /@media \(max-width: 385px\)/.test(home) && !/\.key \{[^}]*min-width: 0[^}]*\}\s*\n\s*\.key:active/.test(home));

// ---- 3. the root cause, pinned -------------------------------------------
ok('min-width:0 is what lets a key shrink at all', /\.key \{ min-width: 0;/.test(home));
for (const f of ['about.html', 'faq.html', 'how-to-play.html', 'privacy.html', 'strategy.html', 'terms.html']) {
  ok(`${f}: has box-sizing, the cause of the 404px container`,
     /box-sizing: border-box/.test(fs.readFileSync(REPO(f), 'utf8')));
}

await browser.close();
let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
