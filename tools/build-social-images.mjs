#!/usr/bin/env node
/*
 * The profile art: Discord's server icon, X's avatar, X's header.
 *
 *   node tools/build-social-images.mjs
 *
 * Same argument as build-icons.mjs. These live on somebody else's site, which
 * is exactly why they drift: nothing in this repo renders them, nobody
 * re-exports them when the palette moves, and the first anyone notices is a
 * cyan avatar next to a paper-coloured card. So they are generated, from the
 * stylesheet, like everything else.
 *
 * Three different problems wearing the same brand:
 *
 *   avatar  - masked to a CIRCLE by both platforms and read at 32-48px in a
 *             timeline or a server rail. Corners are not yours, so it paints
 *             full-bleed; detail is not yours either, so it is one letter.
 *   header  - 1500x500, and the avatar is pasted over its bottom-left corner.
 *             Anything put there is covered. X also rounds the corners and
 *             crops the edges on narrow screens, so the content sits well
 *             inside the middle.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "social");
fs.mkdirSync(OUT, { recursive: true });

const CSS = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");
const C = (name) => {
  const m = CSS.match(new RegExp("--c-" + name + ":\\s*(#[0-9a-fA-F]{3,8})\\s*;"));
  if (!m) throw new Error("could not read --c-" + name + " out of index.html");
  return m[1];
};
const FONT = "'Liberation Sans', 'DejaVu Sans', 'Segoe UI', Tahoma, Arial, sans-serif";

/* ---- the avatar -------------------------------------------------------
 *
 * Two readings of the same mark, because which one is better depends on a
 * judgement about size that is easier to make by looking:
 *
 *   solid  the tile IS the avatar. Nothing to lose to the circle mask, and
 *          the most ink on screen at 32px.
 *   inset  the tile sits ON paper, so you can see it is a tile. Prettier
 *          large, weaker small - the ring of paper eats the letter's share.
 */
const avatar = (px, style) => {
  const bleed = style === "solid";
  const pad = bleed ? 0 : px * 0.115;
  const inner = px - pad * 2;
  // 0.60 of the box: a circle mask on a square clips to about 70% at the
  // diagonals, and a cap-height L at 0.60 stays clear of that with room over.
  const letter = (bleed ? 0.60 : 0.58) * inner;
  return `<div class="av" style="width:${px}px;height:${px}px;background:${bleed ? C("correct") : C("page")};padding:${pad}px">
    <div style="width:${inner}px;height:${inner}px;background:${C("correct")};
      border-radius:${bleed ? 0 : Math.round(inner * 0.19)}px;color:${C("on-accent")};
      font:700 ${letter.toFixed(1)}px/1 ${FONT};display:flex;align-items:center;
      justify-content:center;padding-bottom:${(inner * 0.04).toFixed(1)}px">L</div></div>`;
};

/* ---- the header -------------------------------------------------------
 *
 * 1500x500. The avatar covers roughly the bottom-left 360x200 at this scale,
 * so that corner holds nothing. Everything sits in the middle band.
 */
const MARK = "LEXATHON".split("");

/* The board on the banner is a real game, graded here rather than typed.
 *
 * The share card shipped for months showing a row no word could produce, so
 * nothing with coloured tiles on it gets hand-coloured any more. ANSWER and
 * GUESSES are the only things stated; every tile's colour is derived, with
 * index.html's checkGuess() rules, from the two of them.
 *
 * SCORE then SOLVE is not a staged pair: SCORE leaves exactly one answer in
 * the game's whole list, and it is SOLVE. It is also the row on the share
 * card, so the banner finishes the sentence the card starts. */
const ANSWER = "SOLVE";
const GUESSES = ["SCORE", "SOLVE"];

const ANSWERS = fs.readFileSync(path.join(REPO, "words.js"), "utf8")
  .match(/const rawAnswers = `([\s\S]*?)`/)[1].toUpperCase().trim().split(/\s+/);
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
if (!ANSWERS.includes(ANSWER)) {
  console.error(`${ANSWER} is not a word this game ever sets as an answer`);
  process.exit(1);
}
for (const g of GUESSES) if (!ANSWERS.includes(g)) {
  console.error(`${g} is not a word this game ever sets as an answer`);
  process.exit(1);
}
if (GUESSES[GUESSES.length - 1] !== ANSWER) {
  console.error(`the board ends on ${GUESSES[GUESSES.length - 1]} but the answer is ${ANSWER}`);
  process.exit(1);
}
const BOARD = GUESSES.map((g) => [...g].map((ch, i) => [ch, grade(g, ANSWER)[i]]));
const ROW = BOARD[0];

const wordmark = (w, h, fs_, gap, r) => `<div class="mark" style="gap:${gap}px">${MARK.map((ch) =>
  `<div style="width:${w}px;height:${h}px;border-radius:${r}px;background:${C("raised")};
    border:2px solid ${C("line-2")};box-shadow:0 2px 0 rgba(42,36,32,.06),0 6px 18px rgba(42,36,32,.10);
    font:700 ${fs_}px/1 ${FONT};letter-spacing:1px;display:flex;align-items:center;
    justify-content:center">${ch}</div>`).join("")}</div>`;

