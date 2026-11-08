/*
 * The Trifecta share text.
 *
 * Two things this pins:
 *
 *   - The result line. "8/10" is the whole outcome, because every run plays
 *     all ten words — so the count alone is comparable between two players,
 *     which is the entire point of a shared daily puzzle. It replaced a
 *     three-branch line that had to say where a run ended, back when a run
 *     could end anywhere.
 *   - The guess row: one keycap per word, in play order, saying how many
 *     guesses that word cost. A row of plain SQUARES lived here first and was
 *     dropped — on three words, solved-or-not is "3/3" drawn as a picture.
 *     A numeral carries what the count cannot: 2-1-2 and 5-4-5 are both a
 *     sweep and are not the same run.
 *
 *     The grid that preceded the squares also carried guess counts and died
 *     because it carried them in HUE, five meanings a reader cannot infer.
 *     A digit needs no legend and survives every colour vision deficiency,
 *     which is the constraint behind every other mark in these shares — so
 *     this is emphatically not a re-run of that.
 *
 *     Average guesses came off the result line when this row went on: with
 *     three numbers printed, "2.3 avg" is their mean computed for a reader
 *     who can see the numbers.
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
  grab(/        const TRIFECTA_EPOCH = "[^"]*";/),
  grab(/        function gauntletNumber\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        function guessMark\(count, solved\) \{\n[\s\S]*?\n        \}/),
  grab(/        window\.shareDailyStats = function\(\) \{\n[\s\S]*?\n        \}/),
  grab(/        function shareViaSheetOrClipboard\([^)]*\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// --- the message the share builds ----------------------------------------
const buildShare = new Function('attempt', `
  const window = {};
  const document = { getElementById: () => ({}) };
  let captured = null;
  function shareViaSheetOrClipboard(title, message, url, buttonEl, defaultLabel, opts) { captured = { title, message, url, opts }; }
  let dailyAttempt = attempt;
  ${src.replace(/        function shareViaSheetOrClipboard[\s\S]*$/, '')}
  window.shareDailyStats();
  return captured;
`);

const word = (guesses, solved) => ({ guesses: Array(guesses).fill('XXXXX'), solved });
// A dated day inside the Trifecta era, so the heading carries its number.
// This used to be 2026-09-16, which was Daily Puzzle #15 — and is now a day
// before the Trifecta epoch, so it has no number at all. The unnumbered
// heading has its own case further down; these are about the grid.
// Day 15 of the Trifecta, computed from the epoch rather than written down.
// A literal date here meant moving the epoch by one day turned three grid
// assertions into a failing arithmetic puzzle, which is not what they test.
const NUMBERED_N = 15;
const NUMBERED_DAY = (() => {
  const [y, m, d] = html.match(/const TRIFECTA_EPOCH = "([^"]*)"/)[1].split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + (NUMBERED_N - 1) * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
})();
const attempt = (history, score) => ({ date: NUMBERED_DAY, wordCount: 10, score, history });
const solvedRun = (counts) => counts.map((c) => word(c, true));
const untouched = (howMany) => Array(howMany).fill({ guesses: [], solved: false });

// A clean sweep — the run from the screenshot that prompted this.
let out = buildShare(attempt(solvedRun([4, 4, 5, 4, 5, 5, 3, 5, 4, 3]), 540));
ck(out.message === `🕹️ Lexathon Trifecta #${NUMBERED_N}\n4️⃣4️⃣5️⃣4️⃣5️⃣5️⃣3️⃣5️⃣4️⃣3️⃣\n🏆 PERFECT · 10/10 · 540 pts`,
   'a perfect run is its ten guess counts and a line', JSON.stringify(out.message));
ck(out.message.split('\n').length === 3, 'heading, guess row, result', out.message.split('\n').length);
ck(!/avg/.test(out.message), 'the average is gone, because the row above it prints what it averaged');

// --- legacy: attempts recorded before everyone played all ten ------------
// Out on word 9 after solving 8. The remaining slot is never touched.
out = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430));
ck(out.message === `🕹️ Lexathon Trifecta #${NUMBERED_N}\n3️⃣4️⃣4️⃣5️⃣3️⃣4️⃣5️⃣4️⃣❌⬜\n💰 8/10 · 430 pts`,
   'eight solved, a cross on the ninth, one never reached', JSON.stringify(out.message));

// Out on the very first word.
out = buildShare(attempt([word(5, false), ...untouched(9)], 0));
ck(out.message === `🕹️ Lexathon Trifecta #${NUMBERED_N}\n❌⬜⬜⬜⬜⬜⬜⬜⬜⬜\n💰 0/10 · 0 pts`,
   'out on word 1 is a cross and nine blanks', JSON.stringify(out.message));

// Nine solved then a miss is still not "perfect".
out = buildShare(attempt([...solvedRun([1, 1, 1, 1, 1, 1, 1, 1, 1]), word(5, false)], 4510));
ck(out.message.includes('💰 9/10') && !out.message.includes('PERFECT'),
   'nine solved and a miss is not PERFECT', JSON.stringify(out.message));

// A word never reached is a blank, not a zero and not a cross: nothing was
// spent on it, so there is no number to print.
out = buildShare(attempt([...solvedRun([1, 1]), word(5, false), ...untouched(7)], 750));
ck(out.message.split('\n')[1] === '1️⃣1️⃣❌⬜⬜⬜⬜⬜⬜⬜',
   'two one-guess solves, a miss, and seven never reached', JSON.stringify(out.message.split('\n')[1]));

// Big scores stay readable.
out = buildShare(attempt(solvedRun([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 5000));
ck(out.message.includes('5,000 pts'), 'scores are thousands-separated', JSON.stringify(out.message));

// The link is bare on purpose — no label in front of it. The heading already
// names the game, and the message is the only thing the helper is handed; the
// link is appended by it.
ck(!/lexathon\.gg/i.test(out.message), 'the message carries no link of its own',
   JSON.stringify(out.message.slice(-60)));
// ...and it asks for no preview card, because the result above IS the thing
// being shared and a 300-pixel card of the game's branding buries it.
ck(out.opts && out.opts.preview === false,
   'the Trifecta share suppresses the link preview', JSON.stringify(out.opts));
ck(out.url === 'https://lexathon.gg', 'and points at the site root', JSON.stringify(out.url));

// --- the guess row ------------------------------------------------------
// Split by MARK, not by code point: a keycap is three of them (the digit,
// U+FE0F and U+20E3) and a naive spread counts each row as thirty glyphs.
const rowOf = (msg) => msg.split('\n')[1];
const marks = (row) => row.match(/\d\uFE0F\u20E3|./gu) || [];
const numOf = (m) => { const x = /^(\d)\uFE0F\u20E3$/.exec(m); return x ? Number(x[1]) : m; };
const readRow = (msg) => marks(rowOf(msg)).map(numOf);

// Every guess count the game can produce, read back off the row in order.
// Driven through the real builder rather than asserted as a literal, so the
// mapping from "this word took four guesses" to "4" is the thing under test.
{
  const counts = [1, 2, 3, 4, 5, 1, 5, 2, 4, 3];
  eq('each solved word prints the number of guesses it cost',
     readRow(buildShare(attempt(solvedRun(counts), 2000)).message), counts);
}

// The whole justification for the row existing. Both of these are 10/10 and
// the row of squares that preceded it drew them identically.
{
  const sharp = buildShare(attempt(solvedRun(Array(10).fill(2)), 2500)).message;
  const lucky = buildShare(attempt(solvedRun(Array(10).fill(5)), 100)).message;
  ck(rowOf(sharp) !== rowOf(lucky), 'two sweeps of different quality do not share a row',
     `${rowOf(sharp)} vs ${rowOf(lucky)}`);
  ck(sharp.includes('10/10') && lucky.includes('10/10'), '...even though the count cannot tell them apart');
}

// A miss has no number: it spent every guess and got nothing, and a "5" there
// would read as a word solved on the fifth.
{
  const msg = buildShare({ ...attempt([...solvedRun([2, 2]), word(5, false), ...solvedRun([3])], 900), wordCount: 4 }).message;
  const row = readRow(msg);
  eq('a missed word is a cross in its own slot, not a five', row, [2, 2, '\u274C', 3]);
}

// The keycap sequence itself, since a digit without U+FE0F renders as a bare
// number on some platforms and a digit without U+20E3 is just a digit.
{
  const row = rowOf(buildShare({ ...attempt(solvedRun([3, 1, 4]), 900), wordCount: 3 }).message);
  eq('the row is exactly the keycaps, in order', row, '3\uFE0F\u20E31\uFE0F\u20E34\uFE0F\u20E3');
  ck(!/\d(?!\uFE0F\u20E3)/.test(row), 'no digit escapes without its keycap', JSON.stringify(row));
}

// Width comes from the puzzle, not from a constant: a three-word Trifecta is
// three marks and a legacy ten-word run is ten.
for (const [wordCount, history] of [
  [3, solvedRun([2, 3, 1])],
  [10, solvedRun(Array(10).fill(3))],
  [2, solvedRun([4, 4])],
]) {
  const msg = buildShare({ ...attempt(history, 500), wordCount }).message;
  eq(`a ${wordCount}-word puzzle is ${wordCount} marks`, marks(rowOf(msg)).length, wordCount);
}

// --- the result line ------------------------------------------------------
// The row above it says which words and how dearly; the line says the totals.
const miss = () => word(5, false);
const g = (n) => solvedRun(Array(n).fill(3));

out = buildShare(attempt([...g(2), miss(), ...g(7)], 2350));
ck(out.message.includes('💰 9/10'), 'a word missed in the middle still counts as missed', out.message);
out = buildShare(attempt([miss(), ...g(3), miss(), ...g(2), miss(), ...g(2)], 1800));
ck(out.message.includes('💰 7/10'), 'three scattered misses are seven of ten', out.message);
out = buildShare(attempt([...g(9), miss()], 4510));
ck(out.message.includes('💰 9/10') && !out.message.includes('PERFECT'),
   'a miss on the last word is still a miss', out.message);
out = buildShare(attempt(Array(10).fill(word(5, false)), 0));
ck(out.message.includes('💰 0/10 · 0 pts'), 'nothing solved scores nothing', out.message);
ck(buildShare(attempt(g(10), 5000)).message.includes('🏆 PERFECT · 10/10'), 'and a sweep reads PERFECT');

// Two lines, with no emoji block on either. This is the shape the bar was
// dropped to get: a square creeping back onto the result line would restate
// the count in the worst available place, which is what made the grid before
// the bar wrap in the first place.
for (const [label, history] of [
  ['a sweep', g(10)],
  ['a miss', [...g(9), miss()]],
  ['a wipeout', Array(10).fill(word(5, false))],
  ['a legacy run that stopped early', [...g(8), miss(), ...untouched(1)]],
  ['a short puzzle', solvedRun([3, 3])],
]) {
  const lines = buildShare(attempt(history, 430)).message.split('\n');
  eq(`${label}: three lines`, lines.length, 3);
  ck(!/[🟩🟦🟧⬜❌🟥]|\u20E3/u.test(lines[2]), `${label}: nothing from the row leaks onto the result line`, lines[2]);
}

// The ordinary line stays inside the width that made the old grid wrap on a
// phone. PERFECT is deliberately exempt: it is the one run worth the space.
const mid = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430)).message;
ck(mid.split('\n')[2].length <= 34, 'the result line stays short', String(mid.split('\n')[2].length));

// A date before the epoch has no number, so the heading drops it rather than
// printing "#null".
out = buildShare({ ...attempt(solvedRun([3, 3]), 100), date: '2020-01-01', wordCount: 2 });
ck(out.message.startsWith('🕹️ Lexathon Trifecta\n'), 'an unnumbered Trifecta heading has no "#"', JSON.stringify(out.message));

// --- the link's own line --------------------------------------------------
const shareRun = (native, opts) => new Function('NATIVE', 'OPTS', `
  let shared = null, copied = null;
  const navigator = { share: (o) => { shared = o; return Promise.resolve(); } };
  function prefersNativeShare() { return NATIVE; }
  function copyToClipboard(text) { copied = text; return Promise.resolve(true); }
  function flashButtonLabel() {}
  ${grab(/        function shareViaSheetOrClipboard\([^)]*\) \{\n[\s\S]*?\n        \}/)}
  shareViaSheetOrClipboard('T', 'line one\\nline two', 'https://lexathon.gg', {}, 'Share', OPTS);
  return { shared, copied };
`)(native, opts);

const viaSheet = shareRun(true);
const viaClip = shareRun(false);
ck(viaSheet.shared.text === 'line one\nline two\nhttps://lexathon.gg',
   'the native sheet gets the link on its own line', JSON.stringify(viaSheet.shared.text));
ck(viaSheet.shared.url === undefined,
   'no separate url field, which is what let apps join it onto the last line');
ck(viaClip.copied === 'line one\nline two\nhttps://lexathon.gg',
   'the clipboard gets the link on its own line', JSON.stringify(viaClip.copied));
ck(viaSheet.shared.text === viaClip.copied, 'both paths produce identical text');

// --- the preview, suppressed for a score and kept for an invite ----------
// <https://...> is how Discord and Slack are told "link, do not unfurl". A
// shared SCORE is already a grid and a stats line; a card of the game's own
// branding under it buries the thing being shared. An INVITE is the opposite
// case — there the card is what tells a stranger what they are joining.
{
  const plain = shareRun(false, { preview: false });
  ck(plain.copied === 'line one\nline two\n<https://lexathon.gg>',
     'preview: false brackets the link, which is what stops the unfurl',
     JSON.stringify(plain.copied));
  ck(shareRun(true, { preview: false }).shared.text === plain.copied,
     'and the native sheet produces the same bytes, as it does for every other share');
  // The default is unchanged, so the two invite calls keep their card
  // without having been touched.
  ck(viaClip.copied === shareRun(false, undefined).copied
     && !/[<>]/.test(viaClip.copied),
     'left alone, a share still carries a bare link', JSON.stringify(viaClip.copied));
  ck(shareRun(false, {}).copied === viaClip.copied,
     'and an options object that says nothing about it changes nothing');
}
// Which calls ask for which, read off the call sites themselves: the four
// score shares suppress, the two match invites do not. The count is written
// out on purpose -- a new share added without a thought about the card has to
// come through here and say which side it is on.
{
  const calls = [...html.matchAll(/shareViaSheetOrClipboard\(\s*"([^"]*)"[\s\S]{0,260}?\);/g)]
    .map((m) => [m[1], /preview: false/.test(m[0])]);
  eq('every share call is accounted for', calls.length, 6);
  eq('the four score shares drop the card',
     calls.filter(([, off]) => off).map(([t]) => t).sort(),
     ['Lexathon', 'Lexathon Marathon', 'Lexathon Sprint', 'Lexathon Trifecta']);
  eq('and both match invites keep it',
     calls.filter(([, off]) => !off).map(([t]) => t),
     ['Lexathon \u2014 Join My Match', 'Lexathon \u2014 Join My Match']);
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
