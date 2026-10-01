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
 * the game's own palette - the same #121213, the same cyan #00ffff for a
 * correct letter and magenta #ff00ff for a right-letter-wrong-place, and the
 * same leaning italic wordmark. A card that looked like a different product
 * than the page it opens is worse than no card.
 *
 * Why a guess row and not just a logo: most people who see this have played
 * something with coloured letter tiles, and the row says "word game" in less
 * time than any sentence can. The colours then say "not that word game".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "og-card.png");

// Content is kept inside a generous margin: every platform crops this
// differently, and iMessage in particular squares it off.
// A real answer from the game's own list, mid-guess. It has to be a real word:
// a card selling a word game that spells something invented reads as a mistake,
// and anyone who plays will check. RIVAL also happens to say the thing that
// separates this from a daily puzzle, which is the whole pitch.
const WORD = [
  { ch: "R", state: "correct" },
  { ch: "I", state: "absent" },
  { ch: "V", state: "present" },
  { ch: "A", state: "absent" },
  { ch: "L", state: "correct" },
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: #121213;
    font-family: 'Liberation Sans', 'Segoe UI', Tahoma, Verdana, sans-serif;
    color: #fff; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 34px;
    /* A faint magenta wash off the top-left and cyan off the bottom-right, so
       the card is not a flat rectangle at thumbnail size. */
    background-image:
      radial-gradient(900px 500px at 18% 6%, rgba(255,0,255,0.13), transparent 62%),
      radial-gradient(900px 520px at 86% 96%, rgba(0,255,255,0.11), transparent 62%);
  }
  .title {
    font-size: 108px; font-weight: bold; font-style: italic; letter-spacing: 10px;
    text-shadow: 0 0 8px #ff00ff, 0 0 22px #ff00ff, 0 0 48px rgba(255,0,255,0.55);
    padding-left: 10px; /* optical, against the italic lean */
  }
  .row { display: flex; gap: 14px; }
  .tile {
    width: 92px; height: 92px; border: 3px solid #3a3a3c; border-radius: 6px;
    font-size: 52px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
  }
  .correct { background: #00ffff; border-color: #00ffff; color: #000; box-shadow: 0 0 26px rgba(0,255,255,0.55); }
  .present { background: #ff00ff; border-color: #ff00ff; color: #fff; box-shadow: 0 0 26px rgba(255,0,255,0.55); }
  .absent  { background: #1a1a1d; border-color: #2a2a2c; color: #6a6a6e; }
  .tag { font-size: 32px; color: #c8c8cc; letter-spacing: 0.4px; }
  .modes { font-size: 23px; color: #8a8a90; letter-spacing: 2.4px; text-transform: uppercase; }
  .host { font-size: 26px; color: #00ffff; letter-spacing: 3px; font-weight: bold; margin-top: 6px; }
</style></head><body>
  <div class="title">LEXATHON</div>
  <div class="row">${WORD.map((w) => `<div class="tile ${w.state}">${w.ch}</div>`).join("")}</div>
  <div class="tag">A competitive five-letter word game</div>
  <div class="modes">Standard &nbsp;·&nbsp; Clash &nbsp;·&nbsp; Gauntlet &nbsp;·&nbsp; Free-For-All</div>
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

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote og-card.png (1200x630, ${kb} KB)`);
// Twitter refuses images over 5 MB and several scrapers give up well before
// that; a flat-colour card of this size lands around 30 KB.
if (kb > 1024) { console.error("card is over 1 MB - scrapers may skip it"); process.exit(1); }
