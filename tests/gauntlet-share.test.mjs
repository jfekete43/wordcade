/*
 * The Gauntlet share text.
 *
 * Two things this pins:
 *
 *   - The result line. "8/10" carries everything the old three-branch line
 *     spelled out, because missing a word ends the run on the spot — solving 8
 *     means you went out on word 9. The old "solved N of 10" branch was
 *     unreachable for exactly that reason; these cases document the invariant
 *     rather than leave it as a comment.
 *   - The run bar. A picture is back in the share, but not the grid that was
 *     here before: that one coloured each word by GUESS COUNT, five meanings
 *     a reader cannot infer. Wordle's grid works because its colours are
 *     feedback the reader already knows from playing the same puzzle. This
 *     carries one dimension — solved, the word that ended you, never reached
 *     — which needs no legend, and sits on its own line because sharing a
 *     line with the result is what made the old grid wrap.
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

// The daily share must actually ASK for the label. Testing the helper with a
// label proves the helper works, not that this caller passes one — dropping
// it from the call site slipped through exactly that gap.
ck(out.linkLabel === "Play today's:", 'the daily share labels its link', JSON.stringify(out.linkLabel));
ck(out.url === 'https://lexathon.gg', 'and points at the site root', JSON.stringify(out.url));

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
  shareViaSheetOrClipboard('T', 'line one\\nline two', 'https://lexathon.gg', {}, 'Share', "Play today's:");
  return { shared, copied };
`)(native);

const viaSheet = shareRun(true);
const viaClip = shareRun(false);
ck(viaSheet.shared.text === "line one\nline two\nPlay today's: https://lexathon.gg",
   'the native sheet gets the labelled link on its own line', JSON.stringify(viaSheet.shared.text));
ck(viaSheet.shared.url === undefined,
   'no separate url field, which is what let apps join it onto the last line');
ck(viaClip.copied === "line one\nline two\nPlay today's: https://lexathon.gg",
   'the clipboard gets the labelled link on its own line', JSON.stringify(viaClip.copied));
// The label is optional — the three invite shares pass no label and must
// still get a bare URL, not the string "undefined".
const noLabel = new Function('', `
  let copied = null;
  function prefersNativeShare() { return false; }
  function copyToClipboard(text) { copied = text; return Promise.resolve(true); }
  function flashButtonLabel() {}
  ${grab(/        function shareViaSheetOrClipboard\([^)]*\) \{\n[\s\S]*?\n        \}/)}
  shareViaSheetOrClipboard('T', 'body', 'https://lexathon.gg/?join=ABCDE', {}, 'Share');
  return copied;
`)();
ck(noLabel === 'body\nhttps://lexathon.gg/?join=ABCDE',
   'a share with no label still gets a bare url', JSON.stringify(noLabel));
ck(viaSheet.shared.text === viaClip.copied, 'both paths produce identical text');

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
