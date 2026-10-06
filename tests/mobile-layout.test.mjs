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
// Found on disk, so a page added later is covered without anyone remembering.
const STATIC_PAGES = fs.readdirSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
  .filter((f) => f.endsWith('.html') && f !== 'index.html').sort();
const PAGES = ['index.html', ...STATIC_PAGES];

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

// ---- 3. the quick-chat chips ---------------------------------------------
// The chat box is display:none until a match starts, so the sweep above never
// sees it. The chips are the ONLY way to talk in a public match and they are
// tapped one-handed mid-race, so they need a real tap target, and a row of six
// of them must not widen the page on the narrowest phone.
const chatAt = async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(home);
  const m = await page.evaluate(() => {
    document.getElementById('clash-chat-container').style.display = 'block';
    const row = document.getElementById('chat-presets');
    // Same phrases the app builds; the count is what decides the row width.
    ['Good luck!', 'Nice!', 'Wow!', 'So close!', 'gg', 'Thanks!'].forEach((phrase) => {
      const b = document.createElement('button');
      b.className = 'chat-chip';
      b.textContent = phrase;
      row.appendChild(b);
    });
    const chips = [...row.querySelectorAll('.chat-chip')];
    return {
      viewport: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      minH: Math.min(...chips.map((c) => Math.round(c.getBoundingClientRect().height))),
      minW: Math.min(...chips.map((c) => Math.round(c.getBoundingClientRect().width))),
      scrolls: row.scrollWidth > row.clientWidth + 1,
      clipped: chips.some((c) => c.getBoundingClientRect().right > row.getBoundingClientRect().right + 1),
    };
  });
  await page.close();
  return m;
};
const chat = {};
for (const w of WIDTHS) chat[w] = await chatAt(w);

ok('the chat box never widens the page at any phone width',
   WIDTHS.every((w) => chat[w].doc <= chat[w].viewport + 1),
   WIDTHS.map((w) => `${w}:+${chat[w].doc - chat[w].viewport}`).join(' '));
// 34px is not the 44px guideline, but it is a deliberate floor: the box sits
// above the board mid-match, so every pixel of chip height costs board.
ok('every chip is a tappable height, even at 280px',
   WIDTHS.every((w) => chat[w].minH >= 34),
   WIDTHS.map((w) => `${w}:${chat[w].minH}px`).join(' '));
ok('and a tappable width',
   WIDTHS.every((w) => chat[w].minW >= 30),
   WIDTHS.map((w) => `${w}:${chat[w].minW}px`).join(' '));
// Chips that do not fit must be reachable by scrolling the row, never simply
// cut off — which is what would happen without overflow-x on #chat-presets.
ok('where the chips do not all fit, the row scrolls rather than clipping them',
   WIDTHS.every((w) => !chat[w].clipped || chat[w].scrolls),
   WIDTHS.map((w) => `${w}:${chat[w].clipped ? 'clipped' : 'fits'}/${chat[w].scrolls ? 'scrolls' : 'static'}`).join(' '));
ok('#chat-presets is a scrolling row, not a wrapping grid',
   /#chat-presets \{[^}]*overflow-x: auto/.test(home) && !/#chat-presets \{[^}]*flex-wrap/.test(home));

// ---- 3b. Cash Out must not move while you play ---------------------------
// It started as a third item in a wrapping row, which fitted beside the score
// while the score was short and dropped below once it grew — so the button
// relocated MID-RUN, at a threshold that differed per width (past 999 points at
// 390px, past 99,999 at 414px). A control that moves while you are deciding
// whether to press it is worse than either position. It is a column now: the
// score keeps its own row, the button is always centred beneath it.
const SCORES = ['0', '250', '1,500', '12,400', '128,750', '1,284,300'];
const cashOutAt = async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(home);
  await page.waitForTimeout(120);
  const m = await page.evaluate((scores) => {
    document.getElementById('score-board').style.display = 'flex';
    const c = document.getElementById('btn-cash-out');
    c.style.display = 'inline-block';
    return scores.map((v) => {
      document.getElementById('score').innerText = v;
      const row = document.querySelector('.score-row').getBoundingClientRect();
      const b = c.getBoundingClientRect();
      // Scoped to the row. Unscoped, the first .score-text on the page is
      // the Endless header's mode label, which sits ABOVE this row by design
      // — so the pair read as stacked and this failed at every width.
      const score = document.querySelector('.score-row .score-text').getBoundingClientRect();
      const lives = document.querySelector('.score-row .lives-text').getBoundingClientRect();
      return {
        v,
        offBelowRow: Math.round(b.top - row.bottom),
        offCentre: Math.round((b.left + b.width / 2) - document.documentElement.clientWidth / 2),
        // The row must have a real box. `display: contents` removes it, which
        // makes every measurement above read zero — consistently, so the two
        // checks below passed against a score and continues stacked vertically.
        rowHeight: Math.round(row.height),
        // And the pair belongs side by side; they are one reading.
        pairSideBySide: Math.abs(score.top - lives.top) < 4,
      };
    });
  }, SCORES);
  await page.close();
  return m;
};
for (const w of WIDTHS) {
  const m = await cashOutAt(w);
  // Same gap under the score row whatever the score reads. The row itself may
  // get taller when a seven-digit score wraps at 280px — that is the text
  // reflowing, not the button moving.
  ok(`${w}px: Cash Out keeps the same gap below the score at every score`,
     new Set(m.map((x) => x.offBelowRow)).size === 1,
     m.map((x) => `${x.v}:${x.offBelowRow}px`).join(' '));
  ok(`${w}px: and stays centred`,
     m.every((x) => Math.abs(x.offCentre) <= 2),
     m.map((x) => `${x.v}:${x.offCentre}`).join(' '));
  ok(`${w}px: the score row is a real row, not a phantom box`,
     m.every((x) => x.rowHeight > 0), m.map((x) => `${x.v}:${x.rowHeight}px`).join(' '));
  // At 280px a seven-digit score legitimately wraps the pair; anywhere else
  // score and continues read as one line.
  if (w >= 320) {
    ok(`${w}px: score and continues stay side by side`,
       m.every((x) => x.pairSideBySide), m.map((x) => `${x.v}:${x.pairSideBySide}`).join(' '));
  }
}

// ---- 4. the root cause, pinned -------------------------------------------
ok('min-width:0 is what lets a key shrink at all', /\.key \{ min-width: 0;/.test(home));
for (const f of STATIC_PAGES) {
  ok(`${f}: has box-sizing, the cause of the 404px container`,
     /box-sizing: border-box/.test(fs.readFileSync(REPO(f), 'utf8')));
}

await browser.close();
let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
