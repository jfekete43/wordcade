/*
 * The challenge table — both halves of it, and the stats behind it.
 *
 * Three things have gone wrong here, and all three were invisible from the
 * screen that shows them:
 *
 *   TWO DAILY CHALLENGES WERE IMPOSSIBLE. onRunCreated writes dailyStats as a
 *   WHOLE OBJECT, and that object carried played/guessed/guess1/guess5 and
 *   nothing else. Double Tap reads guess2 and Down to the Wire reads guess4,
 *   so both sat at 0 forever and claimChallenge refused them every time. Two
 *   of the seven in the rotation, since the day they were written.
 *
 *   FOUR CAREER CHALLENGES NAMED A CLOSED MODE. FFA is hidden, so its four
 *   rows were 0/10 on every profile that had never been able to play it.
 *
 *   A DAILY CHALLENGE WAS NAMED AFTER A MODE it has nothing to do with
 *   ("Daily Marathon", for playing 30 words in any mode).
 *
 * So: the two tables are held together, every field is checked against the
 * code that writes it, and the prose is checked against the mode table.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const fn = read('functions/index.js');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`no start anchor: ${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`end anchor is not after the start: ${to}`);
  return src.slice(a, b);
};

// ---- both halves, lifted ---------------------------------------------------
const clientTbl = between(html, 'const CHALLENGES = {', '\n            };');
const serverTbl = between(fn, 'const CHALLENGES = {', '\n};');
const poolOf = (src, key, re) => {
  const seg = between(src, `${key}: [`, '\n  ],\n'.trim().slice(0, 3)) || src;
  return seg;
};
const clientRows = (poolSrc) => [...poolSrc.matchAll(
  /\{ id: "(\w+)",(?: mode: "(\w+)",)? name: "([^"]*)", desc: "([^"]*)", req: (\d+), field: "(\w+)", reward: (\d+) \}/g)]
  .map((m) => ({ id: m[1], mode: m[2] || null, name: m[3], desc: m[4], req: +m[5], field: m[6], reward: +m[7] }));
const serverRows = (poolSrc) => [...poolSrc.matchAll(
  /\{ id: "(\w+)", req: (\d+), field: "(\w+)", reward: (\d+) \}/g)]
  .map((m) => ({ id: m[1], req: +m[2], field: m[3], reward: +m[4] }));

const splitPools = (tbl, head) => {
  const dAt = tbl.indexOf(`${head}daily_pool: [`);
  const cAt = tbl.indexOf(`${head}career: [`);
  if (dAt < 0 || cAt < 0 || cAt < dAt) throw new Error('could not split the pools');
  return { daily: tbl.slice(dAt, cAt), career: tbl.slice(cAt) };
};
const C = splitPools(clientTbl, '                ');
const S = splitPools(serverTbl, '  ');
const client = { daily: clientRows(C.daily), career: clientRows(C.career) };
const server = { daily: serverRows(S.daily), career: serverRows(S.career) };

ck(client.daily.length >= 7 && client.career.length >= 20, 'read the client table',
   `${client.daily.length} daily / ${client.career.length} career`);
ck(server.daily.length === client.daily.length && server.career.length === client.career.length,
   'and the server table has the same number of rows in each pool',
   `${server.daily.length}/${server.career.length} vs ${client.daily.length}/${client.career.length}`);

// ---- the two halves must agree on everything that pays out -----------------
// The client's copy decides what a player READS; the server's decides what
// they are PAID, and re-checks req and field before paying it. A row that
// disagrees is a challenge that reads one way and behaves another.
for (const pool of ['daily', 'career']) {
  eq(`${pool}: the two halves list the same ids, in the same order`,
     server[pool].map((r) => r.id), client[pool].map((r) => r.id));
  for (const c of client[pool]) {
    const s = server[pool].find((r) => r.id === c.id);
    if (!s) { ck(false, `${pool}: ${c.id} is on the server too`); continue; }
    eq(`${pool}: ${c.id} agrees on req, field and reward`,
       [s.req, s.field, s.reward], [c.req, c.field, c.reward]);
  }
}

const all = [...client.daily, ...client.career];
ck(new Set(all.map((r) => r.id)).size === all.length, 'every id is unique across both pools',
   all.map((r) => r.id).join(','));
ck(all.every((r) => r.name.trim() && r.desc.trim()), 'every challenge has a name and a sentence',
   JSON.stringify(all.filter((r) => !r.name.trim() || !r.desc.trim())));
ck(all.every((r) => r.req > 0 && r.reward > 0), 'and a requirement and a payout above zero');
ck(all.every((r) => /[.!]$/.test(r.desc)), 'every sentence is a sentence',
   JSON.stringify(all.filter((r) => !/[.!]$/.test(r.desc)).map((r) => r.desc)));

// ---- a daily field must be a counter the server actually keeps -------------
// This is the one that was missing. dailyStats is written as a whole object in
// onRunCreated, so a field absent from THAT object never exists, whatever
// freshDailyStats says — and `(daily[field] || 0) < req` then refuses the
// claim forever, with the screen showing 0 / 2 the entire time.
const freshSrc = between(fn, 'function freshDailyStats(today) {', '\n}');
const writeSrc = between(fn, '      dailyStats: {', '\n      },');
const keysOf = (src) => new Set([...src.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]));
const fresh = keysOf(freshSrc);
const written = keysOf(writeSrc);
ck(fresh.size > 5 && written.size > 5, 'read both places dailyStats is built',
   `${[...fresh].join(',')} | ${[...written].join(',')}`);
for (const r of client.daily) {
  ck(fresh.has(r.field), `${r.id}: freshDailyStats starts ${r.field} at zero`, [...fresh].join(','));
  ck(written.has(r.field), `${r.id}: and onRunCreated carries ${r.field} forward`, [...written].join(','));
}
// The reverse, loosely: a counter that is reset but never added to is dead
// weight that reads as working.
for (const k of fresh) {
  if (['date', 'claimed', 'activeIds'].includes(k)) continue;
  ck(written.has(k), `dailyStats.${k} is carried forward, not just reset`, [...written].join(','));
}

// ---- a career field must be written somewhere on the server ---------------
const writesField = (f) => new RegExp(`\\.${f}\\s*=`).test(fn) || new RegExp(`(?<![\\w.])${f}:\\s`).test(fn);
for (const r of client.career) {
  ck(writesField(r.field), `${r.id}: the server maintains ${r.field}`);
}

// ---- what counts as a sweep, and as a solve, RUN --------------------------
// The Trifecta has been ten words, then seven, then three. A sweep compared
// against a literal would have turned unwinnable or free on each of those
// days; compared against the run's own wordsPlayed it cannot. A Trifecta run
// is only written once every word has been played, so that IS the puzzle.
const sweepSrc = (fn.match(/ {4}const isGauntletSweep = [^\n]*;/) || [''])[0];
const solveSrc = (fn.match(/ {4}const isSprintSolve = [^\n]*;/) || [''])[0];
ck(sweepSrc && solveSrc, 'both day-counters are where they are expected to be',
   `${sweepSrc} | ${solveSrc}`);
ck(!/>=\s*\d/.test(sweepSrc), 'a sweep names no word count of its own', sweepSrc);
const sweep = new Function('run', 'wordsGuessed', 'wordsPlayed', `${sweepSrc}\nreturn isGauntletSweep;`);
const solve = new Function('run', 'wordsGuessed', `${solveSrc}\nreturn isSprintSolve;`);
eq('every word of three is a sweep', sweep({ mode: 'daily' }, 3, 3), true);
eq('two of three is not', sweep({ mode: 'daily' }, 2, 3), false);
eq('and ten of ten would be, whatever the count becomes next',
   sweep({ mode: 'daily' }, 10, 10), true);
eq('a run that played nothing is not a sweep', sweep({ mode: 'daily' }, 0, 0), false);
eq('and a Sprint solve is not a Trifecta sweep', sweep({ mode: 'sprint' }, 1, 1), false);
eq('a solved Sprint counts', solve({ mode: 'sprint' }, 1), true);
eq('a missed one does not', solve({ mode: 'sprint' }, 0), false);
eq('and a Trifecta is not a Sprint', solve({ mode: 'daily' }, 3), false);
// Both are one attempt a day, so the stored counter is 0 or 1 — never 2.
ck(/sprintDone: Math\.min\(1,/.test(writeSrc) && /gauntletSwept: Math\.min\(1,/.test(writeSrc),
   'neither day-counter can climb past one', writeSrc.replace(/\s+/g, ' ').slice(0, 160));

// ---- the career counters behind the new Trifecta challenges ---------------
const tricareer = between(fn, "// ---- The Trifecta's career record", '\n    }');
ck(/update\.gauntletPlayed = FieldValue\.increment\(1\)/.test(tricareer),
   'every finished Trifecta counts once', tricareer.replace(/\s+/g, ' ').slice(0, 120));
ck(/if \(isGauntletSweep\) update\.gauntletPerfect = FieldValue\.increment\(1\)/.test(tricareer),
   'and a clean one counts twice over, on its own field');
ck(/run\.mode === "daily"/.test(tricareer), 'and only a Trifecta reaches either');

// ---- the dot and the list read the same career list ----------------------
// Two call sites, checked as a pair. Today the filter cannot change what the
// DOT counts - availability is "progress > 0" and completion needs req >= 1,
// so a finished challenge is always available - which is exactly why dropping
// it from one of the two is invisible until the rule changes. Pinned here
// rather than left to the day it matters.
ck(/CHALLENGES\.career\.filter\(\(c\) => challengeAvailable\(c, p\)\)/.test(html),
   'the claimable dot counts only challenges that are on the list',
   (html.match(/const career = CHALLENGES\.career[^\n]*/) || [''])[0].trim());
