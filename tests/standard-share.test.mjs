/*
 * The Standard-mode end-of-run share.
 *
 * What this pins, and why it exists:
 *
 *   - ONE modal serves both endings. showCashOutModal() and triggerGameOver()
 *     write into the same #modal-overlay, and #btn-share is never hidden, so
 *     the Share Score button is live after a wipeout too.
 *   - The share cannot read live run state. The wipeout call site zeroes
 *     `score` BEFORE calling triggerGameOver(), so a share that read `score`
 *     announced "Cashed Out: 0 pts" after a run that lost twelve thousand
 *     points: wrong about the ending, and it threw away the only interesting
 *     fact about it. The outcome is snapshotted when the modal opens instead,
 *     and these cases drive the real sequence — assign, zero, trigger, share —
 *     rather than calling the share with hand-fed numbers.
 *   - Three endings, three messages: cashed out, wiped out holding points, and
 *     wiped out with nothing banked (where "lost 0 pts" would be wrong).
 *   - Shape matches the Gauntlet share: heading, result, hook, bare link.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (re) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + re); return m[0]; };

const decl = grab(/        let lastRunOutcome = null;/);
const cashOut = grab(/        function showCashOutModal\(\) \{\n[\s\S]*?saveRunToCloud\(\); \n        \}/);
const gameOver = grab(/        function triggerGameOver\(lostScore = 0\) \{\n[\s\S]*?saveRunToCloud\(true, lostScore\); \n        \}/);
const share = grab(/        window\.shareStats = function\(\) \{\n[\s\S]*?\n        \}/);
const callSite = grab(/                                    SFX\.wipeout\(\);\n[\s\S]*?triggerGameOver\(finalLostScore\), 1200\);/);
const src = [decl, cashOut, gameOver, share].join('\n\n');
console.log('extracted from index.html:', src.length, 'chars');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// Drives the REAL end-of-run sequence, then clicks Share Score.
// `kind` is 'cashout' or 'wipeout'; the wipeout branch reproduces the call
// site's zeroing so the test cannot pass on a share that reads live state.
const endRunAndShare = new Function('kind', 'runScore', 'runWords', `
  const window = {};
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, style: {}, innerText: null });
  const document = { getElementById: el };
  const SFX = { cashOut() {}, wipeout() {} };
  const modalOverlay = { style: {} };
  let isAnimating = true;
  let score = runScore, wordsGuessed = runWords;
  let cloudSave = null;
  function clearLocalState() {}
  function saveRunToCloud(lost = false, lostScore = 0) { cloudSave = { lost, lostScore }; }
  let captured = null;
  function shareViaSheetOrClipboard(title, message, url, buttonEl, defaultLabel, linkLabel) {
    captured = { title, message, url, buttonEl, defaultLabel, linkLabel };
  }
  ${src}
  if (kind === 'cashout') {
    showCashOutModal();
  } else {
    const finalLostScore = score;
    score = 0;
    triggerGameOver(finalLostScore);
  }
  window.shareStats();
  return { captured, els, cloudSave, modalOverlay, scoreAfter: score };
`);

// --- cashing out ----------------------------------------------------------
let out = endRunAndShare('cashout', 12400, 31);
ck(out.captured.message === '🕹️ Lexathon\n💰 Cashed out 12,400 pts · 31 words\nCan you beat it?',
   'a cash-out says what was banked and how many words', JSON.stringify(out.captured.message));
ck(out.captured.message.split('\n').length === 3, 'heading, result, hook', out.captured.message.split('\n').length);
ck(out.captured.url === 'https://lexathon.gg', 'and points at the site root', JSON.stringify(out.captured.url));
ck(out.captured.linkLabel === undefined, 'the link carries no label, same as the Gauntlet share');
ck(out.captured.buttonEl === out.els['btn-share'], 'the flash lands on the Share Score button');
ck(out.captured.defaultLabel === 'Share Score', 'and restores its own label', JSON.stringify(out.captured.defaultLabel));

// --- the bug this file exists for ----------------------------------------
out = endRunAndShare('wipeout', 12400, 31);
ck(out.scoreAfter === 0, 'the wipeout path really did zero the live score first', String(out.scoreAfter));
ck(out.captured.message === '🕹️ Lexathon\n💀 Wiped out — lost 12,400 pts · 31 words\nCash out sooner than I did.',
   'a wipeout reports the loss, not a cash-out', JSON.stringify(out.captured.message));
ck(!/Cashed out/i.test(out.captured.message), 'a wipeout never claims a cash-out', out.captured.message);
ck(out.captured.message.includes('12,400'), 'and keeps the total that was lost, not the zeroed score', out.captured.message);
ck(!/\b0 pts\b/.test(out.captured.message), 'so no "0 pts" after a twelve-thousand-point run', out.captured.message);

// Wiped out holding nothing. "lost 0 pts" would be wrong as well as bleak, and
// since score only ever rises alongside wordsGuessed, no points means no words.
out = endRunAndShare('wipeout', 0, 0);
ck(out.captured.message === '🕹️ Lexathon\n💀 Wiped out with nothing banked\nThink you can do better?',
   'nothing banked gets its own line rather than "lost 0 pts"', JSON.stringify(out.captured.message));
ck(!/0 pts|0 words/.test(out.captured.message), 'and counts nothing', out.captured.message);

// --- both endings, in one session -----------------------------------------
// The snapshot is per-run state, so a wipeout must not colour a later cash-out
// or the other way round. Same module instance, two runs.
const twoRuns = new Function(`
  const window = {};
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, style: {}, innerText: null });
  const document = { getElementById: el };
  const SFX = { cashOut() {}, wipeout() {} };
  const modalOverlay = { style: {} };
  let isAnimating = true;
  let score = 0, wordsGuessed = 0;
  function clearLocalState() {}
  function saveRunToCloud() {}
  const messages = [];
  function shareViaSheetOrClipboard(title, message) { messages.push(message); }
  ${src}
  score = 9000; wordsGuessed = 20;
  const lost = score; score = 0; triggerGameOver(lost);
  window.shareStats();
  score = 3200; wordsGuessed = 9;
  showCashOutModal();
  window.shareStats();
  return messages;
`)();
ck(/Wiped out/.test(twoRuns[0]) && !/Wiped out/.test(twoRuns[1]),
   'a wipeout does not leak into the next run\'s share', JSON.stringify(twoRuns));
ck(twoRuns[1].includes('3,200 pts') && !twoRuns[1].includes('9,000'),
   'the second share carries the second run\'s numbers', JSON.stringify(twoRuns[1]));

// --- pluralisation --------------------------------------------------------
ck(endRunAndShare('cashout', 100, 1).captured.message.includes('· 1 word\n'), 'one word is singular');
ck(endRunAndShare('cashout', 300, 2).captured.message.includes('· 2 words\n'), 'two words are plural');
ck(endRunAndShare('wipeout', 100, 1).captured.message.includes('· 1 word\n'), 'one word is singular after a wipeout too');

// --- the modal behind the share stays as it was ---------------------------
out = endRunAndShare('cashout', 12400, 31);
ck(out.els['modal-title-text'].innerText === 'Cashed Out!', 'the cash-out modal title', out.els['modal-title-text'].innerText);
ck(out.els['modal-score'].innerText === '12,400', 'the cash-out modal total', out.els['modal-score'].innerText);
ck(out.els['modal-words'].innerText === 31, 'the cash-out modal word count', String(out.els['modal-words'].innerText));
out = endRunAndShare('wipeout', 12400, 31);
ck(out.els['modal-title-text'].innerText === 'Game Over!', 'the wipeout modal title', out.els['modal-title-text'].innerText);
ck(out.els['modal-score'].innerText === '0 (Lost 12,400)', 'the wipeout modal still shows what was lost', out.els['modal-score'].innerText);
ck(out.cloudSave.lost === true && out.cloudSave.lostScore === 12400,
   'and the cloud save still records the loss', JSON.stringify(out.cloudSave));

// --- source-level invariants ---------------------------------------------
// The snapshot has to come from the ARGUMENT. triggerGameOver runs after the
// live score is zeroed, so reading `score` there would reintroduce the bug in
// a form every message-level case above would still pass.
ck(/lastRunOutcome = \{ cashedOut: false, points: lostScore,/.test(gameOver),
   'triggerGameOver snapshots its lostScore argument, not the zeroed global');
ck(/lastRunOutcome = \{ cashedOut: true, points: score,/.test(cashOut),
   'showCashOutModal snapshots the score still standing');
// The order at the call site is what makes that necessary; pin it so a future
// reshuffle does not quietly make the argument redundant and then wrong.
ck(callSite.indexOf('score = 0;') < callSite.indexOf('triggerGameOver(finalLostScore)'),
   'the call site zeroes the score before opening the modal');
ck(/let finalLostScore = score;/.test(callSite), 'having saved the total first', callSite);
// Both endings must set it, or one of them shares whatever the other left.
ck((src.match(/lastRunOutcome = \{/g) || []).length === 2, 'exactly two writers of the snapshot');
// #btn-share is never hidden, which is why the wipeout path needed handling at
// all rather than the button being taken away.
ck(!/btn-share"\)\.style\.display/.test(html), 'the Share Score button is never hidden');
// No run bar: a Standard run has no fixed length to measure a row of blocks against.
ck(!/[🟩⬜❌]/u.test(share), 'the Standard share carries no run bar', share);

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