const guessRow = (s, gap, r, fs_, cells = ROW) => `<div class="mark" style="gap:${gap}px">${cells.map(([ch, st]) => {
  const bg = { correct: C("correct"), present: C("present"), absent: C("absent") }[st];
  const ink = st === "absent" ? C("absent-ink") : C("on-accent");
  return `<div style="width:${s}px;height:${s}px;border-radius:${r}px;background:${bg};border:2px solid ${bg};
    color:${ink};font:700 ${fs_}px/1 ${FONT};display:flex;align-items:center;justify-content:center">${ch}</div>`;
}).join("")}</div>`;

const HEADERS = {
  // Wordmark over the tagline, dead centre. Survives every crop either
  // platform applies, and is the one that still reads at phone width.
  "header-wordmark": `
    ${wordmark(104, 112, 60, 12, 17)}
    <div style="font-size:33px;color:${C("ink-3")};margin-top:30px">A competitive five-letter word game</div>
    <div style="font-size:19px;color:${C("ink-4")};letter-spacing:2.4px;text-transform:uppercase;
      font-weight:bold;margin-top:17px">Stakes &nbsp;&middot;&nbsp; Clash &nbsp;&middot;&nbsp; Daily Puzzle &nbsp;&middot;&nbsp; Free-For-All</div>`,

  // The wordmark with the guess row beside it: says "word game" in colour
  // rather than in words, and uses the 3:1 instead of fighting it.
  "header-row": `
    <div style="display:flex;align-items:center;gap:66px">
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:20px">
        ${wordmark(72, 78, 42, 9, 12)}
        <div style="font-size:25px;color:${C("ink-3")};letter-spacing:.2px">A competitive five-letter word game</div>
      </div>
      <div style="width:2px;height:118px;background:${C("line")}"></div>
      ${guessRow(96, 11, 16, 54)}
    </div>`,

  // The wordmark beside the board: the card's row, and the word it was always
  // going to be, one line under it. The only one of these that shows the game
  // being played rather than a picture of a tile.
  "header-board": `
    <div style="display:flex;align-items:center;gap:60px">
      <div style="display:flex;flex-direction:column;align-items:flex-start;gap:18px">
        ${wordmark(70, 76, 41, 9, 12)}
        <div style="font-size:24px;color:${C("ink-3")}">A competitive five-letter word game</div>
        <div style="font-size:17px;color:${C("ink-4")};letter-spacing:2.3px;text-transform:uppercase;font-weight:bold">
          Stakes &nbsp;&middot;&nbsp; Clash &nbsp;&middot;&nbsp; Daily Puzzle &nbsp;&middot;&nbsp; Free-For-All</div>
      </div>
      <div style="width:2px;height:206px;background:${C("line")}"></div>
      <div style="display:flex;flex-direction:column;gap:11px">
        ${BOARD.map((r) => guessRow(92, 11, 15, 52, r)).join("")}
      </div>
    </div>`,

  // Just the row, big. The least explaining and the most recognisable thing
  // the brand owns; the name is already printed under the header by X.
  "header-tiles": `
    ${guessRow(150, 16, 26, 84)}
    <div style="font-size:26px;color:${C("ink-4")};letter-spacing:2.6px;text-transform:uppercase;
      font-weight:bold;margin-top:36px">lexathon.gg</div>`,
};

const page = (inner, w, h, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${w}px;height:${h}px;background:${C("page")};font-family:${FONT};color:${C("ink")};
    display:flex;flex-direction:column;align-items:center;justify-content:center;${extra}}
  .mark{display:flex}
  .av{display:flex;align-items:center;justify-content:center}
</style></head><body>${inner}</body></html>`;

let chromium;
try { ({ chromium } = await import("playwright")); }
catch {
  const { execSync } = await import("node:child_process");
  ({ chromium } = await import(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright", "index.mjs")));
}
const launch = {};
if (fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(launch);

const shoot = async (file, html, w, h) => {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(OUT, file) });
  await p.close();
  console.log(`  ${file.padEnd(28)} ${w}x${h}  ${Math.round(fs.statSync(path.join(OUT, file)).size / 1024)} KB`);
};

// Discord wants 512 for a server icon; X takes 400 for an avatar and
// downscales everything anyway, so both get rendered at their own size
// rather than one being a resample of the other.
console.log("avatars (both platforms mask these to a circle)");
for (const [file, px, style] of [
  ["avatar-512-solid.png", 512, "solid"],
  ["avatar-400-solid.png", 400, "solid"],
  ["avatar-512-inset.png", 512, "inset"],
  ["avatar-400-inset.png", 400, "inset"],
]) await shoot(file, page(avatar(px, style), px, px), px, px);

console.log("headers (X: 1500x500)");
for (const [name, inner] of Object.entries(HEADERS)) await shoot(`${name}-1500x500.png`, page(inner, 1500, 500), 1500, 500);

await browser.close();
console.log(`\nwrote ${fs.readdirSync(OUT).length} files to social/`);
console.log(`  board is a real game: ${GUESSES.join(" -> ")} against ${ANSWER}`);
