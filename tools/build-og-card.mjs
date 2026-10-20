#!/usr/bin/env node
/*
 * The 1200x630 image every shared Lexathon link unfurls into.
 *
 *   node tools/build-og-card.mjs
 *
 * Checked in as a PNG rather than generated at request time, because the
 * scrapers that fetch it (Discord, iMessage, Slack, Twitter, WhatsApp) are
 * one-shot and unforgiving: they fetch once, cache for a long time, and a slow
 * or missing image is simply a link with no card. A static file on Pages is
 * the one thing that cannot fail.
 *
 * It is built from markup rather than drawn by hand so it stays in step with
 * the game's own palette - and the palette is now READ OUT of index.html
 * rather than restated here, because restating it is how this card came to be
 * a cyan-and-magenta picture of a page that had gone to paper. A card that
 * looks like a different product than the page it opens is worse than no
 * card, and the only way it stays true is by not holding its own copy.
 *
 * Why a guess row and not just a logo: most people who see this have played
 * something with coloured letter tiles, and the row says "word game" in less
 * time than any sentence can. The colours then say "not that word game".
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "og-card.png");

// One source for every colour on the card: the stylesheet the page itself uses.
const CSS = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");
const C = (name) => {
  const m = CSS.match(new RegExp("--c-" + name + ":\\s*(#[0-9a-fA-F]{3,8})\\s*;"));
  if (!m) throw new Error("could not read --c-" + name + " out of index.html");
  return m[1];
};

// Content is kept inside a generous margin: every platform crops this
// differently, and iMessage in particular squares it off.
//
// A real answer from the game's own list, mid-guess. It has to be a real word -
// a card selling a word game that spells something invented reads as a mistake,
// and anyone who plays will check.
//
// SCORE is the thing a daily puzzle does not have, which is the pitch; it is
// the site's own word for it, on the Score pill and the Share Score button, on
// the one image whose whole context is somebody sharing a score. And the amber
// tile is the loudest thing on the card, so the letter standing on it should
// fill it: O does, most letters do not.
const WORD = [
  { ch: "S", state: "correct" },
  { ch: "C", state: "absent" },
  { ch: "O", state: "present" },
  { ch: "R", state: "absent" },
  { ch: "E", state: "correct" },
];

/* The row has to be a position the game can actually reach.
 *
 * It was not. This card shipped for months showing RIVAL as blue-grey-amber-
 * grey-blue, a row which claims the answer is R???L, holds a V somewhere other
 * than the middle, and has no I and no A in it. The game knows 25 words shaped
 * R???L. Four of them contain a V, and all four carry it in slot 3 - so that
 * amber V was unreachable, and no word in the answer list, nor in the 10,657
 * extra guesses, could produce the row. A player noticed.
 *
 * Nothing caught it because a colouring is trivial to get wrong by hand and
 * invisible once it is a PNG. So the generator now grades the row against the
 * word list with the game's own rules and refuses to write a card it cannot
 * justify. The letters are the easy part; the colours are the claim.
 */
const WORDS = fs.readFileSync(path.join(REPO, "words.js"), "utf8");
const ANSWERS = WORDS.match(/const rawAnswers = `([\s\S]*?)`/)[1].toUpperCase().trim().split(/\s+/);

// index.html's checkGuess() and functions/index.js's gradeGuess(), to the
// letter: exact matches first, then the rest against what is left over, so a
// repeated letter is only ever paid out once.
const grade = (guess, target) => {
  const g = [...guess], t = [...target];
  const out = ["absent", "absent", "absent", "absent", "absent"];
  for (let i = 0; i < 5; i++) if (g[i] === t[i]) { out[i] = "correct"; t[i] = null; }
  for (let i = 0; i < 5; i++) {
    if (out[i] === "correct") continue;
    const j = t.indexOf(g[i]);
    if (j !== -1) { out[i] = "present"; t[j] = null; }
  }
  return out;
};

const GUESS = WORD.map((w) => w.ch).join("");
const ROW = WORD.map((w) => w.state).join(",");
const SHORT = WORD.map((w) => ({ correct: "blue", present: "amber", absent: "grey" })[w.state]).join("-");
if (!ANSWERS.includes(GUESS)) {
  console.error(`${GUESS} is not one of the game's answers - the card would show a word it never sets`);
  process.exit(1);
}
const FITS = ANSWERS.filter((a) => a !== GUESS && grade(GUESS, a).join(",") === ROW);
if (!FITS.length) {
  console.error(`${GUESS} coloured ${SHORT} is a position the game cannot reach - no answer produces it`);
  process.exit(1);
}

