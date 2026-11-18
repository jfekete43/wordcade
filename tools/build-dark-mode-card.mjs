#!/usr/bin/env node
/*
 * The announcement image for dark mode. 1200x675.
 *
 *   node tools/build-dark-mode-card.mjs
 *   node tools/build-dark-mode-card.mjs --out=/tmp/card.png
 *
 * 16:9, which is the ratio X shows in a timeline without cropping it. The
 * link-unfurl card (build-og-card.mjs) is 1200x630 and is a different job:
 * that one is fetched by scrapers and has to sell the game to somebody who
 * has never heard of it. This one is posted deliberately, to people who
 * already play, about one thing that changed.
 *
 * IT SHOWS RATHER THAN TELLS. The card is the game, split down the middle:
 * the same wordmark, the same guess row, the same graded letters, painted
 * once in each theme. Nothing on it argues that dark mode looks good, which
 * is not a claim a sentence can land anyway - the two halves are the claim,
 * and anybody scrolling past gets it before reading a word.
 *
 * BOTH PALETTES COME OUT OF index.html, and this is the one card in the repo
 * that legitimately reads the dark one. build-og-card.mjs records at length
 * why a card holding its own copy of the palette is how the last one ended
 * up a cyan-and-magenta picture of a page that had gone to paper; the same
 * applies twice over here, where a stale value would also make the two
 * halves disagree about which theme they are showing.
 *
 * Built by stacking the whole card twice, once per palette, and clipping the
 * dark layer to the right half. Every element therefore crosses the seam at
 * exactly the same place in both, which is what makes it read as one object
 * in two themes rather than two pictures side by side - and it is why the
 * layers are two renders of ONE function rather than two blocks of markup
 * that have to be kept identical by hand.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");

const args = process.argv.slice(2);
const val = (f) => { const a = args.find((x) => x.startsWith(f + "=")); return a ? a.slice(f.length + 1) : null; };
const unknown = args.filter((a) => !/^--out=.*$/.test(a));
if (unknown.length) { console.error("unknown argument(s): " + unknown.join(" ")); process.exit(1); }
// Into social/ with the avatars and headers: it is a file somebody posts
// by hand, not one a scraper fetches, so it belongs where the rest of the
// hand-posted assets already live.
const OUT = val("--out") || path.join(REPO, "social", "dark-mode-1200x675.png");

// Each palette sliced out whole, so a token can only ever be read from the
// block it belongs to. Matching on the name alone would find whichever
// happens to come first in the file.
const palette = (selector) => {
  const at = SRC.indexOf(selector + " {");
  if (at < 0) throw new Error(`no ${selector} block in index.html`);
  const body = SRC.slice(at, SRC.indexOf("}", at));
  const out = {};
  for (const m of body.matchAll(/--c-([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  for (const need of ["page", "panel", "raised", "line", "line-2", "ink", "ink-3", "ink-4",
                      "correct", "present", "absent", "absent-ink", "on-accent", "sprint"]) {
    if (!out[need]) throw new Error(`${selector} is missing --c-${need}`);
  }
  return out;
};
const LIGHT = palette(":root");
const DARK = palette(":root.dark");

/*
 * THE ROW IS DERIVED, NOT TYPED OUT.
 *
 * It used to be a hand-written list of letters and verdicts with a comment
 * saying what it was a grading of. The comment was wrong - it named an
 * answer that would have marked a second letter correct - and the card was
 * showing a pattern no board could ever produce, under a note claiming it
 * was "the only part of the card that has to be true". Deriving it is the
 * only way that comment can stay honest.
 *
 * SHADE against SAUCE: S in place, H not in the word, A in the word but not
 * there, D not in the word, E in place. The word is also the point - a card
 * announcing dark mode should have a word on it that a person reads as a
 * word, which the obscure five-letter filler it replaced did not.
 */
const GUESS = "SHADE";
const ANSWER = "SAUCE";

const WORDS = fs.readFileSync(path.join(REPO, "words.js"), "utf8");
const wordList = (name) => {
  const m = WORDS.match(new RegExp("const " + name + " = `([^`]*)`"));
  if (!m) throw new Error(`could not read ${name} out of words.js`);
  return new Set(m[1].toUpperCase().trim().split(/\s+/));
};
const ANSWERS = wordList("rawAnswers");
const VALID = new Set([...ANSWERS, ...wordList("rawGuesses")]);
if (!VALID.has(GUESS)) throw new Error(`${GUESS} is not a word the game would accept`);
if (!ANSWERS.has(ANSWER)) throw new Error(`${ANSWER} is never an answer, so nothing could be graded against it`);

