#!/usr/bin/env node
/*
 * A square-ish card for a milestone worth posting.
 *
 *   node tools/build-milestone-card.mjs --players=10
 *   node tools/build-milestone-card.mjs --players=10 --date=2026-11-18
 *   node tools/build-milestone-card.mjs --players=25 --out=/tmp/card.png
 *
 * 1200x675, which is 16:9 - the ratio X shows in a timeline without cropping
 * it. The link-unfurl card (build-og-card.mjs) is 1200x630 and is a different
 * job: that one is fetched by scrapers and has to sell the game to somebody
 * who has never heard of it. This one is attached to a post that already
 * says what happened, so it can be loud and short.
 *
 * NOT generated from Firestore. The number is an argument, so the card can be
 * made from anywhere, with no credentials and no network - including from a
 * phone, which is where the post is going to be written. Checking the real
 * count is a separate question from drawing it.
 *
 * Every colour comes out of index.html, for the reason build-og-card.mjs
 * records at length: a card holding its own copy of the palette is how the
 * last one ended up a cyan-and-magenta picture of a page that had gone to
 * paper. The Sprint accent, the wordmark and the Sprint number are read the
 * same way - a card that names Sprint #12 when the game is on #15 is worse
 * than a card with no number at all.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");

const args = process.argv.slice(2);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const unknown = args.filter((a) => !/^--(players=.*|date=.*|out=.*)$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }

const PLAYERS = Number(val("--players"));
if (!Number.isInteger(PLAYERS) || PLAYERS < 2) { console.error("--players=N is required (and a milestone needs at least 2)"); process.exit(1); }

// Eastern, like every other date boundary in this game, so the card agrees
// with the board it is about.
const todayET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const DATE = val("--date") || todayET;
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error("--date must be YYYY-MM-DD"); process.exit(1); }
const OUT = val("--out") || path.join(REPO, `milestone-${PLAYERS}-players-${DATE}.png`);

const C = (name) => {
  const m = SRC.match(new RegExp("--c-" + name + ":\\s*(#[0-9a-fA-F]{3,8})\\s*;"));
  if (!m) throw new Error("could not read --c-" + name + " out of index.html");
  return m[1];
};

// The same epoch the game numbers its Sprints from, read rather than copied.
const EPOCH = (SRC.match(/const SPRINT_EPOCH = "(\d{4}-\d{2}-\d{2})"/) || [])[1];
if (!EPOCH) throw new Error("could not read SPRINT_EPOCH out of index.html");
const toUTC = (x) => { const [y, m, d] = x.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const sprintNo = Math.floor((toUTC(DATE) - toUTC(EPOCH)) / 86400000) + 1;
if (sprintNo < 1) { console.error(`${DATE} is before Sprint #1 (${EPOCH}); there was no Sprint to fill`); process.exit(1); }

const prettyDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
}).format(new Date(toUTC(DATE)));

// The page's own wordmark: eight tiles, not a word in a typeface. It is the
// one element that makes a card and the site read as the same product at
// thumbnail size.
const MARK = "LEXATHON".split("");

// One filled tile per player, in the grid the game greets you with. Blue is
// the game's "right spot" colour, so a row of them reads as a good thing
// without needing to be told. Ten to a row, which is both this milestone and
// the depth of the board it is about - so twenty arrives as two full rows
// rather than as a number you have to count.
const DOTS = Array.from({ length: PLAYERS }, (_, i) => i);
const DOT_ROWS = Math.ceil(PLAYERS / 10);
const DOT = DOT_ROWS <= 1 ? 54 : DOT_ROWS === 2 ? 46 : 38;
const DOT_GAP = DOT_ROWS <= 1 ? 11 : 9;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 675px; background: ${C("page")};
    font-family: 'Liberation Sans', 'Segoe UI', Tahoma, Verdana, sans-serif;
    color: ${C("ink")}; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 34px;
  }
  .mark { display: flex; gap: 7px; }
  .mark div {
    width: 54px; height: 59px; border-radius: 10px;
    background: ${C("raised")}; border: 2px solid ${C("line-2")};
    box-shadow: 0 2px 0 rgba(42,36,32,.06), 0 5px 14px rgba(42,36,32,.10);
    font-size: 32px; font-weight: bold; letter-spacing: 1px;
    display: flex; align-items: center; justify-content: center;
  }
  .dots { display: flex; gap: ${DOT_GAP}px; flex-wrap: wrap; justify-content: center;
    max-width: ${10 * DOT + 9 * DOT_GAP}px; }
  .dots div {
    width: ${DOT}px; height: ${DOT}px; border-radius: ${Math.round(DOT / 4.5)}px;
    background: ${C("correct")}; border: 2px solid ${C("correct")};
  }
  .count { font-size: 150px; font-weight: bold; line-height: 1;
    letter-spacing: -2px; color: ${C("sprint")}; }
  .what { font-size: 44px; font-weight: bold; letter-spacing: .5px; }
  .when { font-size: 23px; color: ${C("ink-4")}; letter-spacing: 2.2px;
    text-transform: uppercase; font-weight: bold; }
  .host { font-size: 26px; color: ${C("correct")}; letter-spacing: 1px;
    font-weight: bold; }
</style></head><body>
  <div class="mark">${MARK.map((ch) => `<div>${ch}</div>`).join("")}</div>
  <div class="dots">${DOTS.map(() => "<div></div>").join("")}</div>
  <div class="count">${PLAYERS}</div>
  <div class="what">players in a single Sprint</div>
  <div class="when">Sprint #${sprintNo} &nbsp;&middot;&nbsp; ${prettyDate}</div>
  <div class="host">lexathon.gg</div>
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

// Nothing may sit outside the frame: X crops what overflows rather than
// scaling it, and a card with a clipped row is a card about a mistake.
const overflow = await page.evaluate(() => ({
  x: document.documentElement.scrollWidth - 1200,
  y: document.documentElement.scrollHeight - 675,
}));
if (overflow.x > 0 || overflow.y > 0) {
  console.error(`the card overflows its frame by ${overflow.x}x${overflow.y}px - ${PLAYERS} tiles is more than this layout holds.`);
  console.error(`Nothing is written. A count this high wants its own card rather than a longer row of dots.`);
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: OUT });
await browser.close();
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote ${path.basename(OUT)} (1200x675, ${kb} KB) - Sprint #${sprintNo}, ${prettyDate}`);