ck(/CHALLENGES\.career\.filter\(c => challengeAvailable\(c, userProfileData\)\)/.test(html),
   '...and the list itself is the same filter',
   (html.match(/: CHALLENGES\.career\.filter[^\n]*/) || [''])[0].trim());
ck(client.career.every((r) => r.req >= 1),
   'and every career challenge needs at least one of something, which is what '
   + 'keeps those two in step', JSON.stringify(client.career.filter((r) => r.req < 1)));

// ---- a challenge field must not be seedable at profile creation -----------
// claimChallenge pays out against whatever the user document SAYS, and a
// client creates its own profile document. The create rule is the only thing
// between those two facts and a throwaway account that arrives already past
// the requirement — and that rule is a hand-written list, which is why it is
// derived from the challenge table here instead of trusted.
//
// Any of the three shapes counts as pinned: absent, forced to zero, or the
// zero-or-absent pair. Which one is right differs per field, because whether
// the client sends it at creation differs per field — and a cached older
// index.html sends fewer of them than the current one does.
const rules = read('firestore.rules');
const pinnedIn = (src, path, f) => new RegExp(
  `!\\('${f}' in ${path}\\)|${path}\\.${f} == (0|null|\\[\\])`).test(src);
for (const r of client.career) {
  ck(pinnedIn(rules, 'request\\.resource\\.data', r.field),
     `${r.id}: ${r.field} cannot be seeded past its requirement at sign-up`);
}
for (const r of client.daily) {
  ck(pinnedIn(rules, 'request\\.resource\\.data\\.dailyStats', r.field),
     `${r.id}: dailyStats.${r.field} cannot be seeded past its requirement at sign-up`);
}
// ...and the client's own create payload agrees with the server's fresh one,
// so a brand-new profile is not missing counters until its first run.
const createSrc = between(html, 'claimedCareer: [], dailyStats: {', '}');
for (const k of fresh) {
  if (['date', 'claimed', 'activeIds'].includes(k)) continue;
  ck(new RegExp(`\\b${k}: 0`).test(createSrc),
     `a new profile starts dailyStats.${k} at zero, like freshDailyStats does`, createSrc.slice(0, 160));
}

