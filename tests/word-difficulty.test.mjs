/*
 * Word difficulty: the grading that shapes a Trifecta, and the validation that
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
 *                          words a Trifecta considers hard.
 *   effectiveDifficulty  — blends measured against computed, shrinking toward
 *                          the computed score in proportion to sample count so
 *                          a word seen four times cannot swing the grading.
 *   pickDailyWords       — three words drawn uniformly from the whole list,
 *                          Trifecta ramps.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = fn.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const src = [
  grab(/const WORD_STATS_PRIOR = \d+;/),
  grab(/function effectiveDifficulty\(word, stats\) \{\n[\s\S]*?\n\}/),
  grab(/function pickDailyWords\(exclude\) \{\n[\s\S]*?\n\}/),
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

// ===== pickDailyWords — one pool ==========================================
// It used to draw a ramp: one word from each difficulty third, ordered
// easiest first, which is why the archive printed a Tier column. Three words
// is too short for a ramp to read as a curve rather than as "the last one is
// the nasty one", so the draw is uniform over the whole target list.
//
// The hard part to test is a NEGATIVE: that difficulty no longer touches the
// draw. Counting how many words land in each third cannot show it - a
// one-per-third ramp and a uniform draw both average a third each. What
// separates them is the SHAPE of a single day: a ramp always takes exactly
// one word from each third and always comes out in order, and a uniform draw
// does neither reliably.
const targetSetUpper = DAILY_TARGET_SET;
const RUNS = 300;
const thirdSize = Math.floor(targetWords.length / 3);
const ranked = [...targetWords].sort((a, b) => WORD_DIFFICULTY[a.toUpperCase()] - WORD_DIFFICULTY[b.toUpperCase()]);
const rankIndex = new Map(ranked.map((w, i) => [w, i]));
const thirdOf = (w) => { const i = rankIndex.get(w); return i < thirdSize ? 0 : i < thirdSize * 2 ? 1 : 2; };

let allCount = true, allUnique = true, allReal = true;
let oneFromEachThird = 0, ascending = 0;
const perThird = [0, 0, 0];
for (let i = 0; i < RUNS; i++) {
  const picked = pickDailyWords();
  if (picked.length !== DAILY_GAUNTLET_WORD_COUNT) allCount = false;
  if (new Set(picked).size !== picked.length) allUnique = false;
  if (!picked.every((w) => targetSetUpper.has(w.toUpperCase()))) allReal = false;
  const thirds = picked.map(thirdOf);
  for (const t of thirds) perThird[t]++;
  if (new Set(thirds).size === thirds.length) oneFromEachThird++;
  const ds = picked.map((w) => WORD_DIFFICULTY[w.toUpperCase()]);
  if (ds.every((d, j) => j === 0 || d >= ds[j - 1])) ascending++;
}
ck(allCount, `always exactly ${DAILY_GAUNTLET_WORD_COUNT} words`);
ck(allUnique, 'never repeats a word within one puzzle');
ck(allReal, 'only ever picks real target words');
// A ramp scores RUNS on both of these. Uniform expects about 22% and 17%.
ck(oneFromEachThird < RUNS * 0.6, 'a day is not always one word from each difficulty third',
   `${oneFromEachThird}/${RUNS} days had one from each`);
ck(ascending < RUNS * 0.6, 'and is not always ordered easiest to hardest',
   `${ascending}/${RUNS} days came out in order`);
// Both tails are reachable: one pool means the hardest third is no less
// likely than the easiest.
ck(perThird.every((n) => n > RUNS * 0.2), 'every third of the list still turns up', JSON.stringify(perThird));
ck(Math.max(...perThird) - Math.min(...perThird) < RUNS * 0.3,
   'and no third is favoured over another', JSON.stringify(perThird));

// Measured difficulty must now change NOTHING about the draw. This replaces a
// check that it changed the ORDER; the inversion is the point of the change.
const pickSrc = fn.match(/function pickDailyWords\(exclude\) \{[\s\S]*?\n\}/)[0];
ck(!/effectiveDifficulty|WORD_DIFFICULTY|\.sort\(/.test(pickSrc),
   'the draw reads no difficulty of any kind', pickSrc.slice(0, 200));

// The one thing it does still take: the Sprint word, which must not also be
// one of today's three.
{
  const survivors = targetWords.slice(0, 5).map((w) => w.toUpperCase());
  const banAllBut = new Set(targetWords.map((w) => w.toUpperCase()).filter((w) => !survivors.includes(w)));
  let strays = 0;
  for (let i = 0; i < 40; i++) {
    for (const w of pickDailyWords(banAllBut)) if (!survivors.includes(w.toUpperCase())) strays++;
  }
  ck(strays === 0, 'an excluded word never appears in the draw', `${strays} strays`);

  // Uniqueness, proved rather than sampled. Over the real list a repeat is
  // about one draw in 800, so "no repeat in 300 draws" passed roughly two
  // times in three with the de-duplication deleted - a check that is mostly
  // luck is not a check. Narrow the pool to exactly three words and every
  // draw must be those three: picking WITHOUT removal repeats about four
  // draws in five.
  const onlyThree = targetWords.slice(0, 3).map((w) => w.toUpperCase());
  const banRest = new Set(targetWords.map((w) => w.toUpperCase()).filter((w) => !onlyThree.includes(w)));
  let dupes = 0, wrongSize = 0;
  for (let i = 0; i < 60; i++) {
    const p = pickDailyWords(banRest).map((w) => w.toUpperCase());
    if (p.length !== 3) wrongSize++;
    if (new Set(p).size !== p.length) dupes++;
  }
  ck(dupes === 0, 'a word is never drawn twice in one puzzle', `${dupes}/60 draws repeated a word`);
  ck(wrongSize === 0, 'and a pool of exactly three still fills the puzzle', `${wrongSize}/60 came up short`);
  ck(pickDailyWords(new Set()).length === DAILY_GAUNTLET_WORD_COUNT,
     'and an empty exclusion still yields a full puzzle');
  ck(pickDailyWords().length === DAILY_GAUNTLET_WORD_COUNT, 'as does no exclusion at all');
}

// ===== the word library is fed by every single-player mode ================
// wordStats is the measured half of the game: how often each word is met and
// how many guesses it takes. It is folded out of each run's `wordLog`, and
// for a long time only Stakes wrote one - which the CLIENT composes, so the
// two modes with the cleanest evidence in the game (one shared word, nobody
// skipping, nobody racing) contributed nothing at all.
{
  const buildSrc = fn.match(/function buildWordLog\(entries\) \{[\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  const buildWordLog = new Function('DAILY_GAUNTLET_MAX_GUESSES', `${buildSrc}; return buildWordLog;`)(5);

  const got = buildWordLog([{ word: 'arise', guesses: 3, solved: true },
                            { word: 'HOUSE', guesses: 5, solved: false }]);
  ck(JSON.stringify(got) === JSON.stringify([{ w: 'ARISE', g: 3, s: true }, { w: 'HOUSE', g: 5, s: false }]),
     'a played word becomes one sample, upper-cased', JSON.stringify(got));
  // A Trifecta run that was abandoned has history entries with no guesses.
  // Counting them would say the word was met and never solved, which would
  // drag its measured difficulty up for something nobody attempted.
  ck(buildWordLog([{ word: 'ARISE', guesses: 0, solved: false }]).length === 0,
     'a word that was never reached is not a sample');
  ck(buildWordLog([{ word: 'ARISE', guesses: 6, solved: false }]).length === 0,
     'nor is an impossible guess count');
  ck(buildWordLog([{ word: 'NOPE', guesses: 2, solved: true }]).length === 0,
     'nor is something that is not a five-letter word');
  ck(buildWordLog(null).length === 0 && buildWordLog([null, undefined]).length === 0,
     'and nothing at all folds to nothing');

  // What foldRunWordLog does with it, end to end: the shape one half writes
  // has to be the shape the other half reads.
  const words = {};
  foldRunWordLog({ wordLog: buildWordLog([{ word: 'ARISE', guesses: 2, solved: true }]) }, words);
  ck(words.ARISE && words.ARISE.p === 1 && words.ARISE.g === 2 && words.ARISE.f === 0,
     'a solve written by the server is read back as a solve', JSON.stringify(words.ARISE));
  foldRunWordLog({ wordLog: buildWordLog([{ word: 'ARISE', guesses: 5, solved: false }]) }, words);
  ck(words.ARISE.p === 2 && words.ARISE.g === 7 && words.ARISE.f === 1,
     'and a miss is read back as a miss', JSON.stringify(words.ARISE));
}

// Every single-player run the SERVER writes carries one. Derived from the
// source rather than listed, because the failure mode is a mode added later
// that quietly never feeds the library - which is exactly how Sprint and the
// Trifecta spent their first weeks.
{
  const chunks = fn.split('const runRef = db.collection("runs")').slice(1)
    .map((c) => c.slice(0, c.indexOf('\n    }')));
  ck(chunks.length >= 3, 'the server writes runs for several modes', String(chunks.length));
  const seen = [];
  for (const c of chunks) {
    const mode = (c.match(/mode: "(\w+)"/) || [])[1];
    if (!mode) continue;
    seen.push(mode);
    ck(/wordLog: buildWordLog\(/.test(c), `the ${mode} run feeds the word library`,
       c.slice(0, 160).replace(/\n\s*/g, ' '));
  }
  // Stakes is the fourth single-player mode and writes its own from the
  // client, which is why foldRunWordLog re-checks every entry it is given.
  ck(/wordLog: runWordLog/.test(html), 'and Stakes still writes its own from the client');
  ck(['daily', 'sprint', 'marathon'].every((m) => seen.includes(m)),
     'so all four single-player modes are covered', seen.join(','));
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
