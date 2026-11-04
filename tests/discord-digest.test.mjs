/*
 * The daily Discord digest: yesterday's Sprint and Trifecta top ten, posted
 * to a channel through an incoming webhook.
 *
 * Three things here can go wrong quietly, and only one of them is cosmetic:
 *
 *   IT REACHES OTHER PEOPLE. Everything else this repo schedules writes to
 *   Firestore, where a bad write can be corrected. A Discord post cannot be
 *   taken back, which is why the job CLAIMS a day before posting it and why
 *   the claim is released only when the POST fails.
 *
 *   THE NAMES ARE CHOSEN BY PLAYERS. They are printed inside a code block,
 *   and a handle containing a backtick closes that block early — everything
 *   after it renders as Discord markdown, mentions included. Two locks:
 *   backticks are stripped, and the payload disables mentions outright.
 *
 *   THE NUMBER HAS TO AGREE WITH THE PLAYERS'. A digest calling yesterday
 *   Sprint #3 under a player's own share saying #2 is worse than no number,
 *   so the epochs are checked against index.html's copies.
 *
 * Pure; no emulator, no network. The formatters are lifted out of
 * functions/index.js and run, the way sprint.test.mjs lifts its helpers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const grab = (re, what) => {
  const m = fn.match(re);
  if (!m) throw new Error('could not extract ' + what + ' — the anchor moved');
  return m[0];
};

const src = [
  grab(/const DAILY_GAUNTLET_WORD_COUNT = \d+;/, 'word count'),
  grab(/const DAILY_GAUNTLET_MAX_GUESSES = \d+;/, 'max guesses'),
  grab(/const SPRINT_EPOCH = "[^"]*";/, 'SPRINT_EPOCH'),
  grab(/const TRIFECTA_EPOCH = "[^"]*";/, 'TRIFECTA_EPOCH'),
  grab(/function puzzleNumber\(dateStr, epoch\) \{\n[\s\S]*?\n\}/, 'puzzleNumber'),
  grab(/function formatClock\(ms\) \{\n[\s\S]*?\n\}/, 'formatClock'),
  grab(/function digestName\(raw, width\) \{\n[\s\S]*?\n\}/, 'digestName'),
  grab(/const digestNum = [^\n]*/, 'digestNum'),
  grab(/const DIGEST_W = \{[^\n]*\};/, 'DIGEST_W'),
  grab(/function digestHeader\(mode\) \{\n[\s\S]*?\n\}/, 'digestHeader'),
  grab(/function digestTable\(rows, mode\) \{\n[\s\S]*?\n\}/, 'digestTable'),
  grab(/function buildDigest\(\{ mode, dateStr, rows, words \}\) \{\n[\s\S]*?\n\}/, 'buildDigest'),
  grab(/function prettyDigestDate\(dateStr\) \{\n[\s\S]*?\n\}/, 'prettyDigestDate'),
  grab(/function isDiscordWebhook\(url\) \{\n[\s\S]*?\n\}/, 'isDiscordWebhook'),
].join('\n\n');
console.log('extracted from functions/index.js:', src.length, 'chars');

// eslint-disable-next-line no-new-func
const D = new Function(`${src}; return { puzzleNumber, formatClock, digestName, digestTable,
  buildDigest, prettyDigestDate, isDiscordWebhook, digestHeader, SPRINT_EPOCH, TRIFECTA_EPOCH,
  WORDS: DAILY_GAUNTLET_WORD_COUNT };`)();

const sprintRow = (username, n, elapsedMs, score) => ({
  username, score, elapsedMs, wordsGuessed: n ? 1 : 0,
  guess1: n === 1 ? 1 : 0, guess2: n === 2 ? 1 : 0, guess3: n === 3 ? 1 : 0,
  guess4: n === 4 ? 1 : 0, guess5: n === 5 ? 1 : 0,
});
const dailyRow = (username, solved, score) => ({ username, score, wordsGuessed: solved });

