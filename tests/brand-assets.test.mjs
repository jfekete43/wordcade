/*
 * The baked assets have to be pictures of the page they open.
 *
 * This exists because they stopped being. The palette moved from cyan and
 * magenta to blue and amber, and seven icons plus the share card stayed on
 * the old colours — for weeks, with every suite green, because nothing in the
 * repo ever looked at a PNG. They were hand-drawn files with no generator, so
 * there was not even anything to re-run.
 *
 * There is now: tools/build-icons.mjs and tools/build-og-card.mjs both read
 * the palette out of index.html rather than restating it. This checks the
 * output rather than the scripts, because what ships is the PNG — a generator
 * that is correct and was never run is exactly the failure being pinned.
 *
 * Decoded in a real browser: canvas is the only PNG and ICO decoder available
 * here, and it is the same decoder the people seeing these icons will use.
 *
 * Needs Playwright, not the emulator.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const token = (name) => {
  const m = html.match(new RegExp('--c-' + name + ':\\s*(#[0-9a-fA-F]{3,8})\\s*;'));
  if (!m) throw new Error('no --c-' + name + ' in index.html');
  let h = m[1].toLowerCase();
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  return h;
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, tol = 10) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

const CORRECT = rgb(token('correct'));
const PRESENT = rgb(token('present'));
const PAGE = rgb(token('page'));
const ON_ACCENT = rgb(token('on-accent'));

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const { execSync } = await import('node:child_process');
  ({ chromium } = await import(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright', 'index.mjs'))); }
const launch = {};
if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(launch);

try {
  const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
  await page.goto('about:blank');

  // Every file is read as a data: URI so the test needs no server, and so a
  // missing file fails loudly here rather than decoding to nothing.
  const asDataUri = (file) => {
    const p = REPO(file);
    if (!fs.existsSync(p)) return null;
    const mime = file.endsWith('.ico') ? 'image/x-icon' : 'image/png';
    return `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
  };

  const probe = async (file) => {
    const uri = asDataUri(file);
    if (!uri) return null;
    return page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const tally = new Map();
      let clear = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 8) { clear++; continue; }
        const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        tally.set(k, (tally.get(k) || 0) + 1);
      }
      const ranked = [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ c: k.split(',').map(Number), n }));
      return { w: c.width, h: c.height, clear, opaque: (data.length / 4) - clear, top: ranked.slice(0, 6) };
    }, uri);
  };

  // ---- the icons ---------------------------------------------------------
  // Every one is the same mark at a different size, so every one must be
  // mostly the correct-tile blue with the letter in --c-on-accent on it.
  const ICONS = ['favicon-16.png', 'favicon-32.png', 'favicon.ico', 'apple-touch-icon.png',
                 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
  for (const f of ICONS) {
    const m = await probe(f);
    ck(!!m, `${f} exists and decodes`);
    if (!m) continue;
    const face = m.top[0];
    ck(near(face.c, CORRECT), `${f} is the correct-tile blue`, `rgb(${face.c}) want rgb(${CORRECT})`);
    ck(face.n / m.opaque > 0.4, `${f} is mostly that, not a stray pixel of it`,
       (100 * face.n / m.opaque).toFixed(0) + '%');
    // 3%: the maskable icon's letter is deliberately smaller than the rest,
    // to stay inside a launcher mask's safe zone, and lands at 3.7%. The bar
    // is there to separate a letter from a stray antialiased pixel, not to
    // pin a size — a missing letter scores 0.
    const ink = m.top.find((x) => near(x.c, ON_ACCENT, 6));
    ck(!!ink && ink.n / m.opaque > 0.03, `${f} carries the letter in --c-on-accent`,
       ink ? (100 * ink.n / m.opaque).toFixed(1) + '%' : 'no such colour in it');
    // Nothing in the old palette may survive anywhere in any of them.
    const neon = m.top.find((x) => near(x.c, [0, 255, 255], 40) || near(x.c, [255, 0, 255], 40));
    ck(!neon, `${f} has no cyan or magenta left in it`, neon ? `rgb(${neon.c})` : '');
  }

  // ---- the share card ----------------------------------------------------
  // The one image a link unfurls into. It has to read as the same product as
  // the page, which means the paper, both signals, and no neon.
  const card = await probe('og-card.png');
  ck(!!card, 'og-card.png exists and decodes');
  if (card) {
    ck(card.w === 1200 && card.h === 630, 'the card is 1200x630', `${card.w}x${card.h}`);
    const bg = card.top[0];
    ck(near(bg.c, PAGE), 'the card is printed on the same paper as the page',
       `rgb(${bg.c}) want rgb(${PAGE})`);
    for (const [name, want] of [['correct', CORRECT], ['present', PRESENT]]) {
      const hit = card.top.find((x) => near(x.c, want));
      ck(!!hit, `the card shows a ${name} tile in the game's own ${name} colour`,
         hit ? '' : `no rgb(${want}) among the six commonest colours`);
    }
    const neon = card.top.find((x) => near(x.c, [0, 255, 255], 40) || near(x.c, [255, 0, 255], 40));
    ck(!neon, 'and no cyan or magenta anywhere in it', neon ? `rgb(${neon.c})` : '');
  }

  // ---- what the markup and the manifest claim ---------------------------
  // A correct PNG referenced by a stale colour is the same bug one layer up.
  const manifest = JSON.parse(fs.readFileSync(REPO('site.webmanifest'), 'utf8'));
  ck(manifest.theme_color.toLowerCase() === token('page'),
     'the manifest theme colour is the page colour', manifest.theme_color);
  ck(manifest.background_color.toLowerCase() === token('page'),
     'and so is its splash background', manifest.background_color);

  const svg = decodeURIComponent((html.match(/href="(data:image\/svg\+xml,[^"]+)"/) || [])[1] || '');
  ck(!!svg, 'index.html carries an inline SVG icon');
  ck(svg.includes(token('correct')), 'the inline SVG icon uses --c-correct', svg.slice(0, 90));
  ck(svg.includes(token('on-accent')), 'and --c-on-accent for its letter');
  ck(!/00ffff|ff00ff/i.test(svg), 'with no cyan or magenta left in it');

  // Both generators must READ the palette rather than restate it — that is
  // the thing that actually stops this drifting again, and it is cheap to pin.
  for (const tool of ['tools/build-icons.mjs', 'tools/build-og-card.mjs']) {
    const src = fs.readFileSync(REPO(tool), 'utf8');
    ck(/index\.html/.test(src) && /--c-/.test(src),
       `${tool} reads the palette out of index.html`);
    const hard = [...src.matchAll(/#(?:[0-9a-fA-F]{6})\b/g)].map((m) => m[0])
      .filter((h) => !/^#(1a1a1d|121213)$/i.test(h));
    ck(hard.length === 0, `${tool} states no colour of its own`, hard.join(' '));
  }
} finally {
  await browser.close();
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