// The game's rule: exact matches are claimed first, then the letters left
// over are consumed left to right - so a repeated letter cannot be marked
// present more times than the answer actually contains it. Doing the two
// passes in one would mark the first of a pair present even when the second
// is the one in place.
const gradeGuess = (guess, answer) => {
  const out = Array(5).fill("absent");
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = "correct";
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === "correct") continue;
    if (left[guess[i]] > 0) { out[i] = "present"; left[guess[i]]--; }
  }
  return out;
};
// Asked something with a repeated letter before it is trusted with the real
// pair, because the word on this card has none - so the two-pass rule above
// is the one line here that the card itself cannot prove. SASSY against
// BASIS: the A and the middle S are in place, the FIRST S takes the only
// spare S in the answer, and the second one has nothing left to claim.
// Collapsing the passes into a single `answer.includes()` marks that fourth
// letter present and nothing else here would notice.
{
  const probe = gradeGuess("SASSY", "BASIS").join(" ");
  const want = "present correct correct absent absent";
  if (probe !== want) throw new Error(`the grader is wrong before it starts: got "${probe}", wanted "${want}"`);
}
const VERDICTS = gradeGuess(GUESS, ANSWER);
const ROW = [...GUESS].map((ch, i) => [ch, VERDICTS[i]]);
// All three verdicts, or the card is not showing the palette it is about.
for (const v of ["correct", "present", "absent"]) {
  if (!VERDICTS.includes(v)) throw new Error(`${GUESS} vs ${ANSWER} never shows a "${v}" tile`);
}
const MARK = "LEXATHON".split("");

const layer = (p) => {
  // Every tile is graded, so none of them is an outline. An unfilled tile on
  // a five-letter word reads as a four-letter word with a box after it.
  const tile = (ch, state) => {
    const base = `width:116px;height:116px;border-radius:13px;display:flex;align-items:center;`
      + `justify-content:center;font-size:60px;font-weight:bold;letter-spacing:.5px;`;
    const fill = state === "absent" ? p.absent : p[state];
    const ink = state === "absent" ? p["absent-ink"] : p["on-accent"];
      return `<div style="${base}background:${fill};border:3px solid ${fill};color:${ink}" data-v="${state}">${ch}</div>`;
  };
  return `
  <div style="position:absolute;inset:0;background:${p.page};color:${p.ink};
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
    <div style="display:flex;gap:9px">
      ${MARK.map((c) => `<div style="width:60px;height:66px;border-radius:11px;background:${p.raised};
         border:2px solid ${p["line-2"]};font-size:36px;font-weight:bold;letter-spacing:1px;
         display:flex;align-items:center;justify-content:center;color:${p.ink}">${c}</div>`).join("")}
    </div>
    <div style="display:flex;gap:12px">${ROW.map(([c, s]) => tile(c, s)).join("")}</div>
    <div style="text-align:center">
      <div style="font-size:92px;font-weight:bold;letter-spacing:-2px;line-height:1">Dark Mode</div>
      <div style="font-size:27px;color:${p["ink-3"]};margin-top:16px;letter-spacing:.2px">
        Settings &rarr; Appearance &middot; Light, Dark, or follow your phone</div>
      <div style="font-size:23px;color:${p.sprint};margin-top:22px;font-weight:bold;letter-spacing:1px">lexathon.gg</div>
    </div>
  </div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; position:relative; overflow:hidden;
         font-family:'Liberation Sans','Segoe UI',Tahoma,Verdana,sans-serif; }
  /* Both layers are explicitly the whole card. They have to be: clip-path's
     pixel values are measured against the element's OWN border box, and a
     wrapper that is 1200x0 - which a div holding nothing but an absolutely
     positioned child is - clips the entire layer away. That rendered a card
     with no dark half at all, and the DOM-alignment check below passed on
     it, because two layers agree perfectly when one of them is invisible. */
  #light, #dark { position:absolute; inset:0; }
  /* The dark layer sits exactly on top of the light one and is cut away to
     the left of the seam. Same markup underneath, so nothing can drift. */
  #dark { clip-path: inset(0 0 0 600px); }
  /* A hairline the eye reads as a fold rather than as a gap between two
     images. Half on each side, so neither theme owns it. */
  #seam { position:absolute; top:0; bottom:0; left:599px; width:2px;
          background:rgba(128,128,128,.35); }
