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
  grab(/        function shareViaSheetOrClipboard\(title, message, url, buttonEl, defaultLabel\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// --- the message the share builds ----------------------------------------
const buildShare = new Function('attempt', `
  const window = {};
  const document = { getElementById: () => ({}) };
  let captured = null;
  function shareViaSheetOrClipboard(title, message, url) { captured = { title, message, url }; }
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
ck(out.message === '🕹️ Lexathon Gauntlet #15\n🏆 PERFECT · 10/10 · 540 pts · 4.2 avg',
   'a perfect run reads PERFECT · 10/10 · pts · avg', JSON.stringify(out.message));
ck(!/[0-9]️⃣|❌/.test(out.message), 'the per-word emoji grid is gone');
ck(out.message.split('\n').length === 2, 'the body is two lines, not three', out.message.split('\n').length);

// Out on word 9 after solving 8. The remaining slot is never touched.
out = buildShare(attempt([...solvedRun([3, 4, 4, 5, 3, 4, 5, 4]), word(5, false), ...untouched(1)], 430));
ck(out.message === '🕹️ Lexathon Gauntlet #15\n💰 8/10 · 430 pts · 4.1 avg',
   'going out on word 9 reads 8/10', JSON.stringify(out.message));

// Out on the very first word.
out = buildShare(attempt([word(5, false), ...untouched(9)], 0));
ck(out.message === '🕹️ Lexathon Gauntlet #15\n💰 0/10 · 0 pts · 5.0 avg',
   'going out on word 1 reads 0/10', JSON.stringify(out.message));

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
  ${grab(/        function shareViaSheetOrClipboard\(title, message, url, buttonEl, defaultLabel\) \{\n[\s\S]*?\n        \}/)}
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
