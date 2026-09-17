/*
 * Word difficulty: the grading that shapes a Gauntlet, and the validation that
 * decides what a client is allowed to teach the game about its own word list.
 *
 * Three pieces, all extracted from functions/index.js:
 *
 *   foldRunWordLog       — the security-critical half. The samples ride along
 *                          on a /runs document, which is client-written, and
 *                          firestore.rules can only bound the array's size (a
 *                          list of maps cannot be inspected element by element
 *                          there). So every entry is re-checked here against
 *                          the real target list, and a word repeated inside
 *                          one run counts once. Poisoning this would not move
 *                          points or money, but it would quietly skew which
 *                          words a Gauntlet considers hard.
 *   effectiveDifficulty  — blends measured against computed, shrinking toward
 *                          the computed score in proportion to sample count so
 *                          a word seen four times cannot swing the grading.
 *   pickDailyWords       — three easy, four medium, three hard, ordered so the
 *                          Gauntlet ramps.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = fn.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const src = [
  grab(/const WORD_STATS_PRIOR = \d+;/),
  grab(/function effectiveDifficulty\(word, stats\) \{\n[\s\S]*?\n\}/),
  grab(/function pickDailyWords\(stats\) \{\n[\s\S]*?\n\}/),
  grab(/function foldRunWordLog\(run, words\) \{\n[\s\S]*?\n\}/),
].join('\n\n');
console.log('extracted from functions/index.js:', src.length, 'chars');

const WORD_DIFFICULTY = JSON.parse(fs.readFileSync(REPO('functions/word-difficulty.json'), 'utf8'));
const { targetWords } = JSON.parse(fs.readFileSync(REPO('functions/words.json'), 'utf8'));
const DAILY_TARGET_WORDS = targetWords;
const DAILY_TARGET_SET = new Set(targetWords.map((w) => w.toUpperCase()));
const DAILY_GAUNTLET_WORD_COUNT = Number(fn.match(/const DAILY_GAUNTLET_WORD_COUNT = (\d+);/)[1]);

const api = new Function('WORD_DIFFICULTY', 'DAILY_TARGET_WORDS', 'DAILY_TARGET_SET', 'DAILY_GAUNTLET_WORD_COUNT',
  `${src}\nreturn { effectiveDifficulty, pickDailyWords, foldRunWordLog, WORD_STATS_PRIOR };`
)(WORD_DIFFICULTY, DAILY_TARGET_WORDS, DAILY_TARGET_SET, DAILY_GAUNTLET_WORD_COUNT);
const { effectiveDifficulty, pickDailyWords, foldRunWordLog, WORD_STATS_PRIOR } = api;

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// ===== the difficulty table itself ========================================
ck(Object.keys(WORD_DIFFICULTY).length === targetWords.length,
   'every target word has a difficulty score', `${Object.keys(WORD_DIFFICULTY).length} vs ${targetWords.length}`);
ck(Object.values(WORD_DIFFICULTY).every((v) => typeof v === 'number' && v >= 0 && v <= 1),
   'every score is a number in 0..1');
ck(targetWords.every((w) => w.toUpperCase() in WORD_DIFFICULTY),
   'the table is keyed the way the lookup reads it (uppercase)');
// A sanity check on the model rather than the plumbing: the known trap words
// must land harder than the clean ones, or the grading means nothing.
const harder = (a, b) => WORD_DIFFICULTY[a] > WORD_DIFFICULTY[b];
ck(harder('SHARE', 'ZEBRA'), 'SHARE (15 near-neighbours) outranks ZEBRA (0)');
ck(harder('STACK', 'EARTH'), 'STACK outranks EARTH');
ck(harder('PATTY', 'SIREN'), 'PATTY (repeat + trap family) outranks SIREN');

// ===== foldRunWordLog — the untrusted input ===============================
const fold = (wordLog) => { const words = {}; const r = foldRunWordLog({ wordLog }, words); return { words, ...r }; };
const REAL = targetWords[0].toUpperCase(), REAL2 = targetWords[1].toUpperCase();

let f = fold([{ w: REAL, g: 3, s: true }]);
ck(f.counted === 1 && f.words[REAL].p === 1 && f.words[REAL].g === 3 && f.words[REAL].f === 0,
   'a valid solve is counted', JSON.stringify(f.words));
f = fold([{ w: REAL, g: 5, s: false }]);
ck(f.words[REAL].f === 1 && f.words[REAL].g === 5, 'a miss counts its full board and a fail', JSON.stringify(f.words));
f = fold([{ w: REAL.toLowerCase(), g: 2, s: true }]);
ck(f.counted === 1 && f.words[REAL].p === 1, 'a lowercase word is normalised, not rejected');

// Rejections.
for (const [label, entry] of [
  ['a word that is not a target', { w: 'ZZZZZ', g: 3, s: true }],
  ['a valid-guess word that is never an answer', { w: 'AAHED', g: 3, s: true }],
  ['zero guesses', { w: REAL, g: 0, s: true }],
  ['more guesses than a board has', { w: REAL, g: 6, s: true }],
  ['a fractional guess count', { w: REAL, g: 2.5, s: true }],
  ['a missing guess count', { w: REAL, s: true }],
  ['a non-string word', { w: 12345, g: 3, s: true }],
  ['a null entry', null],
]) {
  const r = fold([entry]);
  ck(r.counted === 0 && r.rejected === 1 && Object.keys(r.words).length === 0, `rejects ${label}`, JSON.stringify(r.words));
}

f = fold([{ w: REAL, g: 1, s: true }, { w: REAL, g: 1, s: true }, { w: REAL, g: 1, s: true }]);
ck(f.counted === 1 && f.rejected === 2 && f.words[REAL].p === 1,
   'a word repeated within one run counts once — the stuffing defence', JSON.stringify(f.words));
f = fold([{ w: REAL, g: 1, s: true }, { w: REAL2, g: 4, s: true }]);
ck(f.counted === 2 && f.words[REAL].p === 1 && f.words[REAL2].p === 1, 'different words in one run both count');
f = fold([{ w: 'ZZZZZ', g: 9 }, { w: REAL, g: 2, s: true }]);
ck(f.counted === 1 && f.rejected === 1, 'one bad entry does not discard the good ones in the same run');

ck(foldRunWordLog({}, {}).counted === 0, 'a run with no wordLog is skipped (old clients)');
ck(foldRunWordLog({ wordLog: 'not-an-array' }, {}).counted === 0, 'a non-array wordLog is skipped');
ck(foldRunWordLog(null, {}).counted === 0, 'a null run is skipped');

// Totals accumulate across runs into the same map.
const acc = {};
foldRunWordLog({ wordLog: [{ w: REAL, g: 2, s: true }] }, acc);
foldRunWordLog({ wordLog: [{ w: REAL, g: 4, s: true }] }, acc);
ck(acc[REAL].p === 2 && acc[REAL].g === 6, 'samples accumulate across runs', JSON.stringify(acc[REAL]));

// ===== effectiveDifficulty — shrinkage ====================================
const prior = WORD_DIFFICULTY[REAL];
ck(effectiveDifficulty(REAL, null) === prior, 'with no data, the computed score stands');
ck(effectiveDifficulty(REAL, {}) === prior, 'with an empty table, the computed score stands');
ck(effectiveDifficulty('NOTAWORD', null) === 0.5, 'an unknown word falls back to the middle');
// Measured 5.0 average is the hardest possible; measured 1.0 the easiest.
const hardStats = (n) => ({ [REAL]: { p: n, g: 5 * n, f: n } });
const easyStats = (n) => ({ [REAL]: { p: n, g: 1 * n, f: 0 } });
const few = effectiveDifficulty(REAL, hardStats(2));
const many = effectiveDifficulty(REAL, hardStats(2000));
ck(few > prior && few < prior + 0.1, 'two samples barely move it off the prior', few.toFixed(3));
ck(many > 0.95, 'plenty of samples let the measurement take over', many.toFixed(3));
ck(effectiveDifficulty(REAL, hardStats(WORD_STATS_PRIOR)) > few, 'more samples means more weight');
ck(effectiveDifficulty(REAL, easyStats(2000)) < 0.05, 'measured-easy pulls all the way down too');
ck(effectiveDifficulty(REAL, { [REAL]: { p: 0, g: 0, f: 0 } }) === prior, 'a zero-play entry is ignored');
ck(Number.isFinite(effectiveDifficulty(REAL, { [REAL]: { p: 'x', g: 'y' } })), 'corrupt stats do not produce NaN');

// ===== pickDailyWords — the ramp ==========================================
const targetSetUpper = DAILY_TARGET_SET;
let allOrdered = true, allUnique = true, allReal = true, allTen = true, spread = 0;
const RUNS = 200;
for (let i = 0; i < RUNS; i++) {
  const picked = pickDailyWords(null);
  if (picked.length !== DAILY_GAUNTLET_WORD_COUNT) allTen = false;
  if (new Set(picked).size !== picked.length) allUnique = false;
  if (!picked.every((w) => targetSetUpper.has(w.toUpperCase()))) allReal = false;
  const ds = picked.map((w) => WORD_DIFFICULTY[w.toUpperCase()]);
  if (!ds.every((d, j) => j === 0 || d >= ds[j - 1])) allOrdered = false;
  spread += ds[ds.length - 1] - ds[0];
}
ck(allTen, `always exactly ${DAILY_GAUNTLET_WORD_COUNT} words`);
ck(allUnique, 'never repeats a word within one puzzle');
ck(allReal, 'only ever picks real target words');
ck(allOrdered, 'always ordered easiest to hardest');
ck(spread / RUNS > 0.15, 'the ramp is real, not ten words of the same difficulty', `mean spread ${(spread / RUNS).toFixed(3)}`);

// Measured data must actually change the selection, not just be accepted.
const skew = {};
for (const w of targetWords.slice(0, 400)) skew[w.toUpperCase()] = { p: 500, g: 500, f: 0 }; // measured perfectly easy
const withStats = pickDailyWords(skew);
ck(withStats.length === DAILY_GAUNTLET_WORD_COUNT, 'measured data still yields a full puzzle');
const dsWith = withStats.map((w) => effectiveDifficulty(w.toUpperCase(), skew));
ck(dsWith.every((d, j) => j === 0 || d >= dsWith[j - 1]), 'ordered by the blended score, not the raw one');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
