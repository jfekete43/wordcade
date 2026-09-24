/*
 * The written rules must agree with the code that enforces them.
 *
 * This exists because they quietly stopped agreeing, three separate times,
 * and nothing noticed:
 *
 *   - The Gauntlet was taken off the leaderboard, but the in-app How To Play
 *     still listed a "Gauntlet (today only)" tab and told players where to
 *     find a board that no longer existed.
 *   - FFA got its own rating, but faq.html and how-to-play.html both still
 *     said Clash and FFA "feed one MMR rating" — the exact claim the change
 *     had just made false.
 *   - FFA went to 3-6 players while the FAQ still said it "starts with as
 *     few as two" and how-to-play's payout table still stopped at four.
 *
 * Every one of those was a line of prose describing a constant that had
 * moved. So the constants are read out of the source here and the prose is
 * checked against them. Nothing is hardcoded twice: change FFA_MAX_PLAYERS
 * and this suite tells you which sentences now lie.
 *
 * Pure; no emulator or browser needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');

const fn = read('functions/index.js');
const pages = {
  'index.html': read('index.html'),
  'how-to-play.html': read('how-to-play.html'),
  'faq.html': read('faq.html'),
  'strategy.html': read('strategy.html'),
  'about.html': read('about.html'),
};
// Only the human-readable parts: a rule about player counts can't be broken
// by a hex colour or a slot id, and matching those produces noise instead of
// findings. Scripts and styles come out; tag names stay out of the text.
// Comments FIRST. index.html carries a commented-out AdSense snippet that
// contains a literal <script ...> tag, and stripping scripts before comments
// lets that opener pair with a real </script> hundreds of lines later,
// swallowing the How To Play modal whole. That silently reduced this file's
// prose to 1.8k characters and made four cases below pass on nothing.
const prose = (html) => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ');
const text = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, prose(v)]));
const allProse = Object.values(text).join('\n');

const num = (re, what) => {
  const m = fn.match(re);
  if (!m) throw new Error('could not read ' + what + ' from functions/index.js');
  return Number(m[1]);
};
const MAX = num(/const FFA_MAX_PLAYERS = (\d+);/, 'FFA_MAX_PLAYERS');
const MIN = num(/const FFA_MIN_PLAYERS = (\d+);/, 'FFA_MIN_PLAYERS');
const MATCH_MIN = num(/const FFA_MATCH_MS = (\d+);/, 'FFA_MATCH_MS') / 60000;
const SKIPS = Number(read('index.html').match(/const CLASH_SKIPS_PER_MATCH = (\d+);/)[1]);
const SCORE = JSON.parse(fn.match(/const SCORE_POINTS = (\[[^\]]*\]);/)[1]);
const curvesSrc = fn.match(/const FFA_PAYOUT_CURVES = \{([\s\S]*?)\n\};/)[1];
const CURVES = {};
for (const m of curvesSrc.matchAll(/(\d+):\s*\[([^\]]*)\]/g)) {
  CURVES[Number(m[1])] = m[2].split(',').map((v) => Number(v.trim()));
}
console.log(`read from source: FFA ${MIN}-${MAX} players, ${MATCH_MIN}min, ${SKIPS} skips, scoring ${SCORE.join('/')}`);

const t = [];
const ok = (name, cond, detail = '') => t.push({ name, cond, detail });

// If the prose extraction breaks, every case below starts passing on an
// empty string. Pin the size of what we actually extracted.
for (const [file, body] of Object.entries(text)) {
  ok(`${file}: prose was actually extracted`, body.length > 2000, `${body.length} chars`);
}

// ---- 1. player counts ----------------------------------------------------
const WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
ok(`the rules say "${WORDS[MIN]} to ${WORDS[MAX]}" or "${MIN}-${MAX}" somewhere`,
   new RegExp(`${WORDS[MIN]} to ${WORDS[MAX]}|${MIN}\\s*-\\s*${MAX} player`, 'i').test(allProse));

// Any *other* range claim about FFA is a leftover from a previous cap.
for (const [file, body] of Object.entries(text)) {
  const claims = [...body.matchAll(/(\w+)\s*(?:to|-|–)\s*(\w+)\s+players?/gi)]
    .map((m) => [m[1].toLowerCase(), m[2].toLowerCase()])
    .filter(([a, b]) => (WORDS.includes(a) || /^\d+$/.test(a)) && (WORDS.includes(b) || /^\d+$/.test(b)))
    .map(([a, b]) => [WORDS.includes(a) ? WORDS.indexOf(a) : Number(a), WORDS.includes(b) ? WORDS.indexOf(b) : Number(b)]);
  const wrong = claims.filter(([a, b]) => !(a === MIN && b === MAX) && !(a === 2 && b === 2));
  ok(`${file}: every player-range claim matches ${MIN}-${MAX}`, wrong.length === 0,
     wrong.map((c) => c.join('-')).join(', '));
}
ok('nothing still says FFA starts at two',
   !/as few as two players|starts with (?:as few as )?two|two to four/i.test(allProse));
ok(`the ${MIN}-player floor is written down`,
   new RegExp(`needs? ${MIN} players|needs ${WORDS[MIN]} players|${MIN} players to start`, 'i').test(allProse));

// ---- 2. the payout table matches the curves ------------------------------
// how-to-play.html prints one row per lobby size. Each must be the real curve.
const tableRows = [...pages['how-to-play.html'].matchAll(/<tr><td>(\d+)<\/td>((?:<td>[^<]*<\/td>)+)<\/tr>/g)]
  .map((m) => [Number(m[1]), [...m[2].matchAll(/<td>([^<]*)<\/td>/g)].map((c) => c[1].trim())])
  .filter(([n]) => n >= MIN && n <= MAX);
ok('the payout table has a row per lobby size', tableRows.length === MAX - MIN + 1,
   tableRows.map((r) => r[0]).join(','));
for (const [n, cells] of tableRows) {
  const curve = CURVES[n];
  const expected = Array.from({ length: MAX }, (_, i) =>
    i < curve.length ? curve[i].toLocaleString('en-US') : '—');
  ok(`payout row for ${n} players matches FFA_PAYOUT_CURVES`,
     JSON.stringify(cells) === JSON.stringify(expected),
     `doc ${cells.join('|')}  vs  code ${expected.join('|')}`);
}
ok('no payout row survives for a lobby size the code cannot make',
   ![...pages['how-to-play.html'].matchAll(/<tr><td>(\d+)<\/td>/g)]
     .some((m) => Number(m[1]) < MIN || Number(m[1]) > MAX),
   [...pages['how-to-play.html'].matchAll(/<tr><td>(\d+)<\/td>/g)].map((m) => m[1]).join(','));

// ---- 3. Clash and FFA ratings are described as separate ------------------
ok('no page still claims one shared rating',
   !/(one|a single|the same) MMR rating|feed one MMR|feeds? (?:a )?single MMR/i.test(allProse),
   (allProse.match(/[^.]*(?:one|a single|the same) MMR rating[^.]*\./i) || [''])[0].trim());
ok('the split is stated somewhere', /separate ratings?|its own rating|own FFA rating/i.test(allProse));
ok('onFfaMatchFinished really does write a separate field', /ffaMmr: newMmr/.test(fn));

// ---- 4. leaderboard tabs: documented set === actual set ------------------
const actualTabs = [...pages['index.html'].matchAll(/setLbTime\('(\w+)'\)/g)].map((m) => m[1]);
ok('the app has the tabs we think it has', actualTabs.length > 0, actualTabs.join(','));
const lbLine = (text['index.html'].match(/Leaderboards:[^.]*\./) || [''])[0];
ok('the in-app list names a leaderboard line at all', !!lbLine, lbLine);
for (const tab of actualTabs) {
  const label = { all: 'All Time', monthly: 'Monthly', clash: 'Clash', ffa: 'FFA' }[tab] || tab;
  ok(`the documented leaderboards include ${label}`, lbLine.includes(label), lbLine);
}
ok('no Gauntlet leaderboard tab is documented, because none exists',
   actualTabs.includes('gauntlet') === /Gauntlet \(today only\)|Gauntlet leaderboard tab/i.test(allProse));
ok('FFA is no longer documented as ranking on wins',
   !/FFA \(win count\)|FFA.{0,20}ranked by (?:total )?wins/i.test(allProse));

// ---- 5. the numbers that have never moved, pinned anyway -----------------
ok(`scoring ${SCORE.join('/')} is what the rules print`,
   allProse.includes(SCORE.join('/')), SCORE.join('/'));
ok(`the ${MATCH_MIN}-minute clock is stated`,
   new RegExp(`${MATCH_MIN}[- ]minute|${WORDS[MATCH_MIN]}[- ]minute`, 'i').test(allProse));
ok(`${SKIPS} skips per match is stated`,
   new RegExp(`${SKIPS} skips`, 'i').test(allProse));

// ---- 6. rank tiers match getRankDetails ---------------------------------
const rankSrc = pages['index.html'].match(/function getRankDetails\(mmr\) \{[\s\S]*?\n        \}/)[0];
const tiers = [...rankSrc.matchAll(/mmr < (\d+)\) return \{ name: "(\w+)"/g)].map((m) => [Number(m[1]), m[2]]);
ok('there are rank tiers to check', tiers.length >= 5, String(tiers.length));
for (const [bound, name] of tiers) {
  ok(`${name}'s boundary of ${bound.toLocaleString('en-US')} appears in the rank table`,
     new RegExp(`${name}[\\s\\S]{0,60}${bound.toLocaleString('en-US')}|${(bound - 1).toLocaleString('en-US')}[\\s\\S]{0,40}${name}`, 'i')
       .test(text['how-to-play.html']) || text['how-to-play.html'].includes(bound.toLocaleString('en-US')),
     name);
}

let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
