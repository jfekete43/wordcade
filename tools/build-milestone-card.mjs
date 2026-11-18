#!/usr/bin/env node
/*
 * A thank-you card for a milestone worth posting.
 *
 *   node tools/build-milestone-card.mjs --players=10
 *   node tools/build-milestone-card.mjs --players=25 --out=/tmp/card.png
 *
 * UNDATED, on purpose. It carries no Sprint number and no date, so it is
 * made when the milestone lands and posted whenever suits - a card stamped
 * with a day it was generated on is a card with a shelf life, and the thanks
 * do not have one.
 *
 * 1200x675, which is 16:9 - the ratio X shows in a timeline without cropping
 * it. The link-unfurl card (build-og-card.mjs) is 1200x630 and is a different
 * job: that one is fetched by scrapers and has to sell the game to somebody
 * who has never heard of it. This one goes out to the people who turned up,
 * so it thanks them first and reports the number second.
 *
 * NOT generated from Firestore. The number is an argument, so the card can be
 * made from anywhere, with no credentials and no network - including from a
 * phone, which is where the post is going to be written. Checking the real
 * count is a separate question from drawing it.
 *
 * Every colour comes out of index.html, for the reason build-og-card.mjs
 * records at length: a card holding its own copy of the palette is how the
 * last one ended up a cyan-and-magenta picture of a page that had gone to
 * paper. The Sprint accent and the wordmark are read the same way.
 *
 * The confetti is the game's own MODE accents, not a festive palette invented
 * for the occasion: the whole game turning out is the thing being celebrated,
 * and borrowed colours would make it somebody else's party. Positions are
 * fixed rather than generated, so the same milestone draws the same card
 * every time it is asked for.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");

const args = process.argv.slice(2);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const unknown = args.filter((a) => !/^--(players=.*|out=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const PLAYERS = Number(val("--players"));
if (!Number.isInteger(PLAYERS) || PLAYERS < 2) { console.error("--players=N is required (and a milestone needs at least 2)"); process.exit(1); }

// Named for the milestone and nothing else: the same count always produces
// the same card, so re-running it overwrites rather than littering.
const OUT = val("--out") || path.join(REPO, `milestone-${PLAYERS}-players.png`);

const C = (name) => {
  const m = SRC.match(new RegExp("--c-" + name + ":\\s*(#[0-9a-fA-F]{3,8})\\s*;"));
  if (!m) throw new Error("could not read --c-" + name + " out of index.html");
  return m[1];
};

// The page's own wordmark: eight tiles, not a word in a typeface. It is the
// one element that makes a card and the site read as the same product at
// thumbnail size.
const MARK = "LEXATHON".split("");

// Every mode's accent, plus the two verdict colours the board is read by.
const ACCENTS = ["sprint", "endless", "marathon", "clash", "correct", "gauntlet", "present"].map(C);

// Hand-placed down both margins and across the top and bottom edges, so
// nothing lands on the words. Fixed values rather than a generator: a card
// that comes out differently on every run is one nobody can reproduce when
// they want it again.
const CONFETTI = [
  [3, 12, 34, -18], [10, 70, 22, 24], [6, 40, 16, 9], [2, 86, 28, -32],
  [15, 7, 18, 36], [12, 90, 20, -12], [21, 24, 14, 15], [18, 57, 12, -24],
  [93, 10, 32, 21], [88, 64, 24, -16], [96, 42, 18, -7], [91, 87, 26, 30],
  [82, 5, 16, -28], [85, 92, 20, 14], [76, 28, 13, 22], [79, 60, 15, -19],
  [40, 3, 16, 28], [58, 5, 20, -22], [48, 94, 18, 12], [64, 92, 14, -30],
  [33, 96, 15, 19], [70, 2, 13, -11],
].map(([x, y, size, rot], i) => ({ x, y, size, rot, colour: ACCENTS[i % ACCENTS.length] }));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 675px; background: ${C("page")};
    font-family: 'Liberation Sans', 'Segoe UI', Tahoma, Verdana, sans-serif;
    color: ${C("ink")}; position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .confetti { position: absolute; inset: 0; }
  .confetti i { position: absolute; display: block; border-radius: 4px; }
  .stage { position: relative; display: flex; flex-direction: column;
    align-items: center; gap: 24px; }
  .mark { display: flex; gap: 7px; }
  .mark div {
    width: 50px; height: 55px; border-radius: 10px;
    background: ${C("raised")}; border: 2px solid ${C("line-2")};
    box-shadow: 0 2px 0 rgba(42,36,32,.06), 0 5px 14px rgba(42,36,32,.10);
    font-size: 30px; font-weight: bold; letter-spacing: 1px;
    display: flex; align-items: center; justify-content: center;
  }
  .thanks { font-size: 112px; font-weight: bold; line-height: 1; letter-spacing: -2px; }
  .what { font-size: 40px; font-weight: bold; letter-spacing: .3px;
    display: flex; align-items: baseline; gap: 13px; }
  .what b { font-size: 64px; color: ${C("sprint")}; letter-spacing: -1px; }
  .host { font-size: 25px; color: ${C("correct")}; letter-spacing: 1px;
    font-weight: bold; }
</style></head><body>
  <div class="confetti">${CONFETTI.map((c) =>
    `<i style="left:${c.x}%;top:${c.y}%;width:${c.size}px;height:${c.size}px;` +
    `background:${c.colour};transform:rotate(${c.rot}deg)"></i>`).join("")}</div>
  <div class="stage">
    <div class="mark">${MARK.map((ch) => `<div>${ch}</div>`).join("")}</div>
    <div class="thanks">Thank you!</div>
    <div class="what"><b>${PLAYERS.toLocaleString("en-US")}</b> players in a single Sprint</div>
    <div class="host">lexathon.gg</div>
  </div>
</body></html>`;

let chromium;
try { ({ chromium } = await import("playwright")); }
catch {
  const { execSync } = await import("node:child_process");
  ({ chromium } = await import(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright", "index.mjs")));
}
const launch = {};
if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
await page.setContent(html);
await page.waitForTimeout(220);

// The WORDS are measured, not the page. The confetti is absolutely
// positioned and deliberately runs to the edges, so a whole-document
// overflow check would only ever be reporting on the decoration. What must
// not be clipped is the stage, and it wants a margin rather than merely a
// non-negative number - nothing touching the frame counts as fitting.
//
// No player count reaches this. The layout is a fixed stack now, and even
// nine digits leaves ~200px either side; the version with a tile per player
// could be overflowed and this is what caught it. It stays as insurance
// against the next edit to the type or the copy, which is the thing that
// WILL overflow it - checked by rendering the headline at 420px, where it
// reports the clipping and writes nothing.
const fits = await page.evaluate(() => {
  const r = document.querySelector(".stage").getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(675 - r.bottom),
           left: Math.round(r.left), right: Math.round(1200 - r.right) };
});
const MARGIN = 16;
const tight = Object.entries(fits).filter(([, v]) => v < MARGIN);
if (tight.length) {
  console.error(`the card has no room left: ${tight.map(([k, v]) => `${k} ${v}px`).join(", ")}`);
  console.error(`Nothing is written - ${PLAYERS} needs more space than this layout has.`);
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: OUT });
await browser.close();
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote ${path.basename(OUT)} (1200x675, ${kb} KB) - ${PLAYERS.toLocaleString("en-US")} players`);