// ---- the numbers agree with the players' ----------------------------------
{
  const clientSprint = (html.match(/const SPRINT_EPOCH = "([^"]*)"/) || [])[1];
  const clientTrifecta = (html.match(/const TRIFECTA_EPOCH = "([^"]*)"/) || [])[1];
  ck(!!clientSprint && !!clientTrifecta, 'index.html states both epochs',
     `${clientSprint} / ${clientTrifecta}`);
  eq('the server numbers Sprints from the same day the share text does',
     D.SPRINT_EPOCH, clientSprint);
  eq('and Trifectas too', D.TRIFECTA_EPOCH, clientTrifecta);
  // tools/gauntlet-archive-render.mjs holds a third copy; gauntlet-archive-pages
  // checks that one against index.html, so all three meet through it.
  const renderer = fs.readFileSync(REPO('tools/gauntlet-archive-render.mjs'), 'utf8');
  eq('and so does the archive, which publishes the same day',
     (renderer.match(/TRIFECTA_EPOCH = "([^"]*)"/) || [])[1], clientTrifecta);
}
{
  eq('the epoch itself is #1', D.puzzleNumber(D.TRIFECTA_EPOCH, D.TRIFECTA_EPOCH), 1);
  eq('a day before it has no number', D.puzzleNumber('2026-01-01', D.TRIFECTA_EPOCH), null);
  eq('and a malformed date has none either', D.puzzleNumber('yesterday', D.TRIFECTA_EPOCH), null);
  // 2026-11-02 is the day after the clocks went back. Counting UTC midnights
  // is what keeps that from costing or gaining a day.
  eq('numbering survives a DST change',
     D.puzzleNumber('2026-11-03', '2026-10-31') - D.puzzleNumber('2026-11-01', '2026-10-31'), 2);
}

// ---- the clock matches the one on the board -------------------------------
{
  eq('under a minute reads in tenths', D.formatClock(41200), '41.2s');
  eq('over a minute reads as m:ss.t', D.formatClock(72300), '1:12.3');
  eq('a missing clock is zero, not NaN', D.formatClock(null), '0.0s');
  // Lifted from index.html rather than restated: the digest sits in a channel
  // beside screenshots of the board, and two formats is two games.
  const clientSrc = (html.match(/        function formatSprintTime\(ms\) \{\n[\s\S]*?\n        \}/) || [''])[0];
  // eslint-disable-next-line no-new-func
  const clientFmt = new Function(`${clientSrc}; return formatSprintTime;`)();
  const same = [0, 999, 41200, 59950, 60000, 72300, 611000].every((ms) => clientFmt(ms) === D.formatClock(ms));
  ck(same, 'and reads exactly as the in-game clock does',
     [0, 41200, 60000, 72300].map((ms) => `${clientFmt(ms)}|${D.formatClock(ms)}`).join(' '));
}

// ---- a player cannot break out of the code block --------------------------
{
  eq('a backtick is stripped, so the block cannot be closed early',
     D.digestName('``` @everyone', 14).trim(), '@everyone');
  eq('and so are newlines, which would forge a row',
     D.digestName('evil\n#1  me', 14).trim(), 'evil#1  me');
  eq('an empty name still occupies its column', D.digestName('', 14), 'player'.padEnd(14));
  eq('a missing name does too', D.digestName(null, 14), 'player'.padEnd(14));
  eq('and a long one is cut to the column', D.digestName('ABCDEFGHIJKLMNOPQRST', 14).length, 14);
  ck(D.digestName('ABCDEFGHIJKLMNOPQRST', 14).endsWith('…'),
     'with an ellipsis rather than a silent truncation', D.digestName('ABCDEFGHIJKLMNOPQRST', 14));

  // The second lock. Stripping backticks is what keeps the block intact;
  // this is what makes a handle of "@everyone" harmless even if it does not.
  const p = D.buildDigest({ mode: 'sprint', dateStr: '2026-11-03',
    rows: [sprintRow('@everyone', 3, 41200, 300)], words: ['SLIZZY'] });
  eq('the payload resolves no mentions at all', p.allowed_mentions, { parse: [] });
  ck(JSON.stringify(p).includes('@everyone'),
     'even though the name is printed as written', 'the name was dropped instead');
}

// ---- what a Sprint digest says --------------------------------------------
{
  const p = D.buildDigest({ mode: 'sprint', dateStr: '2026-11-03', words: ['slizzy'], rows: [
    sprintRow('CORVID', 3, 41200, 300), sprintRow('jfekete', 3, 72300, 300),
    sprintRow('quarrel', 0, 95000, 0),
  ] });
  const e = p.embeds[0];
  ck(/Lexathon Sprint #2$/.test(e.title), 'the title numbers the day', e.title);
  ck(e.description.includes('The word was **SLIZZY**'),
     'and names yesterday\'s word, which is spent', e.description.slice(0, 80));
  ck(e.url === 'https://lexathon.gg', 'the title links to the game', e.url);
  ck(e.footer.text === 'Tuesday, 3 November 2026', 'and the footer dates it', e.footer.text);
  const rows = e.description.split('\n').filter((l) => /^\s*#\d/.test(l));
  eq('one row per player', rows.length, 3);
  ck(/#1\s+CORVID\s+3\/5\s+41\.2s\s+300/.test(rows[0]), 'place, name, guesses, clock, score', rows[0]);
  ck(/X\/5/.test(rows[2]), 'and a miss reads as X rather than 0/5', rows[2]);
  // Monospace is the only thing that keeps columns under each other on a
  // phone, so the block fences are not decoration.
  eq('the standings are fenced as code', (e.description.match(/```/g) || []).length, 2);
}

// ---- what a Trifecta digest says ------------------------------------------
{
  const p = D.buildDigest({ mode: 'daily', dateStr: '2026-11-04',
    words: ['arise', 'house', 'media'],
    rows: [dailyRow('SLIZZY', 3, 1250), dailyRow('SODATHIEF', 2, 650)] });
  const e = p.embeds[0];
  ck(/Lexathon Trifecta #1$/.test(e.title), 'the title numbers the day', e.title);
  ck(e.description.includes('The words were **ARISE** · **HOUSE** · **MEDIA**'),
     'and names all of yesterday\'s words', e.description.slice(0, 110));
  const rows = e.description.split('\n').filter((l) => /^\s*#\d/.test(l));
  ck(new RegExp(`#1\\s+SLIZZY\\s+3/${D.WORDS}\\s+1,250`).test(rows[0]),
     'place, name, solved-out-of, score', rows[0]);
  ck(!/\d+\.\d+s|\d+:\d\d/.test(e.description), 'with no clock, which Trifecta does not have',
     e.description.slice(0, 200));
  // The count comes off the constant, so a four-word Trifecta cannot leave
  // the digest saying 3/3.
  ck(e.description.includes(`/${D.WORDS}`), `solved is out of ${D.WORDS}`, rows[0]);
}
{
  // A day before the epoch has no number and must not print "#null".
  const e = D.buildDigest({ mode: 'daily', dateStr: '2026-11-03', words: ['ARISE'], rows: [dailyRow('A', 1, 10)] }).embeds[0];
  ck(!/#/.test(e.title), 'an unnumbered day drops the number rather than printing null', e.title);
  ck(e.footer.text === 'Tuesday, 3 November 2026', 'and is still dated', e.footer.text);
}
{
  const e = D.buildDigest({ mode: 'sprint', dateStr: '2026-11-03', words: [], rows: [sprintRow('A', 1, 1000, 500)] }).embeds[0];
  ck(!/The word was/.test(e.description), 'a missing puzzle document drops the answer line, not the board',
     e.description.slice(0, 60));
  ck(/#1/.test(e.description), 'and the standings still print', e.description.slice(0, 120));
}

// ---- the header sits over the columns it names ---------------------------
// A monospaced table has exactly one way to look wrong, and it is this.
// Header and rows are built from one set of widths; this proves the widths
// reach both, which eyeballing a preview in a terminal does not.
const digestNameOf = (u) => String(u);
for (const [mode, rows, heads] of [
  ['sprint', [sprintRow('CORVID', 3, 41200, 300)], ['PLAYER', 'GUESS', 'TIME', 'SCORE']],
  ['daily', [dailyRow('SLIZZY', 3, 1250)], ['PLAYER', 'SOLVED', 'SCORE']],
]) {
  const head = D.digestHeader(mode);
  const row = D.digestTable(rows, mode);
  eq(`${mode}: the header is as wide as its rows`, head.length, row.length);
  // Left-aligned columns start where their header starts; right-aligned ones
  // end where their header ends. Check both edges of the line as a whole.
  ck(/^\s+PLAYER/.test(head), `${mode}: PLAYER is the first column`, head);
  const nameAt = head.indexOf('PLAYER');
  ck(row.slice(nameAt).startsWith(digestNameOf(rows[0].username)),
     `${mode}: and the name begins underneath it`, JSON.stringify(row.slice(nameAt, nameAt + 14)));
  ck(head.trimEnd().endsWith('SCORE') && /\d$/.test(row.trimEnd()),
     `${mode}: SCORE is last and its number ends the row`, `${head.slice(-10)} | ${row.slice(-10)}`);
  for (const h of heads) ck(head.includes(h), `${mode}: the header names ${h}`, head);
}
// ---- only a Discord webhook is ever posted to -----------------------------
{
  ck(D.isDiscordWebhook('https://discord.com/api/webhooks/123/abc'), 'a real webhook is accepted');
  ck(D.isDiscordWebhook('https://discordapp.com/api/webhooks/1/a'), 'and the legacy host too');
  ck(D.isDiscordWebhook('https://ptb.discord.com/api/webhooks/1/a'), 'and a subdomain');
  ck(!D.isDiscordWebhook('off'), '"off" parks a digest without deleting the secret');
  ck(!D.isDiscordWebhook(''), 'an empty secret posts nowhere');
  ck(!D.isDiscordWebhook('http://discord.com/api/webhooks/1/a'), 'plain http is refused');
  ck(!D.isDiscordWebhook('https://evil.example/api/webhooks/1/a'), 'and so is somebody else\'s host');
}

// ---- the job itself, at source --------------------------------------------
{
  const job = fn.slice(fn.indexOf('exports.postDailyDigest'), fn.indexOf('async function getOrCreateTodaysPuzzle'));
  ck(!!job && job.length < 4000, 'the job is findable', String(job.length));
  ck(/shiftDateStr\(getTodayDateStr\(\), -1\)/.test(job),
     'it posts YESTERDAY, whose board is closed and whose answers are spent', job.slice(0, 200));
  ck(/timeZone: "America\/New_York"/.test(job), 'on Eastern time, like every other schedule here');
  ck(/secrets: \[DISCORD_SPRINT_WEBHOOK, DISCORD_TRIFECTA_WEBHOOK\]/.test(job),
     'with the webhook URLs as secrets rather than constants');
  // The claim is the only thing standing between a retried schedule and two
  // identical leaderboards in the channel.
  ck(/db\.runTransaction/.test(job) && /digestPosts/.test(job),
     'a day is claimed in a transaction before it is posted', job.slice(0, 120));
  ck(job.indexOf('digestPosts') < job.indexOf('fetch('),
     'and claimed BEFORE the POST, not after it');
  // Making the claim is not the same as honouring it. Deleting this one line
  // leaves a transaction that writes a marker nothing ever reads, and the
  // retry posts the leaderboard a second time anyway.
  // [\s\S] rather than [^}]: the log line in between contains `${label}`,
  // whose closing brace ends a [^}] run before it reaches the continue.
  ck(/if \(!claimed\)[\s\S]{0,140}?continue;/.test(job),
     'and a day already claimed is skipped rather than posted again',
     (job.match(/const claimed[\s\S]{0,260}/) || [''])[0].replace(/\n\s*/g, ' ').slice(0, 170));
  ck(/claimRef\.delete\(\)/.test(job),
     'the claim is released if the post fails, so one outage is not permanent');
  ck(/if \(snap\.empty\)/.test(job), 'a day nobody played is skipped rather than posted empty');
  ck(/isDiscordWebhook\(job\.url\)/.test(job), 'and an unconfigured webhook is skipped, not posted to');
  ck(/limit\(10\)/.test(job), 'ten rows, which is what was asked for');
  ck(/orderBy\("score", "desc"\)/.test(job), 'ordered by score');
  // Each mode's tiebreak is the one its own board uses; a digest ordered
  // differently from the screen is a different leaderboard.
  ck(/tiebreak: "elapsedMs", dir: "asc"/.test(job), 'Sprint breaks ties on the clock, as its board does');
  ck(/tiebreak: "wordsGuessed", dir: "desc"/.test(job), 'and Trifecta on words solved, as its board does');
}
{
  // Both orderings need an index, and a missing one fails at run time in a
  // scheduled job nobody is watching.
  const idx = JSON.parse(fs.readFileSync(REPO('firestore.indexes.json'), 'utf8')).indexes
    .filter((i) => i.collectionGroup === 'runs')
    .map((i) => i.fields.map((f) => `${f.fieldPath}:${f.order}`).join(','));
  ck(idx.includes('mode:ASCENDING,puzzleDate:ASCENDING,score:DESCENDING,elapsedMs:ASCENDING'),
     'the Sprint digest query has an index', idx.join(' | '));
  ck(idx.includes('mode:ASCENDING,puzzleDate:ASCENDING,score:DESCENDING,wordsGuessed:DESCENDING'),
     'and so does the Trifecta one', idx.join(' | '));
}
{
  ck(/match \/digestPosts\/\{id\} \{\s*\n\s*allow read, write: if false;/.test(rules),
     'and no client can read, forge or delete a posted-marker');
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
