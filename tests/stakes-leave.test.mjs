/*
 * Leaving Stakes mid-run, and the double payout that used to be.
 *
 * Stakes is the mode with no end: play a word or play for an hour, stop when
 * you like. Switching to another mode used to demand a cash-out first -
 * "Switching to Sprint will bank your current Stakes run. Continue?" - which
 * is a toll on the one mode that has no finish line.
 *
 * Underneath the prompt was a real bug. That branch called saveRunToCloud()
 * and then reset nothing. Both of the REAL endings - the cash-out modal and
 * the wipeout - call clearLocalState() first and go on to clear the run. This
 * one paid the run out, left the score on the screen and the save on disk, and
 * so paid it out AGAIN the next time you left, on top of everything added in
 * between. Leave at 500, come back, play to 800, leave again: 1,300 banked for
 * a run worth 800.
 *
 * What makes leaving safe without banking is that the run was never only in
 * memory: saveLocalState() writes score, continues, stats, the word in
 * progress and its guesses after every guess, and loadLocalState() puts them
 * back.
 *
 * The invariant worth holding, because it is what the bug broke: a run is
 * banked and cleared together, or neither.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('missing ' + a);
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('missing end of ' + a);
  return src.slice(i + a.length, j);
};

// ---- leaving asks nothing and banks nothing -------------------------------
{
  const go = between(html, 'window.goToMode = async function(target) {', '\n        };');
  ck(go.length > 400, 'found goToMode', String(go.length));
  // Comments stripped first: the branch that used to bank is now a paragraph
  // explaining why it does not, and it names the function it no longer calls.
  // Matching the word would find the explanation and call it the bug.
  const goCode = go.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ck(!/saveRunToCloud/.test(goCode),
     'switching modes does not bank the Stakes run',
     (goCode.match(/[^\n]*saveRunToCloud[^\n]*/) || [''])[0].trim());
  ck(!/will bank your current Stakes run/.test(html),
     'and nothing asks you to',
     (html.match(/[^\n]*bank your current Stakes[^\n]*/) || [''])[0].trim());
  // The other modes still tear down properly on the way out; only the
  // banking went.
  ck(/window\.leaveSprint\(\)/.test(go) && /window\.leaveMarathon\(\)/.test(go),
     'the teardown for the other modes is untouched');
}

// ---- banked and cleared together, or neither ------------------------------
{
  // Every call, with the line before it. This is the shape the bug had: a
  // bank with no clear beside it.
  const lines = html.split('\n');
  const calls = [];
  lines.forEach((line, i) => {
    if (!/saveRunToCloud\(/.test(line)) return;
    if (/^\s*(async )?function saveRunToCloud/.test(line)) return;   // the definition
    if (/^\s*(\/\/|\*)/.test(line.trim())) return;                   // a comment about it
    calls.push({ n: i + 1, line: line.trim(), near: lines.slice(Math.max(0, i - 2), i + 1).join(' ') });
  });
  eq('there are exactly two places a run is banked', calls.length, 2);
  for (const c of calls) {
    ck(/clearLocalState\(\)/.test(c.near),
       `the bank at line ${c.n} clears the saved run in the same breath`,
       c.line.slice(0, 110));
  }
  // Both are endings, not departures.
  const ctx = calls.map((c) => c.near).join(' ');
  ck(/modalOverlay\.style\.display = "flex"/.test(ctx),
     'and both of them are a run ENDING, with its result on screen');
}

// ---- which is safe because the run is already on disk ---------------------
{
  const save = between(html, 'function saveLocalState(wordFinished = false) {', '\n        }');
  for (const field of ['score', 'continues', 'wordsGuessed', 'runStats', 'targetWord', 'currentWordGuesses']) {
    ck(new RegExp(`\\b${field}\\b`).test(save), `the saved run carries ${field}`);
  }
  // After every guess, not only when a word is finished - otherwise leaving
  // mid-word loses the guesses already made against it.
  // Live call sites only. A commented-out call still contains every word a
  // regex looks for, which is how the first version of this check passed with
  // the mid-word save switched off.
  const liveCalls = html.split('\n')
    .filter((l) => /saveLocalState\(/.test(l))
    .filter((l) => !/^\s*(\/\/|\*)/.test(l.trim()))
    .filter((l) => !/^\s*function saveLocalState/.test(l))
    .map((l) => l.trim());
  ck(liveCalls.length >= 2, 'and it is written more than once per word',
     JSON.stringify(liveCalls.map((l) => l.slice(0, 50))));
  // Each site named by what it sits next to. "Some call passes true" is not
  // enough: dismissWarning passes true as well, so switching off the save
  // that runs when a word is WON left that check green.
  const sites = [
    [/POINTS!/, 'when a word is won'],
    [/persist the in-progress word/, 'mid-word, so leaving between guesses keeps them'],
    [/startRound\(\)/, 'and when the wipeout warning is dismissed'],
  ];
  for (const [re, what] of sites) {
    ck(liveCalls.some((l) => re.test(l)), `the run is saved ${what}`,
       JSON.stringify(liveCalls.map((l) => l.slice(0, 60))));
  }
  ck(/function loadLocalState\(\)/.test(html), 'and something reads it back');
  // Storage can throw rather than return null in a private window; losing the
  // resume is fine, taking the game down is not.
  ck(/try \{ localStorage\.setItem\("wordcade_save"/.test(html),
     'the write is guarded, because blocked storage throws on access');
}

for (const [ok, name, detail] of t) console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : '— ' + detail);
const bad = t.filter((x) => !x[0]).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
