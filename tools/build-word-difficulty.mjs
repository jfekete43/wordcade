/*
 * Builds functions/word-difficulty.json — a 0 (easiest) to 1 (hardest) score
 * for every target word, derived from the word list itself.
 *
 * Run with:  node tools/build-word-difficulty.mjs
 *
 * Why computed rather than measured: a Gauntlet has to be graded from day one,
 * and measuring 2,315 words to a useful confidence takes months of play. The
 * measured numbers (aggregateWordStats) are blended in on top of this as they
 * arrive — see effectiveDifficulty in functions/index.js — so this stays the
 * floor the grading falls back to for any word with thin data.
 *
 * Features, in order of weight:
 *   1. Near neighbours — other target words differing in exactly one position.
 *      This is the "four letters green and still six candidates" trap, and it
 *      is the single best predictor of a word eating guesses. SHARE has 15.
 *   2. Letter rarity — an uncommon letter is one people do not probe for early.
 *   3. Repeated letters — 32% of the list has one, and they break the usual
 *      elimination strategy.
 *   4. Vowel count — one vowel, or four, is off the beaten path.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(REPO('words.js'), 'utf8'));
const T = global.window.targetWords.map((w) => w.toUpperCase());
const set = new Set(T);
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const neighbours = new Map();
for (const w of T) {
  let c = 0;
  for (let i = 0; i < 5; i++) {
    for (const ch of ALPHA) {
      if (ch === w[i]) continue;
      if (set.has(w.slice(0, i) + ch + w.slice(i + 1))) c++;
    }
  }
  neighbours.set(w, c);
}

const freq = {};
for (const w of T) for (const ch of new Set(w)) freq[ch] = (freq[ch] || 0) + 1;
const rarity = (w) => [...new Set(w)].reduce((s, ch) => s - Math.log((freq[ch] || 1) / T.length), 0);
const repeats = (w) => 5 - new Set(w).size;
const vowelOdd = (w) => {
  const v = [...w].filter((c) => 'AEIOU'.includes(c)).length;
  return v <= 1 || v >= 4 ? 1 : v === 3 ? 0.35 : 0;
};

const norm = (vals) => { const lo = Math.min(...vals), hi = Math.max(...vals); return (v) => (v - lo) / (hi - lo || 1); };
const nNb = norm(T.map((w) => neighbours.get(w)));
const nRa = norm(T.map(rarity));
const nRe = norm(T.map(repeats));
const score = (w) => 0.50 * nNb(neighbours.get(w)) + 0.20 * nRa(rarity(w)) + 0.20 * nRe(repeats(w)) + 0.10 * vowelOdd(w);

const out = {};
for (const w of T) out[w] = Math.round(score(w) * 1000) / 1000;
fs.writeFileSync(REPO('functions/word-difficulty.json'), JSON.stringify(out));

const sorted = T.map((w) => [w, out[w]]).sort((a, b) => a[1] - b[1]);
console.log(`wrote ${T.length} scores to functions/word-difficulty.json`);
console.log('easiest:', sorted.slice(0, 6).map(([w, s]) => `${w} ${s}`).join('  '));
console.log('hardest:', sorted.slice(-6).map(([w, s]) => `${w} ${s}`).join('  '));
