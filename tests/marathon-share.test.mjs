/*
 * The Marathon share: a week as a grid.
 *
 * One mark per word, five to a row, in the order THIS player met them. Twenty
 * in a line is wider than a phone; four rows of five reads as a block.
 *
 * What is worth knowing about this grid, and is NOT true of the Trifecta's:
 * it is not comparable position by position. Everyone gets the same twenty
 * words in their own order, so somebody else's third mark is a different word
 * from yours. That is the same property that makes it spoiler-free, and the
 * line underneath is what two people actually compare.
 *
 * The data for it had to come from somewhere. guessMarathonWord answers one
 * guess at a time and publicMarathonState did not say how many guesses each
 * position had cost, so a client that played a whole week knew its score and
 * nothing about its own shape. The server returns `results` now, and the
 * client keeps it in step as the week is played rather than re-reading the
 * attempt per word.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const src = [
  grab(/ {8}function guessMark\(count, solved\) \{\n[\s\S]*?\n {8}\}/, 'guessMark'),
  grab(/ {8}function marathonWeekLabel\(key\) \{\n[\s\S]*?\n {8}\}/, 'marathonWeekLabel'),
  grab(/ {8}const MARATHON_SHARE_COLS = \d+;/, 'MARATHON_SHARE_COLS'),
  grab(/ {8}const RUN_ICON = "[^"]*";/, 'RUN_ICON'),
  grab(/ {8}const TROPHY_ICON = "[^"]*";/, 'TROPHY_ICON'),
  grab(/ {8}const FLAG_ICON = "[^"]*";/, 'FLAG_ICON'),
  grab(/ {8}const MID_SEP = "[^"]*";/, 'MID_SEP'),
  grab(/ {8}const DASH_SEP = "[^"]*";/, 'DASH_SEP'),
  grab(/ {8}window\.shareMarathonResult = function\(\) \{\n[\s\S]*?\n {8}\}/, 'shareMarathonResult'),
].join('\n');
console.log('extracted from index.html:', src.length, 'chars');

const build = new Function('marathonAttempt', [
  'const window = {}; const document = { getElementById: () => ({}) }; let cap = null;',
  'function shareViaSheetOrClipboard(title, message, url, btn, label, opts) { cap = { title, message, url, opts }; }',
  src, 'window.shareMarathonResult(); return cap;'].join('\n'));

const COLS = Number(/ {8}const MARATHON_SHARE_COLS = (\d+);/.exec(html)[1]);
const r = (guesses) => ({ guesses, solved: true });
const miss = () => ({ guesses: 5, solved: false });
const week = (results, score = 5000, wordCount = 20) =>
  ({ week: '2026-11-02', wordCount, score, results });
const clean = Array.from({ length: 20 }, (_, i) => r((i % 5) + 1));

// A keycap is three code units; splitting a row by code point counts each
// mark as three glyphs.
const marks = (row) => row.match(/\d️⃣|./gu) || [];
const lines = (out) => out.message.split('\n');
const gridOf = (out) => lines(out).slice(1, -1);

// ---- the grid ------------------------------------------------------------
{
  const out = build(week(clean, 9120));
  const grid = gridOf(out);
  eq('twenty words make four rows of five', grid.length, 20 / COLS);
  ck(grid.every((row) => marks(row).length === COLS), 'every row is exactly as wide as the rest',
     grid.map((row) => marks(row).length).join(','));
  // Read back in order: the grid is this player's week, in the order they
  // met it, and a row-chunking bug would scramble it silently.
  const flat = grid.flatMap(marks).map((m) => {
    const x = /^(\d)️⃣$/.exec(m);
    return x ? Number(x[1]) : m;
  });
  eq('and the marks read back in the order the words were played',
     flat, clean.map((x) => x.guesses));
}
{
  // Width comes from the row, not the word count: a legacy fifty-word month
  // still draws, in ten rows rather than one impossible line.
  const fifty = Array.from({ length: 50 }, () => r(3));
  eq('a fifty-word week draws ten rows', gridOf(build(week(fifty, 12000, 50))).length, 50 / COLS);
}
{
  // A part-week, which should not happen (the share is raised on completion)
  // but must not produce a ragged last row of undefined marks.
  const out = build(week([r(2), r(1), r(3)], 650));
  const grid = gridOf(out);
  eq('a short run makes one row', grid.length, 1);
  eq('with only the marks it has', marks(grid[0]).length, 3);
}

// ---- the misses ----------------------------------------------------------
{
  const mixed = [...clean];
  mixed[5] = miss();
  mixed[13] = miss();
  const out = build(week(mixed, 7480));
  const grid = gridOf(out);
  eq('a cross keeps the slot it was missed in', marks(grid[1])[0], '❌');
  eq('and so does the second', marks(grid[2])[3], '❌');
  eq('the rows stay the same width', grid.map((row) => marks(row).length), [5, 5, 5, 5]);
  ck(/18\/20/.test(lines(out).at(-1)), 'and the count says eighteen', lines(out).at(-1));
}

// ---- a week that was never finished --------------------------------------
// The denominator is the WEEK's word count, not however many rows this
// attempt happens to carry. A player who stops at fifteen and opens the modal
// on a later visit has fifteen results and twenty words; reading the count off
// the array would print "13/15" and -- worse -- call five unplayed words a
// perfect week. startMarathon seeds results from the server's history, so a
// short array is the ordinary state of an unfinished week, not a corruption.
{
  const short = [...clean.slice(0, 13), miss(), miss()];
  const out = build(week(short, 6200));
  const line = lines(out).at(-1);
  ck(/13\/20/.test(line), 'a week stopped at fifteen still counts out of twenty', line);
  ck(!/PERFECT/.test(line), 'and thirteen of twenty is not a perfect week', line);
  eq('the grid draws only the words that were played',
     gridOf(out).reduce((n, row) => n + marks(row).length, 0), short.length);
}

// ---- the line ------------------------------------------------------------
{
  const out = build(week(clean, 9120));
  const line = lines(out).at(-1);
  ck(/PERFECT/.test(line), 'a week with no misses says so outright', line);
  ck(/\u{1F3C6} PERFECT · 20\/20 · 9,120 pts/u.test(line),
     'badge, separator, count, score - the shape the Trifecta uses', line);
}
{
  const line = lines(build(week([...clean.slice(0, 19), miss()], 8900))).at(-1);
  ck(!/PERFECT/.test(line), 'one miss is not a perfect week', line);
  ck(/\u{1F3C1} 19\/20 · 8,900 pts/u.test(line), 'and reads as nineteen of twenty', line);
}
{
  // No average. With twenty numbers printed above it, the average is their
  // mean computed for a reader who can see them - the same restatement the
  // Trifecta dropped its own for.
  const out = build(week(clean, 9120));
  ck(!/avg/i.test(out.message), 'no average, because the grid prints what it would average', out.message);
  ck(!/\d+\.\d+s|\d+:\d\d/.test(out.message), 'and no clock, which Marathon does not have', out.message);
}
{
  const out = build(week(clean, 9120));
  ck(/^\u{1F3C3} Lexathon Marathon — Week of /u.test(lines(out)[0]),
     'the heading names the mode and the week', lines(out)[0]);
  // No puzzle number: the mode ran monthly and then weekly, so "Marathon #9"
  // would be nine of two different things.
  ck(!/#/.test(lines(out)[0]), 'and carries no number', lines(out)[0]);
  const noWeek = build({ ...week(clean, 9120), week: null });
  ck(/^\u{1F3C3} Lexathon Marathon$/u.test(lines(noWeek)[0]),
     'an attempt with no week drops the clause rather than printing null', lines(noWeek)[0]);
}

// ---- how it is shared ----------------------------------------------------
{
  const out = build(week(clean, 9120));
  eq('it goes out as a Marathon share', out.title, 'Lexathon Marathon');
  eq('pointing at the site root', out.url, 'https://lexathon.gg');
  // A shared SCORE is already a grid and a stats line; a card of the game's
  // own branding under it buries the thing being shared.
  ck(out.opts && out.opts.preview === false, 'with the link card suppressed, like the other two score shares',
     JSON.stringify(out.opts));
  ck(!/lexathon\.gg/i.test(out.message), 'and no link of its own in the text',
     out.message.slice(-60));
}
{
  // Every share call in the file is accounted for, so a new one cannot
  // quietly default to carrying a card.
  const calls = [...html.matchAll(/shareViaSheetOrClipboard\(\s*"([^"]*)"[\s\S]{0,300}?\);/g)]
    .map((m) => [m[1], /preview: false/.test(m[0])]);
  eq('the score shares all suppress the card',
     calls.filter(([, off]) => off).map(([x]) => x).sort(),
     ['Lexathon', 'Lexathon Marathon', 'Lexathon Sprint', 'Lexathon Trifecta']);
}

// ---- one mark, two modes -------------------------------------------------
// The Trifecta draws the same fact, and a second copy is how the two drift.
{
  eq('guessMark is defined once', (html.match(/function guessMark\(/g) || []).length, 1);
  // Forward-sliced to the call that ends it, not a character budget: the
  // body is long and a fixed window stops short of the line being checked.
  const triFrom = html.indexOf('window.shareDailyStats = function');
  const tri = html.slice(triFrom, html.indexOf('shareViaSheetOrClipboard("Lexathon Trifecta"', triFrom));
  ck(tri.length > 500, 'the Trifecta share body is found', String(tri.length));
  ck(/guessMark\(h\.guesses\.length, h\.solved\)/.test(tri),
     'and the Trifecta share goes through it', (tri.match(/[^\n]*guessMark[^\n]*/) || [''])[0].trim());
  const mark = new Function(`const window = {};\n${src}\nreturn guessMark;`)();
  eq('a solved word is its guess count as a keycap', mark(3, true), '3️⃣');
  eq('an unsolved one is a cross', mark(5, false), '❌');
  eq('and a count outside 1-9 degrades rather than emitting a broken keycap',
     mark(12, true), '\u{1F7E9}');
  eq('...including zero', mark(0, true), '\u{1F7E9}');
}