// ---- the prose, against the mode table -------------------------------------
const modeTbl = between(html, 'const MODES = {', '\n        };');
const MODES = Object.fromEntries([...modeTbl.matchAll(/^\s+(\w+):\s+\{ label: "([^"]+)"[^\n]*/gm)]
  .map((m) => [m[1], { label: m[2], hidden: /hidden: true/.test(m[0]) }]));
ck(Object.keys(MODES).length >= 4, 'read the mode table', Object.keys(MODES).join(','));
const hidden = Object.keys(MODES).filter((k) => MODES[k].hidden);
ck(hidden.length > 0, 'and at least one mode is closed, so the rule below is live', hidden.join(','));

for (const r of all) {
  if (!r.mode) continue;
  ck(!!MODES[r.mode], `${r.id}: its mode is one the table knows about`, String(r.mode));
}
// A challenge that NAMES a mode must be tagged with it, or closing that mode
// leaves the challenge on the list. Matched on the label, which is the word a
// player reads.
for (const r of client.career) {
  for (const [key, m] of Object.entries(MODES)) {
    const named = new RegExp(`\\b${m.label}\\b`, 'i').test(`${r.name} ${r.desc}`);
    if (!named) continue;
    ck(r.mode === key, `${r.id}: names ${m.label}, so it is tagged as that mode`, String(r.mode));
  }
}
// ...and the daily pool is drawn server-side, which cannot see MODES, so a
// closed mode must not be IN it — there is no runtime filter to fall back on.
// Both the tag and the words, because either alone would miss a row.
for (const r of client.daily) {
  for (const k of hidden) {
    ck(r.mode !== k && !new RegExp(`\\b${MODES[k].label}\\b`, 'i').test(`${r.name} ${r.desc}`),
       `${r.id}: does not send a player to ${MODES[k].label}, which is closed`, `${r.name} — ${r.desc}`);
  }
}
// A challenge NAMED after a mode it has nothing to do with sends players to
// the wrong screen. "Daily Marathon" was for playing 30 words in any mode.
for (const r of all) {
  for (const [key, m] of Object.entries(MODES)) {
    ck(!(new RegExp(`\\b${m.label}\\b`, 'i').test(r.name) && r.mode !== key),
       `${r.id}: its NAME does not borrow another mode's`, `${r.name} (mode: ${r.mode})`);
  }
}

// ---- no challenge states a word count that has moved twice ----------------
const WORDS = Number(fn.match(/const DAILY_GAUNTLET_WORD_COUNT = (\d+);/)[1]);
ck(WORDS > 0, 'read the Trifecta word count', String(WORDS));
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
for (const r of all) {
  if (!/trifecta/i.test(`${r.name} ${r.desc}`)) continue;
  const wrong = WORD.filter((w, n) => n !== WORDS && new RegExp(`\\b(${w}|${n}) words?\\b`, 'i').test(r.desc));
  ck(wrong.length === 0, `${r.id}: does not state a Trifecta word count that is not ${WORDS}`,
     `${r.desc} (${wrong.join(',')})`);
}

// ---- the new modes are actually represented -------------------------------
// The point of the exercise: Sprint had nothing at all, and the Trifecta had
// one row. Held as "at least one each" rather than a count, so adding more
// does not fail and removing the last one does.
for (const m of ['sprint', 'gauntlet']) {
  const mine = client.career.filter((r) => r.mode === m);
  ck(mine.length >= 2, `${MODES[m].label} has career challenges of its own`,
     mine.map((r) => r.id).join(',') || 'none');
}
for (const m of ['sprint', 'gauntlet']) {
  const mine = client.daily.filter((r) => new RegExp(MODES[m].label, 'i').test(`${r.name} ${r.desc}`));
  ck(mine.length >= 1, `${MODES[m].label} is in the daily rotation too`,
     mine.map((r) => r.id).join(',') || 'none');
}

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
