#!/usr/bin/env node
/*
 * Every icon the site serves, from one definition.
 *
 *   node tools/build-icons.mjs
 *
 * These were hand-made PNGs with no generator, which is exactly how they came
 * to be the last thing on the site still wearing the old look: the palette
 * moved from cyan-and-magenta to blue-and-amber and nothing regenerated them,
 * because there was nothing to run. Eight files drawn by hand drift. One
 * script does not.
 *
 * The mark is the board's own signature square — a correct-guess tile, in the
 * same --c-correct as a letter in the right spot, carrying the L. Not the pale
 * Scrabble face the wordmark uses: at 16px on a light tab strip a pale tile is
 * a smudge, and the tab icon has to hold up against both a light and a dark
 * browser chrome. Blue with white ink does; cream with dark ink does not.
 *
 * Upright, not leaning. The italic went out with the rest of the arcade
 * register, and there is no magenta offset behind it any more because there is
 * no second half of a neon pair to echo.
 *
 * The tab sizes get their own artwork rather than a downscale of the big one:
 * at 16px a generous corner radius eats the face and a proportionally small
 * letter turns to mud, so the small sizes take a tighter radius and a larger
 * letter. That was true of the old icons too and is the one thing about them
 * worth keeping.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Read from the stylesheet rather than restated here, so an icon cannot end up
// a different blue from the tile it is a picture of.
const css = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");
const token = (name) => {
  const m = css.match(new RegExp("--c-" + name + ":\\s*(#[0-9a-fA-F]{3,8})\\s*;"));
  if (!m) throw new Error("could not read --c-" + name + " out of index.html");
  return m[1];
};
const FACE = token("correct");
const INK = token("on-accent");

/* size, file, corner radius as a FRACTION of the box, letter size as a
   fraction, and whether the corners are transparent.

   full-bleed: an Android maskable icon is masked to a circle or squircle by
   the launcher, so it must paint to the edge and be opaque — a transparent
   corner shows the launcher's own background through. Apple does its own
   rounding too, so apple-touch-icon is full-bleed for the same reason. */
const SIZES = [
  { px: 16,  file: "favicon-16.png",         r: 0.17, letter: 0.80, bleed: false },
  { px: 32,  file: "favicon-32.png",         r: 0.17, letter: 0.76, bleed: false },
  { px: 48,  file: ".ico-48.png",            r: 0.17, letter: 0.74, bleed: false, temp: true },
  { px: 180, file: "apple-touch-icon.png",   r: 0,    letter: 0.62, bleed: true  },
  { px: 192, file: "icon-192.png",           r: 0.21, letter: 0.66, bleed: false },
  { px: 512, file: "icon-512.png",           r: 0.21, letter: 0.66, bleed: false },
  // 0.52 keeps the glyph inside the centre 80% that a launcher mask is
  // guaranteed not to clip, with room to spare for the squircle case.
  { px: 512, file: "icon-maskable-512.png",  r: 0,    letter: 0.52, bleed: true  },
];

const page = (s) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${s.px}px; height: ${s.px}px; background: transparent; }
  .tile {
    width: ${s.px}px; height: ${s.px}px;
    background: ${FACE};
    border-radius: ${Math.round(s.px * s.r)}px;
    color: ${INK};
    font-family: 'Liberation Sans', 'DejaVu Sans', 'Segoe UI', Arial, sans-serif;
    font-weight: 700;
    font-size: ${(s.px * s.letter).toFixed(2)}px;
    line-height: 1;
    display: flex; align-items: center; justify-content: center;
    /* The cap-height of an L sits above the baseline, so centring the BOX
       leaves the glyph low. This lifts it onto the optical centre. */
    padding-bottom: ${(s.px * 0.04).toFixed(2)}px;
  }
</style></head><body><div class="tile">L</div></body></html>`;

let chromium;
try { ({ chromium } = await import("playwright")); }
catch {
  const { execSync } = await import("node:child_process");
  ({ chromium } = await import(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright", "index.mjs")));
}
const launch = {};
if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(launch);

for (const s of SIZES) {
  const p = await browser.newPage({ viewport: { width: s.px, height: s.px } });
  await p.setContent(page(s));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(REPO, s.file), omitBackground: !s.bleed });
  await p.close();
  if (!s.temp) console.log(`wrote ${s.file} (${s.px}x${s.px})`);
}
await browser.close();

/* favicon.ico, assembled by hand because no image library here writes one.
 *
 * An .ico is a 6-byte header, a 16-byte directory entry per image, then the
 * images themselves — and since Vista those images may be PNGs stored whole
 * rather than the old BMP-with-AND-mask format. Every browser that matters
 * reads PNG-in-ICO, and it is the only form that can be built from a
 * screenshot without a decoder.
 */
const members = [16, 32, 48].map((px) => {
  const file = px === 48 ? ".ico-48.png" : `favicon-${px}.png`;
  return { px, data: fs.readFileSync(path.join(REPO, file)) };
});
const dir = Buffer.alloc(6 + 16 * members.length);
dir.writeUInt16LE(0, 0);                 // reserved
dir.writeUInt16LE(1, 2);                 // 1 = icon
dir.writeUInt16LE(members.length, 4);
let offset = dir.length;
members.forEach((m, i) => {
  const at = 6 + 16 * i;
  dir.writeUInt8(m.px >= 256 ? 0 : m.px, at);      // 0 means 256
  dir.writeUInt8(m.px >= 256 ? 0 : m.px, at + 1);
  dir.writeUInt8(0, at + 2);             // palette size: 0 for truecolour
  dir.writeUInt8(0, at + 3);             // reserved
  dir.writeUInt16LE(1, at + 4);          // colour planes
  dir.writeUInt16LE(32, at + 6);         // bits per pixel
  dir.writeUInt32LE(m.data.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += m.data.length;
});
const ico = path.join(REPO, "favicon.ico");
fs.writeFileSync(ico, Buffer.concat([dir, ...members.map((m) => m.data)]));
fs.unlinkSync(path.join(REPO, ".ico-48.png"));
console.log(`wrote favicon.ico (16, 32, 48 — ${Math.round(fs.statSync(ico).size / 1024)} KB)`);
