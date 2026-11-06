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
 *   - That there is NO run bar. One mark per word in play order used to sit
 *     between the heading and the result, and on a ten-word puzzle it earned
 *     the line — ten marks carried a shape a count could not. Three words is
 *     not a shape: three squares say exactly what "3/3" says, in a form the
 *     reader has to count first. So the share is two lines, and the checks
 *     below pin that rather than pinning a row of glyphs.
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
ck(out.message === `🕹️ Lexathon Trifecta #${NUMBERED_N}\n🏆 PERFECT · 10/10 · 540 pts · 4.2 avg`,
   'a perfect run is a heading and a line', JSON.stringify(out.message));
ck(out.message.split('\n').length === 2, 'heading, result, nothing between', out.message.split('\n').length);

// --- legacy: attempts recorded before everyone played all ten ------------
// Out on word 9 after solving 8. The remaining slot is never touched.
out = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430));
ck(out.message === `🕹️ Lexathon Trifecta #${NUMBERED_N}\n💰 8/10 · 430 pts · 4.1 avg`,
   'eight of ten solved, one word never reached', JSON.stringify(out.message));

// Out on the very first word.
out = buildShare(attempt([word(5, false), ...untouched(9)], 0));
ck(out.message === `🕹️ Lexathon Trifecta #${NUMBERED_N}\n💰 0/10 · 0 pts · 5.0 avg`,
   'out on word 1 reads as none of ten', JSON.stringify(out.message));

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

// --- the result line carries the whole outcome on its own ----------------
// With no bar above it there is nothing else in the message, so every case
// the bar used to distinguish has to read correctly off this one line.
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
ck(out.message.includes('💰 0/10 · 0 pts · 5.0 avg'), 'nothing solved, five guesses a word', out.message);
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
  eq(`${label}: two lines`, lines.length, 2);
  ck(!/[🟩🟦🟧⬜❌🟥]/u.test(lines[1]), `${label}: no blocks on the result line`, lines[1]);
}

// The ordinary line stays inside the width that made the old grid wrap on a
// phone. PERFECT is deliberately exempt: it is the one run worth the space.
const mid = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430)).message;
ck(mid.split('\n')[1].length <= 34, 'the result line stays short', String(mid.split('\n')[1].length));

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
// Which calls ask for which, read off the call sites themselves: the three
// score shares suppress, the two match invites do not.
{
  const calls = [...html.matchAll(/shareViaSheetOrClipboard\(\s*"([^"]*)"[\s\S]{0,260}?\);/g)]
    .map((m) => [m[1], /preview: false/.test(m[0])]);
  eq('every share call is accounted for', calls.length, 5);
  eq('the three score shares drop the card',
     calls.filter(([, off]) => off).map(([t]) => t).sort(),
     ['Lexathon', 'Lexathon Sprint', 'Lexathon Trifecta']);
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