// The wordmark is the page's wordmark: eight tiles, not a word in a typeface.
// It is the most recognisable thing the redesign produced and the one element
// that makes the card and the page read as the same product at thumbnail size.
const MARK = "LEXATHON".split("");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: ${C("page")};
    font-family: 'Liberation Sans', 'Segoe UI', Tahoma, Verdana, sans-serif;
    color: ${C("ink")}; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 40px;
  }
  .mark { display: flex; gap: 10px; }
  .mark div {
    width: 84px; height: 91px; border-radius: 14px;
    background: ${C("raised")}; border: 2px solid ${C("line-2")};
    box-shadow: 0 2px 0 rgba(42,36,32,.06), 0 6px 18px rgba(42,36,32,.10);
    font-size: 49px; font-weight: bold; letter-spacing: 1px;
    display: flex; align-items: center; justify-content: center;
  }
  .row { display: flex; gap: 12px; }
  .tile {
    width: 92px; height: 92px; border: 2px solid ${C("line-2")}; border-radius: 16px;
    font-size: 52px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
  }
  .correct { background: ${C("correct")}; border-color: ${C("correct")}; color: ${C("on-accent")}; }
  .present { background: ${C("present")}; border-color: ${C("present")}; color: ${C("on-accent")}; }
  .absent  { background: ${C("absent")};  border-color: ${C("absent")};  color: ${C("absent-ink")}; }
  .tag { font-size: 32px; color: ${C("ink-3")}; }
  .modes { font-size: 21px; color: ${C("ink-4")}; letter-spacing: 2.2px; text-transform: uppercase; font-weight: bold; }
  .host { font-size: 24px; color: ${C("correct")}; letter-spacing: 1px; font-weight: bold; margin-top: 2px; }
</style></head><body>
  <div class="mark">${MARK.map((ch) => `<div>${ch}</div>`).join("")}</div>
  <div class="row">${WORD.map((w) => `<div class="tile ${w.state}">${w.ch}</div>`).join("")}</div>
  <div class="tag">A competitive five-letter word game</div>
  <div class="modes">Endless &nbsp;·&nbsp; Clash &nbsp;·&nbsp; Gauntlet &nbsp;·&nbsp; Free-For-All</div>
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
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.waitForTimeout(220);
await page.screenshot({ path: OUT });
await browser.close();

/* Stamp every reference with the card's own bytes.
 *
 * Discord caches the IMAGE separately from the page and keys that cache on
 * the URL, so a regenerated card behind an unchanged URL is simply never
 * fetched again — the embed comes back with the new title and description
 * and the old picture. That happened: the paper card went live and shares
 * kept unfurling the cyan one for hours.
 *
 * Doing it here rather than by hand means the version cannot be forgotten,
 * which is the only way a cache-busting scheme ever fails. social-cards
 * checks the stamp against the file either way. */
const version = crypto.createHash("sha1").update(fs.readFileSync(OUT)).digest("hex").slice(0, 8);
const refs = [
  "index.html", "about.html", "faq.html", "how-to-play.html", "strategy.html",
  "404.html", "privacy.html", "terms.html", "tools/gauntlet-archive-render.mjs",
  ...fs.readdirSync(path.join(REPO, "gauntlet"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => `gauntlet/${d.name}/index.html`),
  "gauntlet/index.html",
].filter((f) => fs.existsSync(path.join(REPO, f)));
let stamped = 0;
for (const f of refs) {
  const p = path.join(REPO, f);
  const before = fs.readFileSync(p, "utf8");
  const after = before.replace(/(\/og-card\.png)(\?v=[0-9a-f]+)?/g, `$1?v=${version}`);
  if (after !== before) { fs.writeFileSync(p, after); stamped++; }
}

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote og-card.png (1200x630, ${kb} KB) at ?v=${version}`);
console.log(`  ${GUESS} ${SHORT}: ` + (FITS.length === 1
  ? `reachable, and the only answer that fits it is ${FITS[0]}`
  : `reachable - ${FITS.length} answers fit it (${FITS.slice(0, 6).join(" ")})`));
console.log(stamped ? `  re-stamped ${stamped} file(s)` : "  every reference already current");
// Twitter refuses images over 5 MB and several scrapers give up well before
// that; a flat-colour card of this size lands around 30 KB.
if (kb > 1024) { console.error("card is over 1 MB - scrapers may skip it"); process.exit(1); }
