/*
 * The written rules must agree with the code that enforces them.
 *
 * This exists because they quietly stopped agreeing, three separate times,
 * and nothing noticed:
 *
 *   - The Trifecta was taken off the leaderboard, but the in-app How To Play
 *     still listed a "Trifecta (today only)" tab and told players where to
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

// ---- escapes that only mean something to JavaScript ----------------------
// A button on the Sprint landing card shipped reading "Play Today\u2019s Word",
// literally, with the backslash-u on screen. It came from a \u escape written
// into MARKUP, where nothing interprets it — it is a JavaScript string escape
// and HTML has never heard of it. Nothing caught it because every suite that
// reads index.html reads it as source, where \u2019 looks perfectly normal.
//
// Checked against rendered prose, so the many legitimate \u escapes inside
// <script> are not findings.
for (const [name, body] of Object.entries(text)) {
  const esc = body.match(/\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\\n(?![a-z])/g) || [];
  ok(`${name} renders no raw JavaScript escape sequences`, esc.length === 0, esc.join(' '));
}

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
// The board list is found by whatever the modal calls ITSELF, rather than by a
// word typed here. It was "Leaderboards:" until the modal and the menu item
// settled on one name, at which point this check went looking for a heading
// that no longer existed anywhere.
// Anchored on the modal's own id: three other modals have a title and a tab
// strip, and the first of them is called Challenges, whose own bullet in the
// same list then satisfied every check below.
const lbName = (pages['index.html'].match(/id="leaderboard-modal"[\s\S]{0,400}?<h2 class="modal-title">([^<]+)</) || [])[1];
ok('the board modal has a title to look for', !!lbName, String(lbName));
const lbLine = (text['index.html'].match(new RegExp(`${lbName}:[^.]*\\.`)) || [''])[0];
ok(`the in-app list names the ${lbName} line at all`, !!lbLine, lbLine);
// A mode can be closed without being deleted (MODES[...].hidden), and its
// leaderboard tab goes with it. Read out of the table rather than listed
// here, so closing or reopening a mode is still a one-word edit.
const hiddenModes = new Set([...pages['index.html']
  .matchAll(/^\s+(\w+):\s+\{ label:[^\n]*hidden: true/gm)].map((m) => m[1]));
ok('the mode table says which modes are closed', hiddenModes.size >= 0, [...hiddenModes].join(','));
for (const { id, label } of tabButtons) {
  if (hiddenModes.has(id)) {
    // Not merely "allowed to be missing": documenting a board nobody can
    // reach is how the three failures in the header above happened.
    ok(`${label} is closed, so the rules do not list its leaderboard`,
       !lbLine.includes(label), lbLine);
  } else {
    ok(`the documented leaderboards include ${label}`, lbLine.includes(label), lbLine);
  }
}
// Every board in that modal is all-time — that is the whole reason the tabs
// name modes now instead of windows — so prose calling one of them today-only
// is describing a different screen. Held to the tab LABELS: the check this
// replaces asked whether a tab with the id `gauntlet` existed, the Trifecta's
// tab has always been called `daily`, and so the one answer it could give
// licensed three pages to say a board that had been there all along did not
// exist ("There's no all-time Trifecta board", and two more).
for (const { label } of tabButtons.filter((t) => !hiddenModes.has(t.id))) {
  const denial = new RegExp(`no all-time ${label} board`
    + `|${label} \\(today only\\)`
    + `|${label} (?:leader)?board (?:only|just)\\b`, 'i');
  ok(`nothing says the ${label} board is today-only`, !denial.test(allProse),
     (allProse.match(new RegExp(`[^.]*(?:${denial.source})[^.]*`, 'i')) || [''])[0].trim().slice(0, 150));
}
ok('FFA is no longer documented as ranking on wins',
   !/FFA \(win count\)|FFA.{0,20}ranked by (?:total )?wins/i.test(allProse));

// ---- 4b. the Trifecta's finish rule, stated in one place and described in many
// The rule lives in one expression in functions/index.js. The last time it
// changed, the sentence describing it had spread to seven pages — the in-app
// How To Play, the onboarding slide, the Trifecta card (in four separate string
// literals that had to agree), how-to-play, faq, about, strategy, and the
// archive generator — and a survey of the repo was the only thing that found
// them all. So the rule is read out of the code, and the prose is held to it.
const suddenDeath = /gauntletFinished\s*=\s*wordFinished\s*&&\s*\(/.test(fn);
ok('the Trifecta finish rule is readable in the server', /const gauntletFinished\s*=/.test(fn));
ok('the server plays every word', !suddenDeath && /gauntletFinished = wordFinished && newWordIndex >= attempt\.wordCount/.test(fn));
// Phrases that are only true when a miss ends the run. Scoped to sentences that
// also mention the Trifecta, so Standard's own wipeout rule is left alone.
// The count is read out of the server and spelled, so the sentences this
// suite polices follow the code instead of a number typed in a test. The
// last change moved it from ten to seven; this one moves it to three.
const GWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
               'eight', 'nine', 'ten'][Number(fn.match(/const DAILY_GAUNTLET_WORD_COUNT = (\d+);/)[1])];
if (!GWORD) throw new Error('no word for DAILY_GAUNTLET_WORD_COUNT');
const gauntletSentences = allProse.split(/(?<=[.!?])\s+/)
  .filter((x) => /gauntlet|trifecta/i.test(x)
    || new RegExp(`${GWORD} words|all ${GWORD}`, 'i').test(x));
const suddenDeathClaims = gauntletSentences.filter((x) =>
  /(a |one |single )?miss(ing)? (a word )?ends? the (whole )?run/i.test(x)
  || /no second chances/i.test(x)
  || /one shot each/i.test(x)
  || /staying alive/i.test(x)
  || /the run stops there/i.test(x));
ok('no page still says a missed word ends the Trifecta run',
   suddenDeath || suddenDeathClaims.length === 0, suddenDeathClaims.join(' || ').slice(0, 300));
// And the rule is actually stated somewhere a player will read it, rather than
// merely not contradicted.
// No page may still state a word count the Trifecta has outgrown.
//
// Scoped by SECTION, not by sentence. The sentence-level version of this
// found the stale line in strategy.html and missed two others, because
// neither names the mode: "You play all seven whatever happens" sits under
// the FAQ heading "Does the Trifecta have a time limit?", and "Getting all
// ten is genuinely hard" sits three sentences into the rules page's own
// Trifecta section. A claim inherits its subject from its heading.
//
// Sections that are NOT about the Trifecta keep their own numbers, which is
// why the scope matters rather than just being tidier: Marathon says "play
// ten in a sitting", Clash says "seven minutes", and about.html says "all
// four are in How To Play" — three legitimate sentences a looser check
// reports as bugs.
{
  const stale = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
    .filter((w) => w !== GWORD);
  const re = new RegExp(`(?:all|plays?|exactly|identical) (?:${stale.join('|')})\\b[^.]{0,40}|(?:${stale.join('|')}) words`, 'i');
  const plain = (x) => x.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
  for (const [name, src] of Object.entries(pages)) {
    // Scripts and styles out first: index.html's module has its own h2-ish
    // shapes inside template strings, and a minified table of dates is not
    // prose about anything.
    const prose = src.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
    // A sentence is in scope if its SECTION is about the Trifecta, or if the
    // sentence names it outright. Either alone misses one: the FAQ's "You
    // play all seven whatever happens" names nothing and inherits its subject
    // from the heading, while strategy.html's "strongest in Trifecta, where
    // scoring something on all ten..." sits in a section about opening words.
    const named = /trifecta|gauntlet|daily puzzle/i;
    const bad = prose.split(/(?=<h[23])/)
      .flatMap((sec) => {
        const inSection = named.test(plain(sec).slice(0, 120));
        return plain(sec).split(/(?<=[.!?])\s+/).filter((x) => inSection || named.test(x));
      })
      .filter((x) => re.test(x));
    ok(`${name}'s Trifecta sections state no word count it has outgrown`, bad.length === 0,
       bad.join(' || ').slice(0, 220));
  }
}

ok('the rules page says you play every word',
   new RegExp(`play all ${GWORD}|plays all ${GWORD}|all ${GWORD} words whatever happens`, 'i')
     .test(text['how-to-play.html']), GWORD);
// One sentence, written out six times: once in the card's markup, three times
// as string literals in the card's branches, once in the Trifecta's intro card
// and once in the homepage blurb. Three of them carry a tail after an em-dash
// ("free account required", and the two that add "the same ten, once a day"),
// so the comparison is of the shared opening — the part that has to agree.
const cardLines = [...pages['index.html'].matchAll(// "five guesses each" is what makes this the CARD sentence rather than
// any sentence that happens to count the words: the in-app rules say
// "the identical three words, one attempt each", which is a different
// claim and has no "all three" to line up on.
  new RegExp(`${GWORD} words, five guesses each[^"<]{0,120}`, 'gi'))]
  .map((m) => m[0].split('\\u2014')[0].split('\u2014')[0])
  .map((x) => x.toLowerCase())
  .map((x) => x.slice(0, x.indexOf(`all ${GWORD}`) + `all ${GWORD}`.length))
  .map((x) => x.replace(/[.\s]+$/, '').trim());
ok('the Trifecta sentence is written in all six places', cardLines.length === 6, JSON.stringify(cardLines));
ok('and says the same thing in every one of them',
   cardLines.length > 0 && new Set(cardLines).size === 1, JSON.stringify(cardLines));

// ---- 4c. the board's tiebreak, documented because players can see it -----
const boardOrders = [...pages['index.html'].matchAll(/orderBy\("score", "desc"\), orderBy\("(\w+)", "desc"\)/g)].map((m) => m[1]);
ok('the Trifecta board breaks ties on a second key', boardOrders.length >= 2, boardOrders.join(','));
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

// ---- one palette, eight copies of it -------------------------------------
// The game page and the seven static pages are separate files served straight
// off GitHub Pages with no build step, so there is nowhere shared to put the
// palette. Eight inline copies is the cheapest honest answer — a stylesheet
// request on a page this small costs more than it saves — but eight copies
// drift. This is what stops them: change :root in index.html without copying
// it across and the build fails here rather than the About page quietly
// staying on last season's colours.
{
  const PAGES = ['index.html', 'about.html', 'faq.html', 'how-to-play.html',
                 'strategy.html', '404.html', 'privacy.html', 'terms.html'];
  const roots = {};
  for (const p of PAGES) {
    const src = fs.readFileSync(REPO(p), 'utf8').replace(/\r\n/g, '\n');
    const m = src.match(/:root \{[\s\S]*?\n        \}/);
    roots[p] = m ? m[0] : null;
    ok(`${p} declares the palette`, !!m);
  }
  // A page that carries the tokens but still paints itself with a literal is
  // the same bug wearing a disguise, so check the stylesheets are actually
  // USING them. The exceptions are deliberate and named: brand marks, and the
  // shop preview that stays black on purpose.
  const ALLOWED = /#(0a0a0a|fff|3c4043|e8eaed|0072B2|E69F00|5865F2|FF5E5B|4285F4|34A853|FBBC05|EA4335)\b/gi;

  const base = roots['index.html'];
  for (const p of PAGES.slice(1)) {
    ok(`${p}'s palette is identical to index.html's`, roots[p] === base,
       roots[p] === base ? '' : 'differs');
  }
  // The Trifecta archive is a NINTH copy, and the one that got missed: 34
  // public pages, every one of them in the sitemap, still on the dark build a
  // week after everything else moved — because this check only ever looked at
  // the hand-written pages at the repo root. They are generated, so the
  // renderer is what has to agree; the pages follow on the next daily run.
  const renderer = fs.readFileSync(REPO('tools/gauntlet-archive-render.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const rRoot = (renderer.match(/:root \{[\s\S]*?\n        \}/) || [])[0];
  ok('the Trifecta archive renderer carries the palette', !!rRoot);
  ok("and it is identical to index.html's", rRoot === base, rRoot === base ? '' : 'differs');
  {
    const style = renderer.slice(renderer.indexOf('const STYLE = `'), renderer.indexOf('`;', renderer.indexOf('const STYLE = `')));
    const afterRoot = style.slice(style.indexOf('}', style.indexOf('--c-shadow')));
    const stray = (afterRoot.replace(ALLOWED, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []);
    ok('the archive renderer paints with tokens, not literals', stray.length === 0, stray.join(' '));
    const inline = [...renderer.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';');
    const inlineStray = (inline.replace(ALLOWED, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []);
    ok('and so does the markup it writes', inlineStray.length === 0, inlineStray.join(' '));
  }
  // What actually SHIPPED, not just what the renderer would write next time.
  {
    const dirs = fs.readdirSync(REPO('gauntlet'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => `gauntlet/${d.name}/index.html`);
    const built = ['gauntlet/index.html', ...dirs].filter((f) => fs.existsSync(REPO(f)));
    ok(`found the generated archive pages (${built.length})`, built.length > 5);
    const stale = built.filter((f) => {
      const src = fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');
      return !src.includes('--c-page:') || /#121213|#b967ff|#00ffff/.test(src);
    });
    ok('every generated archive page is on the current palette', stale.length === 0,
       stale.slice(0, 3).join(' '));
  }
  for (const p of PAGES.slice(1)) {
    const src = fs.readFileSync(REPO(p), 'utf8').replace(/\r\n/g, '\n');
    const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    const afterRoot = style.slice(style.indexOf('}', style.indexOf('--c-shadow')));
    const stray = (afterRoot.replace(ALLOWED, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []);
    ok(`${p} paints with tokens, not literals`, stray.length === 0, stray.join(' '));
    // The MARKUP too, which this missed the first time round: how-to-play and
    // strategy were naming the four modes in inline cyan, magenta and neon
    // green for a week after the palette moved, because the sweep above stops
    // at </style>. An inline style is where a stale colour is likeliest to
    // survive, since nothing about it looks like a stylesheet.
    const body = src.slice(src.indexOf('<body'), src.lastIndexOf('</body>'));
    const inBody = [...body.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(';');
    const bodyStray = (inBody.replace(ALLOWED, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []);
    ok(`${p}'s markup paints with tokens too`, bodyStray.length === 0, bodyStray.join(' '));
  }
}

// ---- the copy may not name a colour the game stopped using -------------
// how-to-play labelled the two signals "Cyan" and "Magenta" for a week after
// they became blue and amber — and rendered those words in the NEW colours,
// so the page contradicted itself in the same line. The share card's alt text
// said "two cyan, one magenta" on seven pages, which is the version a screen
// reader gets.
//
// Shop cosmetics are exempt by name: Neon Cyan and Neon Magenta are items
// someone bought and they really are those colours.
{
  const GONE = /\b(cyan|magenta)\b/gi;
  for (const p of ['index.html', 'about.html', 'faq.html', 'how-to-play.html',
                   'strategy.html', '404.html', 'privacy.html', 'terms.html']) {
    const src = fs.readFileSync(REPO(p), 'utf8').replace(/\r\n/g, '\n');
    // Player-facing only: the markup and the meta descriptions, minus comments,
    // minus the class names and shop item names that legitimately say it.
    const facing = src
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/class="[^"]*"/g, '')
      .replace(/Neon (Cyan|Magenta)/g, '');
    const left = [...facing.matchAll(new RegExp('.{0,45}' + GONE.source + '.{0,45}', 'gi'))].map((m) => m[0].trim());
    ok(`${p} does not name a colour the game no longer uses`, left.length === 0,
       left.slice(0, 2).join(' | '));
  }
}

let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
