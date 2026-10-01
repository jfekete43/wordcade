/*
 * The Gauntlet share text.
 *
 * Two things this pins:
 *
 *   - The result line. "8/10" is the whole outcome, because every run plays
 *     all ten words — so the count alone is comparable between two players,
 *     which is the entire point of a shared daily puzzle. It replaced a
 *     three-branch line that had to say where a run ended, back when a run
 *     could end anywhere.
 *   - The run bar: one mark per word, in play order. Now that everyone plays
 *     all ten, position means the same thing to every reader — word 7 is word
 *     7 — which is the property that makes a shared-puzzle grid worth looking
 *     at. It carries one dimension, solved or not, so it needs no legend; the
 *     grid that preceded it coloured by GUESS COUNT, five meanings a reader
 *     cannot infer, which is what got it dropped. It sits on its own line
 *     because sharing a line with the result is what made that grid wrap.
 *
 *     The legacy cases below still pass unchanged, and are kept deliberately:
 *     a player who finished under the old rule and reopens the modal after the
 *     change has a history that stops at their miss, and their share must still
 *     read correctly rather than claiming ten words.
 *   - The link on its own line. navigator.share({text, url}) lets the
 *     receiving app join the two however it likes, which in practice is with a
 *     space, so the URL ran onto the end of the last line. The URL now lives
 *     inside the shared text, and both the native-sheet path and the clipboard
 *     path must produce byte-for-byte the same thing.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };
const src = [
  grab(/        function dailyPlayedWords\(attempt\) \{\n[\s\S]*?\n        \}/),
  grab(/        const GAUNTLET_EPOCH = "[^"]*";/),
  grab(/        function gauntletNumber\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        window\.shareDailyStats = function\(\) \{\n[\s\S]*?\n        \}/),
  grab(/        function shareViaSheetOrClipboard\([^)]*\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const barOf0 = (msg) => msg.split('\n')[1];
const glyphs0 = (bar) => [...bar].filter((c) => c !== '\uFE0F').length;

// --- the message the share builds ----------------------------------------
const buildShare = new Function('attempt', `
  const window = {};
  const document = { getElementById: () => ({}) };
  let captured = null;
  function shareViaSheetOrClipboard(title, message, url, buttonEl, defaultLabel, linkLabel) { captured = { title, message, url, linkLabel }; }
  let dailyAttempt = attempt;
  ${src.replace(/        function shareViaSheetOrClipboard[\s\S]*$/, '')}
  window.shareDailyStats();
  return captured;
`);

const word = (guesses, solved) => ({ guesses: Array(guesses).fill('XXXXX'), solved });
const attempt = (history, score) => ({ date: '2026-09-16', wordCount: 10, score, history });
const solvedRun = (counts) => counts.map((c) => word(c, true));
const untouched = (howMany) => Array(howMany).fill({ guesses: [], solved: false });

// A clean sweep — the run from the screenshot that prompted this.
let out = buildShare(attempt(solvedRun([4, 4, 5, 4, 5, 5, 3, 5, 4, 3]), 540));
ck(out.message === '🕹️ Lexathon Gauntlet #15\n🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩\n🏆 PERFECT · 10/10 · 540 pts · 4.2 avg',
   'a perfect run is ten greens and no cross', JSON.stringify(out.message));
ck(out.message.split('\n').length === 3, 'heading, bar, result', out.message.split('\n').length);
// The per-word GUESS-COUNT grid stays gone — this is not that.
ck(!/[0-9]️⃣/.test(out.message), 'no per-word guess-count digits');

// --- legacy: attempts recorded before everyone played all ten ------------
// Out on word 9 after solving 8. The remaining slot is never touched.
out = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430));
ck(out.message === '🕹️ Lexathon Gauntlet #15\n🟩🟩🟩🟩🟩🟩🟩🟩❌⬜\n💰 8/10 · 430 pts · 4.1 avg',
   'eight solved, a cross on the ninth, one never reached', JSON.stringify(out.message));

// Out on the very first word.
out = buildShare(attempt([word(5, false), ...untouched(9)], 0));
ck(out.message === '🕹️ Lexathon Gauntlet #15\n❌⬜⬜⬜⬜⬜⬜⬜⬜⬜\n💰 0/10 · 0 pts · 5.0 avg',
   'out on word 1 is a cross and nine blanks', JSON.stringify(out.message));

// Nine solved then a miss is still not "perfect".
out = buildShare(attempt([...solvedRun([1, 1, 1, 1, 1, 1, 1, 1, 1]), word(5, false)], 4510));
ck(out.message.includes('💰 9/10') && !out.message.includes('PERFECT'),
   'nine solved and a miss is not PERFECT', JSON.stringify(out.message));

// The average counts a missed word's guesses, and only words reached.
out = buildShare(attempt([...solvedRun([1, 1]), word(5, false), ...untouched(7)], 750));
ck(out.message.includes('2.3 avg'), 'the average counts the missed word and ignores unreached ones', JSON.stringify(out.message));

// Big scores stay readable.
out = buildShare(attempt(solvedRun([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 5000));
ck(out.message.includes('5,000 pts'), 'scores are thousands-separated', JSON.stringify(out.message));

// The link is bare on purpose. A label in front of it was tried and dropped:
// the heading already names the game, and every app that matters unfurls the
// URL into a card that names it again, so the label said it a third time.
ck(out.linkLabel === undefined, 'the daily share adds no label to its link', JSON.stringify(out.linkLabel));
ck(out.url === 'https://lexathon.gg', 'and points at the site root', JSON.stringify(out.url));

// --- play-all-ten: a miss is a mark in place, not the end of the bar ------
// This is the case the old shape could not express at all, and the one the old
// fixtures cannot distinguish: every legacy run's misses are trailing, so a bar
// built as "greens, then one cross, then blanks" and one built per word in play
// order produce byte-identical output for all of them.
const miss = () => word(5, false);
const g = (n) => solvedRun(Array(n).fill(3));

out = buildShare(attempt([...g(2), miss(), ...g(7)], 2350));
ck(barOf0(out.message) === '🟩🟩❌🟩🟩🟩🟩🟩🟩🟩',
   'a miss on word 3 is a cross in position 3, with seven greens after it', JSON.stringify(barOf0(out.message)));
ck(out.message.includes('💰 9/10'), 'and the count is nine of ten', out.message);

out = buildShare(attempt([miss(), ...g(3), miss(), ...g(2), miss(), ...g(2)], 1800));
ck(barOf0(out.message) === '❌🟩🟩🟩❌🟩🟩❌🟩🟩',
   'scattered misses each keep their own slot', JSON.stringify(barOf0(out.message)));
ck(out.message.includes('💰 7/10'), 'seven of ten', out.message);

out = buildShare(attempt([...g(9), miss()], 4510));
ck(barOf0(out.message) === '🟩🟩🟩🟩🟩🟩🟩🟩🟩❌',
   'a miss on the last word is a cross in the last slot, not a blank', JSON.stringify(barOf0(out.message)));

out = buildShare(attempt(Array(10).fill(word(5, false)), 0));
ck(barOf0(out.message) === '❌❌❌❌❌❌❌❌❌❌',
   'missing every word is ten crosses, not one cross and nine blanks', JSON.stringify(barOf0(out.message)));
ck(out.message.includes('💰 0/10 · 0 pts · 5.0 avg'), 'nothing solved, five guesses a word', out.message);
// Ten crosses is the longest the result line's companion can get; it must not
// push the result line over the width that made the old grid wrap.
ck(!/[🟩⬜❌]/u.test(out.message.split('\n')[2]), 'a ten-miss run still keeps blocks off the result line');

// Red on green is the one pairing a colour-blind reader cannot separate, and a
// run can now carry up to ten misses — so the miss mark stays a SHAPE.
ck(!/🟥|🔴/u.test(out.message), 'misses are marked by shape, not by a red square', JSON.stringify(out.message));

// A perfect run is unchanged by any of this.
ck(buildShare(attempt(g(10), 5000)).message.includes('🏆 PERFECT · 10/10'), 'a perfect run still reads PERFECT');

// Every play-all-ten run is exactly ten marks and no blanks.
for (const solved of [0, 1, 4, 7, 9, 10]) {
  const history = [...g(solved), ...Array(10 - solved).fill(word(5, false))];
  const bar = barOf0(buildShare(attempt(history, 100)).message);
  ck(glyphs0(bar) === 10, `${solved} solved: ten marks`, `${glyphs0(bar)} in ${JSON.stringify(bar)}`);
  ck([...bar].filter((c) => c === '🟩').length === solved, `${solved} solved: one green each`, bar);
  ck((bar.match(/❌/g) || []).length === 10 - solved, `${solved} solved: one cross per miss`, bar);
  ck(!bar.includes('⬜'), `${solved} solved: no blanks, because every word was played`, bar);
}

// --- the bar, in its own right -------------------------------------------
const barOf = (msg) => msg.split('\n')[1];
const glyphs = (bar) => [...bar].filter((c) => c !== '\uFE0F').length;

// Ten slots, always, whatever happened — that is what makes two shares
// comparable at a glance.
for (const [solved, label] of [[0, 'none'], [1, 'one'], [5, 'half'], [9, 'nine'], [10, 'all']]) {
  const history = solved === 10
    ? solvedRun(Array(10).fill(3))
    : [...solvedRun(Array(solved).fill(3)), word(5, false), ...untouched(9 - solved)];
  const bar = barOf(buildShare(attempt(history, 100)).message);
  ck(glyphs(bar) === 10, `${label} solved: the bar is ten glyphs`, `${glyphs(bar)} in ${JSON.stringify(bar)}`);
  ck([...bar].filter((c) => c === '🟩').length === solved, `${label} solved: one green per solved word`, bar);
  ck((bar.match(/❌/g) || []).length === (solved === 10 ? 0 : 1),
     `${label} solved: exactly one cross unless perfect`, bar);
}

// A short Gauntlet (an unnumbered test day has wordCount 2) must not emit a
// ten-wide bar — the width comes from the puzzle, not a constant.
const shortBar = barOf(buildShare({ ...attempt(solvedRun([3, 3]), 100), date: '2020-01-01', wordCount: 2 }).message);
ck(glyphs(shortBar) === 2, 'the bar is as long as the puzzle, not always ten', JSON.stringify(shortBar));

// The bar is the only line that may hold emoji blocks; the result line must
// stay as short as it was, since sharing a line is what made the old grid wrap.
const mid = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430)).message;
ck(!/[🟩⬜❌]/u.test(mid.split('\n')[2]), 'the result line carries no blocks', mid.split('\n')[2]);
ck(mid.split('\n')[2].length <= 34, 'the result line stays short', String(mid.split('\n')[2].length));

// A date before the epoch has no number, so the heading drops it rather than
// printing "#null".
out = buildShare({ ...attempt(solvedRun([3, 3]), 100), date: '2020-01-01', wordCount: 2 });
ck(out.message.startsWith('🕹️ Lexathon Gauntlet\n'), 'an unnumbered Gauntlet heading has no "#"', JSON.stringify(out.message));

// --- the link's own line --------------------------------------------------
const shareRun = (native) => new Function('NATIVE', `
  let shared = null, copied = null;
  const navigator = { share: (o) => { shared = o; return Promise.resolve(); } };
  function prefersNativeShare() { return NATIVE; }
  function copyToClipboard(text) { copied = text; return Promise.resolve(true); }
  function flashButtonLabel() {}
  ${grab(/        function shareViaSheetOrClipboard\([^)]*\) \{\n[\s\S]*?\n        \}/)}
  shareViaSheetOrClipboard('T', 'line one\\nline two', 'https://lexathon.gg', {}, 'Share');
  return { shared, copied };
`)(native);

const viaSheet = shareRun(true);
const viaClip = shareRun(false);
ck(viaSheet.shared.text === 'line one\nline two\nhttps://lexathon.gg',
   'the native sheet gets the link on its own line', JSON.stringify(viaSheet.shared.text));
ck(viaSheet.shared.url === undefined,
   'no separate url field, which is what let apps join it onto the last line');
ck(viaClip.copied === 'line one\nline two\nhttps://lexathon.gg',
   'the clipboard gets the link on its own line', JSON.stringify(viaClip.copied));
ck(viaSheet.shared.text === viaClip.copied, 'both paths produce identical text');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
