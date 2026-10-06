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
const REPO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = (f) => path.join(REPO_DIR, f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');

const fn = read('functions/index.js');
const pages = {
  'index.html': read('index.html'),
  'how-to-play.html': read('how-to-play.html'),
  'faq.html': read('faq.html'),
  'strategy.html': read('strategy.html'),
  'about.html': read('about.html'),
  'privacy.html': read('privacy.html'),
  'terms.html': read('terms.html'),
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
// Both the tab ids AND their visible labels come out of the markup. A hardcoded
// id->label map lived here and went stale the moment Monthly became Weekly: the
// map had no entry, the id fell through as the label, and the case mismatch
// failed a check that was actually satisfied.
const tabButtons = [...pages['index.html'].matchAll(/onclick="window\.setLbTime\('(\w+)'\)"[^>]*>([^<]+)</g)]
  .map((m) => ({ id: m[1], label: m[2].trim() }));
const actualTabs = tabButtons.map((t) => t.id);
ok('the app has the tabs we think it has', actualTabs.length > 0, actualTabs.join(','));
ok('and a visible label for every one of them',
   tabButtons.every((t) => t.label.length > 0), JSON.stringify(tabButtons));
const lbLine = (text['index.html'].match(/Leaderboards:[^.]*\./) || [''])[0];
ok('the in-app list names a leaderboard line at all', !!lbLine, lbLine);
for (const { label } of tabButtons) {
  ok(`the documented leaderboards include ${label}`, lbLine.includes(label), lbLine);
}
ok('no Gauntlet leaderboard tab is documented, because none exists',
   actualTabs.includes('gauntlet') === /Gauntlet \(today only\)|Gauntlet leaderboard tab/i.test(allProse));
ok('FFA is no longer documented as ranking on wins',
   !/FFA \(win count\)|FFA.{0,20}ranked by (?:total )?wins/i.test(allProse));

// ---- 4b. the Gauntlet's finish rule, stated in one place and described in ten
// The rule lives in one expression in functions/index.js. The last time it
// changed, the sentence describing it had spread to seven pages — the in-app
// How To Play, the onboarding slide, the Gauntlet card (in four separate string
// literals that had to agree), how-to-play, faq, about, strategy, and the
// archive generator — and a survey of the repo was the only thing that found
// them all. So the rule is read out of the code, and the prose is held to it.
const suddenDeath = /gauntletFinished\s*=\s*wordFinished\s*&&\s*\(/.test(fn);
ok('the Gauntlet finish rule is readable in the server', /const gauntletFinished\s*=/.test(fn));
ok('the server plays all ten words', !suddenDeath && /gauntletFinished = wordFinished && newWordIndex >= attempt\.wordCount/.test(fn));
// Phrases that are only true when a miss ends the run. Scoped to sentences that
// also mention the Gauntlet, so Standard's own wipeout rule is left alone.
const gauntletSentences = allProse.split(/(?<=[.!?])\s+/)
  .filter((x) => /gauntlet/i.test(x) || /ten words|all ten/i.test(x));
const suddenDeathClaims = gauntletSentences.filter((x) =>
  /(a |one |single )?miss(ing)? (a word )?ends? the (whole )?run/i.test(x)
  || /no second chances/i.test(x)
  || /one shot each/i.test(x)
  || /staying alive/i.test(x)
  || /the run stops there/i.test(x));
ok('no page still says a missed word ends the Gauntlet run',
   suddenDeath || suddenDeathClaims.length === 0, suddenDeathClaims.join(' || ').slice(0, 300));
// And the rule is actually stated somewhere a player will read it, rather than
// merely not contradicted.
ok('the rules page says you play all ten',
   /play all ten|plays all ten|all ten words whatever happens/i.test(text['how-to-play.html']),
   text['how-to-play.html'].slice(0, 0));
// The card's four copies of one sentence, which have to agree with each other.
// One sentence, written out four times: once in the markup and three times as
// string literals in the card's branches. One branch ends in an em-dash and
// continues on the next line, so that tail is trimmed before comparing.
const cardLines = [...pages['index.html'].matchAll(/Ten words,[^"<]{0,80}/g)]
  .map((m) => m[0].split('\\u2014')[0].replace(/[.\s]+$/, '').trim());
ok('the Gauntlet card sentence is written in all four places', cardLines.length === 4, JSON.stringify(cardLines));
ok('and says the same thing in every one of them',
   cardLines.length > 0 && new Set(cardLines).size === 1, JSON.stringify(cardLines));

// ---- 4c. the board's tiebreak, documented because players can see it -----
const boardOrders = [...pages['index.html'].matchAll(/orderBy\("score", "desc"\), orderBy\("(\w+)", "desc"\)/g)].map((m) => m[1]);
ok('the Gauntlet board breaks ties on a second key', boardOrders.length >= 2, boardOrders.join(','));
ok('and that key is words solved', boardOrders.every((f) => f === 'wordsGuessed'), boardOrders.join(','));
ok('the rules page itself says what the tiebreak is, since the board shows it',
   /solved more words|who solved more|then by words solved/i.test(text['how-to-play.html']),
   'how-to-play.html');

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

// --- match chat: the policy pages describe a rule the code enforces --------
// Chat was added to privacy.html and terms.html when the public/private split
// shipped. The 50-character limit is a number in index.html and in
// firestore.rules, so the prose stating it can go stale exactly the way the FFA
// player counts did.
const CHAT_TEXT_MAX = Number(read('index.html').match(/const CHAT_TEXT_MAX = (\d+);/)[1]);
const CHAT_PRESETS = JSON.parse(read('index.html').match(/const CHAT_PRESETS = (\[[^\]]*\]);/)[1]);
for (const page of ['privacy.html', 'terms.html']) {
  ok(`${page} covers match chat at all`, /chat/i.test(text[page]));
  ok(`${page} states the free-text limit as ${CHAT_TEXT_MAX} characters`,
     text[page].includes(`${CHAT_TEXT_MAX} characters`),
     (text[page].match(/\d+ characters/g) || []).join(' / '));
  // The whole point of P1: a stranger in a public match cannot type at you.
  ok(`${page} says free text is private matches only`,
     /preset/i.test(text[page]) && /private match/i.test(text[page]));
  // Neither page may promise confidentiality the storage does not provide.
  ok(`${page} does not call chat private or confidential`,
     !/chat (is|are) (private|confidential)\b/i.test(text[page]),
     (text[page].match(/chat (is|are) (private|confidential)[^.]*/i) || [''])[0]);
}
// Match records are deleted on a schedule now, and privacy.html states the
// window. The number lives in tools/match-cleanup.mjs, so the sentence can go
// stale exactly the way the FFA player counts did.
const RETENTION_H = Number(read('tools/match-cleanup.mjs').match(/DEFAULT_RETENTION_HOURS = (\d+);/)[1]);
ok(`privacy.html states the ${RETENTION_H}-hour match retention window`,
   text['privacy.html'].includes(`${RETENTION_H} hours`),
   (text['privacy.html'].match(/\d+ hours?/g) || []).join(' / '));
ok('and says the records are deleted, not merely kept',
   /deleted automatically/i.test(text['privacy.html']));
// The workflow must actually run the cleanup, or the sentence is a promise
// nothing keeps.
const wf = read('.github/workflows/gauntlet-archive.yml');
ok('the daily workflow runs the match cleanup', /node tools\/cleanup-matches\.mjs/.test(wf));
ok('and does so without --legacy, which is the hand-run sweep',
   !/cleanup-matches\.mjs[^\n]*--legacy/.test(wf));
ok('and runs it even when the archive build fails', /if: always\(\)/.test(wf));

// --- the one-command deploy -----------------------------------------------
// The order in here is the part that matters and the part that looks
// arbitrary, so it is worth pinning rather than trusting.
const deploySh = read('tools/deploy.sh');
ok('there is a one-command deploy script', deploySh.length > 500, String(deploySh.length));
// Indexes before functions: an index builds asynchronously and a query fails
// with FAILED_PRECONDITION until it is green, so deploying functions first
// leaves a window where the new code queries an index that does not exist yet.
ok('it deploys indexes before functions',
   /--only firestore:indexes,firestore:rules,functions/.test(deploySh),
   (deploySh.match(/--only [^\s]*/) || [''])[0]);
// This check used to pin `firestore:indexes,functions` — it was asserting that
// the script skipped the rules, which it did. index.html goes live on GitHub
// Pages at push time without waiting for any deploy, so a client change whose
// writes need a rules change is denied in production until the rules land.
ok('it deploys the rules at all', /--only [^\s]*firestore:rules/.test(deploySh),
   (deploySh.match(/--only [^\s]*/) || [''])[0]);
// And the one-liner must deploy the same set the by-hand sequence does, or the
// two documented routes quietly diverge again.
const byHand = (read('DEPLOY.md').match(/firebase deploy --only (\S+) --project wordcade-387e8\n```/) || [])[1];
ok('the script and DEPLOY.md deploy the same pieces',
   !!byHand && deploySh.includes('--only ' + byHand), String(byHand));
// Nothing that deletes or rewrites runs without showing you a dry run first.
// Matched per LINE, not by literal string: cleanup-matches carries --legacy,
// so `${tool}.mjs --dry-run` finds nothing and the check passed vacuously on
// two -1s comparing equal.
const shLines = deploySh.split('\n');
for (const tool of ['backfill-period-best', 'cleanup-matches']) {
  const calls = shLines
    .map((l, i) => ({ i, l: l.trim() }))
    .filter((x) => x.l.startsWith(`node tools/${tool}.mjs`));
  const dry = calls.filter((x) => x.l.includes('--dry-run'));
  const real = calls.filter((x) => !x.l.includes('--dry-run'));
  ok(`${tool} is called both ways`, dry.length === 1 && real.length === 1,
     calls.map((x) => x.l).join(' | '));
  ok(`${tool} is dry-run before it is run for real`,
     dry.length && real.length && dry[0].i < real[0].i,
     calls.map((x) => `line ${x.i}: ${x.l}`).join(' | '));
}
ok('and the real run is behind a confirmation',
   (deploySh.match(/if ask "/g) || []).length >= 2,
   String((deploySh.match(/if ask "/g) || []).length));
// set -e, or a failed deploy carries on into the data steps.
ok('it stops at the first failure', /set -euo pipefail/.test(deploySh));
ok('DEPLOY.md documents it', /bash tools\/deploy\.sh/.test(read('DEPLOY.md')));

// --- analytics: every page, or none of them -------------------------------
// The failure mode is silent. Miss one file and it reports no traffic, and
// nothing anywhere says so — which is exactly what would have happened to the
// generated archive pages, since they come out of a renderer rather than the
// repo, and they are the ones in sitemap.xml.
// Found on disk, not listed. A hardcoded list has the same silent failure as
// the thing it is guarding: add a page, forget the list, and the page reports
// no traffic while the test stays green. 404.html was added and was invisible
// to every suite here for exactly that reason.
const ANALYTICS_FILES = [
  ...fs.readdirSync(REPO_DIR).filter((f) => f.endsWith('.html')).sort(),
  'tools/gauntlet-archive-render.mjs',
];
const analytics = ANALYTICS_FILES.map((f) => {
  const src = read(f);
  return { f, has: /analytics:cloudflare/.test(src),
           token: (src.match(/data-cf-beacon='\{"token":"([^"]*)"\}'/) || [])[1] || null };
});
ok('every page carries the analytics block',
   analytics.every((a) => a.has), analytics.filter((a) => !a.has).map((a) => a.f).join(', '));
// Half-applied is worse than off: the stats look real and are wrong.
const liveCount = analytics.filter((a) => a.token).length;
ok('and they are all in the same state, live or pending',
   liveCount === 0 || liveCount === analytics.length,
   `${liveCount} of ${analytics.length} live — run tools/set-analytics-token.mjs`);
ok('with one token between them',
   new Set(analytics.map((a) => a.token)).size === 1,
   JSON.stringify([...new Set(analytics.map((a) => a.token))]));
if (liveCount === 0) console.log('NOTE  analytics is present but not live yet — tools/set-analytics-token.mjs <token>');
// The privacy policy has to describe what is actually loaded, in both states.
ok('privacy.html does not claim Google Analytics, which the site does not load',
   !/Google Analytics/i.test(text['privacy.html']) && !/gtag|googletagmanager/i.test(read('index.html')),
   (text['privacy.html'].match(/Google Analytics[^.]*/) || [''])[0]);
ok('and names the analytics that IS loaded',
   /Cloudflare Web Analytics/i.test(text['privacy.html']));
// The no-banner claim is only true while the thing is cookieless. If a
// cookie-setting tracker is ever added, this sentence has to go with it.
ok('the no-cookie-banner claim matches a cookieless tracker',
   !/cookie banner/i.test(text['privacy.html']) || /sets no cookies/i.test(text['privacy.html']),
   'privacy.html claims no banner is needed');

// A policy change means a new effective date, and the two pages move together.
const effective = (page) => (pages[page].match(/Effective Date: ([^<]+)</) || [])[1];
ok('privacy.html and terms.html carry the same effective date',
   effective('privacy.html') === effective('terms.html'),
   `${effective('privacy.html')} vs ${effective('terms.html')}`);
ok('and it is no longer the pre-chat date',
   effective('privacy.html') !== 'August 22nd, 2026', effective('privacy.html'));
// An age statement is the other thing public chat brings with it.
ok('terms.html states a minimum age', /at least 13 years old/i.test(text['terms.html']));
ok('privacy.html has a children section', /under 13/i.test(text['privacy.html']));
// Every preset must be a phrase the pages' description actually fits: no
// free-text-only punctuation smuggled into the "fixed list".
ok('no preset phrase is longer than the free-text limit',
   CHAT_PRESETS.every((p) => p.length <= CHAT_TEXT_MAX),
   JSON.stringify(CHAT_PRESETS.filter((p) => p.length > CHAT_TEXT_MAX)));

let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