</style></head><body>
  <div id="light">${layer(LIGHT)}</div>
  <div id="dark">${layer(DARK)}</div>
  <div id="seam"></div>
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

// The two layers must line up to the pixel, or the seam stops being a fold
// and becomes a mistake. Measured rather than trusted: they are built by the
// same function, but only against the rendered boxes is that actually true.
const aligned = await page.evaluate(() => {
  const boxes = (root) => [...root.querySelectorAll("div")]
    .map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`; });
  const a = boxes(document.getElementById("light"));
  const b = boxes(document.getElementById("dark"));
  return { same: a.length === b.length && a.every((v, i) => v === b[i]), n: a.length };
});
if (!aligned.same) {
  console.error("the two halves do not line up; nothing written");
  await browser.close();
  process.exit(1);
}

// THE PIXELS, not the DOM. The check above compares two layers to each
// other and is happy when neither is visible; this asks the rendered card
// whether it actually has two themes on it, by sampling the page colour well
// inside each half and holding both to what the stylesheet says they are.
const halves = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 675;
  // Nothing to draw from in a headless page without an image, so read the
  // computed background of the element that is actually on top at a point.
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y);
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const p = (c.match(/[\d.]+/g) || []).map(Number);
      if (p.length >= 3 && (p.length < 4 || p[3] > 0.99)) {
        return "#" + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      }
    }
    return null;
  };
  return { left: at(60, 60), right: at(1140, 60) };
});
// Asked FIRST, because the comparison below checks the render against the
// values it was rendered from and is therefore happy when both palettes are
// the same one - point the dark reader at :root and every other check here
// still passes on a card with no dark half. This is the claim that matters:
// there are two themes on it.
if (halves.left === halves.right) {
  console.error(`both halves of the card are ${halves.left}; it is not showing two themes`);
  await browser.close();
  process.exit(1);
}
if (halves.left !== LIGHT.page || halves.right !== DARK.page) {
  console.error(`the two halves are not the two themes:`);
  console.error(`  left  ${halves.left} (wanted ${LIGHT.page})`);
  console.error(`  right ${halves.right} (wanted ${DARK.page})`);
  await browser.close();
  process.exit(1);
}

// BOTH HALVES SHOW A CORRECT TILE. This is the whole reason the row is this
// row: the seam cuts through the middle tile, so without a right-spot tile on
// each side of it the dark half never shows its own blue and the card
// demonstrates half a palette. Measured off the rendered tiles rather than
// worked out from the letter positions, because the thing that would break it
// is a change to the tile size or the gap.
const blues = await page.evaluate(() => {
  const side = (layer) => [...document.querySelectorAll(`#${layer} [data-v]`)]
    .filter((el) => el.dataset.v === "correct")
    .map((el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
  return { light: side("light").filter((x) => x < 600).length,
           dark: side("dark").filter((x) => x > 600).length };
});
if (!blues.light || !blues.dark) {
  console.error(`each half needs a right-spot tile of its own; light has ${blues.light}, dark has ${blues.dark}`);
  await browser.close();
  process.exit(1);
}

// And nothing may run off the edge. The headline is the thing that will, the
// next time the copy changes.
const fits = await page.evaluate(() => {
  const r = document.querySelector("#light > div > div:last-child").getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(1200 - r.right), bottom: Math.round(675 - r.bottom) };
});
const tight = Object.entries(fits).filter(([, v]) => v < 16);
if (tight.length) {
  console.error(`the card has no room left: ${tight.map(([k, v]) => `${k} ${v}px`).join(", ")}`);
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: OUT });
await browser.close();
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`wrote ${path.basename(OUT)} (1200x675, ${kb} KB)`);
console.log(`  ${GUESS} vs ${ANSWER} -> ${VERDICTS.join(" ")}`);
console.log(`  ${aligned.n} boxes aligned on both sides; left half ${halves.left}, right half ${halves.right}`);
