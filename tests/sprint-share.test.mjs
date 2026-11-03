/*
 * The Sprint share text.
 *
 * Sharing is not a nice-to-have in a one-word-a-day mode; it is the whole
 * distribution mechanism, which is why this is pinned as tightly as the
 * Daily Puzzle's.
 *
 * Four things it holds:
 *
 *   - THE NUMBER. "3/5" means nothing unless the reader knows it is today's
 *     word. The heading carries #N, counted from Sprint's own epoch, which is
 *     what makes two of these comparable at all.
 *   - THE GRID, in Lexathon's blue and amber rather than Wordle's green and
 *     yellow. Not a style preference: it is the pairing the board already
 *     uses because it survives the common colour vision deficiencies, so the
 *     squares stay readable for the same people the board does — and a result
 *     pasted into a channel reads as this game's rather than that one's.
 *   - THE CLOCK. It is the mode's entire twist. A share without it is a
 *     Wordle share.
 *   - ONE ROUTE OUT. Everything goes through shareViaSheetOrClipboard, which
 *     is what keeps desktop on the clipboard (the native sheet there opens an
 *     OS contacts panel and drops the score text), reports a failed copy
 *     honestly, and makes both paths produce byte-identical output. The first
 *     version of this called navigator.share directly and had none of that.
 *
 * Pure; no emulator or browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

const src = [
  grab(/        const SPRINT_MAX_GUESSES = \d+;/),
  grab(/        const SPRINT_EPOCH = "[^"]*";/),
  grab(/        function sprintNumber\(dateStr\) \{\n[\s\S]*?\n        \}/),
  grab(/        function formatSprintTime\(ms\) \{\n[\s\S]*?\n        \}/),
  grab(/        window\.shareSprintResult = function\(btnId\) \{\n[\s\S]*?\n        \}/),
].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// The real function, run against a stubbed share helper that captures rather
// than shares.
const buildShare = new Function('attempt', 'btnId', `
  let captured = null;
  function shareViaSheetOrClipboard(title, message, url, buttonEl, defaultLabel) {
    captured = { title, message, url, defaultLabel, buttonEl };
  }
  const document = { getElementById: (id) => ({ id }) };
  const window = {};
  // Stubbed so that bypassing the helper reports as a failed assertion rather
  // than an unhandled TypeError. A mutation that called navigator.share
  // directly used to kill the run with a stack trace, which is a far worse
  // signal than a named check: it looks like a broken test, not a broken
  // share. These record the bypass instead.
  let bypassed = null;
  const navigator = {
    share: (a) => { bypassed = 'navigator.share'; return Promise.resolve(a); },
    clipboard: { writeText: () => { bypassed = 'navigator.clipboard'; return Promise.resolve(); } },
  };
  let sprintAttempt = attempt;
  ${src}
  window.shareSprintResult(btnId);
  return captured ? { ...captured, bypassed } : { bypassed, message: '', url: null };
`);

const row = (pattern) => ({ guess: 'XXXXX', colors: [...pattern].map(Number) });
const attempt = (rows, over) => ({
  date: '2026-11-14', solved: !!over.solved, score: over.score || 0,
  elapsedMs: over.elapsedMs == null ? null : over.elapsedMs,
  guesses: rows,
});

// Before anything reads a message: the share must have gone through the one
// route out. Everything below is meaningless if it did not.
{
  const out = buildShare(attempt([row('22222')], { solved: true, score: 500, elapsedMs: 1000 }));
  ck(!out.bypassed, 'the share goes through shareViaSheetOrClipboard, not the raw APIs',
     `called ${out.bypassed} directly`);
  ck(out.message, 'and the helper actually received a message', JSON.stringify(out.message));
}

// ---- a solve ---------------------------------------------------------------
{
  const out = buildShare(attempt([row('01000'), row('22010'), row('22222')],
    { solved: true, score: 150, elapsedMs: 64300 }));
  const lines = out.message.split('\n');
  eq('heading, one row per guess, result', lines.length, 5);
  eq('the heading numbers the puzzle', lines[0], '🕹️ Lexathon Sprint #13');
  eq('the grid is one line per guess, in the board\'s own colours',
     lines.slice(1, 4), ['⬜🟧⬜⬜⬜', '🟦🟦⬜🟧⬜', '🟦🟦🟦🟦🟦']);
  eq('the result carries guesses, time and points',
     lines[4], '⏱️ 3/5 · 1:04.3 · 150 pts');
  // Wordle's palette would make this read as a Wordle result.
  ck(!/🟩|🟨/.test(out.message), 'no green or yellow squares', out.message);
}

// ---- a miss ----------------------------------------------------------------
{
  const out = buildShare(attempt(
    [row('00000'), row('01000'), row('02000'), row('22000'), row('22200')],
    { solved: false, score: 0, elapsedMs: null }));
  const lines = out.message.split('\n');
  // The half of the distribution that makes the other half worth posting.
  // Hiding it would make every shared result look like a win.
  eq('a miss is shareable and reads X/5', lines[lines.length - 1], '❌ X/5');
  eq('and still shows all five rows', lines.length, 7);
  ck(!/undefined|NaN|null/.test(out.message), 'with no stray undefined from the absent time', out.message);
}

// ---- the clock is the point ------------------------------------------------
{
  const fast = buildShare(attempt([row('22222')], { solved: true, score: 500, elapsedMs: 4100 }));
  ck(/4\.1s/.test(fast.message), 'a sub-minute solve reads in seconds', fast.message);
  const slow = buildShare(attempt([row('22222')], { solved: true, score: 500, elapsedMs: 615000 }));
  ck(/10:15\.0/.test(slow.message), 'and a long one in minutes', slow.message);
}

// ---- the number ------------------------------------------------------------
{
  const epoch = (html.match(/const SPRINT_EPOCH = "([^"]*)"/) || [])[1];
  ck(/^\d{4}-\d{2}-\d{2}$/.test(epoch), 'Sprint has an epoch date', epoch);
  const first = buildShare({ ...attempt([row('22222')], { solved: true, score: 500, elapsedMs: 1000 }), date: epoch });
  ck(/Sprint #1\n/.test(first.message), 'the epoch itself is #1', first.message.split('\n')[0]);
  // A date before the epoch has no number; the heading must still be sane
  // rather than reading "#0" or "#-3".
  const before = buildShare({ ...attempt([row('22222')], { solved: true, score: 500, elapsedMs: 1000 }), date: '2020-01-01' });
  eq('a date before the epoch drops the number rather than printing a silly one',
     before.message.split('\n')[0], '🕹️ Lexathon Sprint');
}

// ---- one route out ----------------------------------------------------------
eq('it hands the link to the helper rather than baking it into the text',
   buildShare(attempt([row('22222')], { solved: true, score: 500, elapsedMs: 1000 })).url,
   'https://lexathon.gg');
{
  const out = buildShare(attempt([row('22222')], { solved: true, score: 500, elapsedMs: 1000 }));
  ck(!out.message.includes('lexathon.gg'),
     'and does not also put it in the message, which would print it twice', out.message);
  eq('the button is handed over so its label can report success or failure',
     out.buttonEl && out.buttonEl.id, 'btn-sprint-share');
  eq('with the label to restore', out.defaultLabel, 'Share Result');

  // Two buttons now share this one function: the modal's, and the one on the
  // panel under the board. The helper flashes COPIED! on the button it is
  // handed, so the one that was actually pressed has to be the one named -
  // flashing the modal's while the panel is on screen reports a successful
  // copy as nothing happening at all.
  const fromPanel = buildShare(attempt([row('22222')], { solved: true, score: 500, elapsedMs: 1000 }),
                               'btn-sprint-share-panel');
  eq("a caller that names its own button gets that button reported on",
     fromPanel.buttonEl && fromPanel.buttonEl.id, 'btn-sprint-share-panel');
  eq('and the text it shares is the same either way', fromPanel.message, out.message);
}

// The raw APIs must not be called directly — that is what the helper is for,
// and bypassing it is how desktop ends up opening an OS contacts panel.
// Comments stripped first. The function's own comment explains WHY it does
// not call navigator.share directly, and a check that a comment can fail is
// as broken as one a comment can satisfy — this failed on its own rationale.
const shareFn = grab(/        window\.shareSprintResult = function\(btnId\) \{\n[\s\S]*?\n        \}/)
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ck(!/navigator\.share\(|navigator\.clipboard/.test(shareFn),
   'the share function never touches navigator.share or the clipboard itself', shareFn.slice(0, 160));
ck(/shareViaSheetOrClipboard\(/.test(shareFn), 'it routes through the shared helper');

// ---- the button is offered at all -------------------------------------------
ck(/id="btn-sprint-share"/.test(html), 'the end modal has a share button');
ck(/<button class="btn-primary" id="btn-sprint-share"/.test(html),
   'and it is a primary action, because sharing is how a daily mode spreads',
   (html.match(/<button[^>]*id="btn-sprint-share"[^>]*>/) || [''])[0]);
// Anchored on the DEFINITION, not the name: window.dismissSprintEnd also
// appears as an onclick in the modal markup 195k characters earlier, so the
// obvious anchor sliced backwards and handed this check an empty string.
const modalStart = html.indexOf('function showSprintEndModal');
const modalEnd = html.indexOf('window.dismissSprintEnd = function');
ck(modalStart !== -1 && modalEnd > modalStart, 'the end-modal body is findable', `${modalStart}..${modalEnd}`);
const modal = html.slice(modalStart, modalEnd);
ck(/style\.display = "inline-block";/.test(modal) && !/solved \? "inline-block" : "none"/.test(modal),
   'shown whether or not the word was solved');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