// ---- where the data comes from -------------------------------------------
{
  // The server tells the player their own guess counts. It says nothing about
  // WHICH words they were, and the per-player order means a position is not
  // even the same word for two people.
  const state = fn.slice(fn.indexOf('function publicMarathonState'),
                         fn.indexOf('function publicMarathonState') + 1200);
  ck(/results: \(attempt\.history \|\| \[\]\)\.map/.test(state),
     'publicMarathonState returns a per-position result', state);
  ck(/guesses: \(\(h && h\.guesses\) \|\| \[\]\)\.length/.test(state),
     'as a COUNT, never the guesses themselves', state);
  ck(!/words:/.test(state) && !/puzzle\.words/.test(state),
     'and still never the words', state);
}
{
  // And the client keeps it in step as the week is played, rather than
  // re-reading the whole attempt once per finished word.
  const guess = html.slice(html.indexOf('marathonAttempt.score = result.score;'),
                           html.indexOf('animateRowReveal(rowIndex, guessArr'));
  ck(/if \(result\.wordFinished\)/.test(guess) && /marathonAttempt\.results\[marathonAttempt\.wordIndex\]/.test(guess),
     'a finished word records its own line in the grid', guess);
  // BEFORE wordIndex moves on, or every mark lands one position late.
  ck(guess.indexOf('marathonAttempt.results[marathonAttempt.wordIndex]')
     < guess.indexOf('marathonAttempt.wordIndex = result.wordIndex'),
     'at the position just finished, not the one about to start', guess);
}

// ---- the button ----------------------------------------------------------
{
  const modal = html.slice(html.indexOf('<div id="marathon-end-modal"'),
                           html.indexOf('<div id="marathon-end-modal"') + 1600);
  ck(/id="btn-marathon-share"/.test(modal), 'the end modal has a share button');
  ck(/class="btn-primary" id="btn-marathon-share"/.test(modal),
     'and it is the primary action, because sharing is how a quiet mode spreads');
  ck(modal.indexOf('btn-marathon-share') < modal.indexOf('View the Standings'),
     'leading the other two, which only navigate', modal.slice(0, 200));
  ck(!/That is the month/.test(html), 'and the modal no longer calls a week a month',
     (html.match(/[^\n]*That is the[^\n]*/) || [''])[0].trim());
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
