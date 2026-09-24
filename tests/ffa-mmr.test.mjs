/*
 * FFA has its own rating, and it is separate from Clash's.
 *
 * It did not used to be. onFfaMatchFinished wrote its Elo result straight
 * into `mmr` — the same field 1v1 Clash writes — so the two modes shared one
 * pooled number, and the FFA leaderboard was left with nothing of its own to
 * rank on. Ranking it by `mmr` would have rendered a second copy of the Clash
 * tab, so it ranked by raw ffaWins instead: volume, not skill. 25 wins from
 * 100 matches outranked 8 from 10.
 *
 * The thing that has to hold now is an independence property, and it is the
 * kind that regresses silently — a later edit writing `mmr` here again would
 * still pay out, still move a rating, still look right on screen, and would
 * quietly put Clash results back into the FFA ladder. So this runs the REAL
 * payout body extracted from functions/index.js against fake transaction
 * handles and asserts on exactly which fields it touched.
 *
 * Pure; no emulator needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

// The payout/rating body of onFfaMatchFinished, verbatim.
const payoutBody = grab(fn, /    const players = slots\.map\(\(s, i\) => \(\{ uid: s\.uid[\s\S]*?\n    tx\.update\(matchRef, \{ changes, payoutApplied: true \}\);/, 'payout body');
const deps = [
  grab(fn, /const FFA_MAX_PLAYERS = \d+;/, 'FFA_MAX_PLAYERS'),
  grab(fn, /const FFA_PAYOUT_CURVES = \{[\s\S]*?\n\};/, 'payout curves'),
  grab(fn, /const FFA_BASE_MMR = \d+;/, 'FFA_BASE_MMR'),
  grab(fn, /function ffaRating\(userData\) \{\n[\s\S]*?\n\}/, 'ffaRating'),
  grab(fn, /function ffaSlots\(match\) \{\n[\s\S]*?\n\}/, 'ffaSlots'),
  grab(fn, /function eloExpected\(myMMR, opponentMMR\) \{\n[\s\S]*?\n\}/, 'eloExpected'),
  grab(fn, /function computeFfaPlacements\(players, leftPlayers = \[\]\) \{\n[\s\S]*?\n\}/, 'computeFfaPlacements'),
  grab(fn, /function computeFfaEloDeltas\(players, leftPlayers = \[\]\) \{\n[\s\S]*?\n\}/, 'computeFfaEloDeltas'),
  grab(fn, /function computeFfaOutcome\(players, leftPlayers = \[\]\) \{\n[\s\S]*?\n\}/, 'computeFfaOutcome'),
].join('\n\n');
console.log('extracted from functions/index.js:', (deps + payoutBody).length, 'chars');

// A FieldValue.increment stand-in that stays inspectable.
const FieldValue = { increment: (by) => ({ __increment: by }) };

const runPayout = (match, userDocs) => {
  const writes = {};                       // uid -> update object
  let matchWrite = null;
  const tx = {
    update: (ref, data) => { if (ref.__match) matchWrite = data; else writes[ref.__uid] = data; },
  };
  const matchRef = { __match: true };
  const after = match;
  const slotsFn = new Function('match', `${deps}\nreturn ffaSlots(match);`);
  const slots = slotsFn(match);
  const userRefs = slots.map((s) => ({ __uid: s.uid }));
  const userSnaps = slots.map((s) => ({ data: () => userDocs[s.uid] }));
  const body = new Function(
    'slots', 'userSnaps', 'userRefs', 'after', 'tx', 'matchRef', 'FieldValue',
    `${deps}\n${payoutBody}`);
  body(slots, userSnaps, userRefs, after, tx, matchRef, FieldValue);
  return { writes, matchWrite };
};

const t = [];
const ok = (name, cond, detail = '') => t.push({ name, cond, detail });
// Reading a field off a player the code never wrote should report a failed
// case, not throw a stack trace three assertions early.
const paid = (w, uid) => (w[uid] && w[uid].wallet) ? w[uid].wallet.__increment : 0;
const rated = (w, uid) => (w[uid] && typeof w[uid].ffaMmr === 'number') ? w[uid].ffaMmr : null;

const publicMatch = {
  mode: 'ffa', isPublic: true, leftPlayers: [],
  p0Uid: 'a', p0Score: 900, p0Name: 'A',
  p1Uid: 'b', p1Score: 400, p1Name: 'B',
};

// --- 1. the rating that moves is ffaMmr, and mmr is not touched ------------
let r = runPayout(publicMatch, { a: { mmr: 1500, ffaMmr: 1000 }, b: { mmr: 900, ffaMmr: 1000 } });
ok('the winner gets an ffaMmr write', typeof r.writes.a.ffaMmr === 'number', JSON.stringify(r.writes.a));
ok('no write touches Clash mmr', !('mmr' in r.writes.a) && !('mmr' in r.writes.b),
   Object.keys(r.writes.a).join(',') + ' | ' + Object.keys(r.writes.b).join(','));
ok('the winner gains rating', r.writes.a.ffaMmr > 1000, String(r.writes.a.ffaMmr));
ok('the loser loses rating', r.writes.b.ffaMmr < 1000, String(r.writes.b.ffaMmr));
ok('matches played still increments', r.writes.a.ffaMatchesPlayed.__increment === 1);
ok('the winner banks a win', r.writes.a.ffaWins.__increment === 1);
ok('the loser banks no win', !('ffaWins' in r.writes.b));

// --- 2. the Elo reads ffaMmr, not mmr -------------------------------------
// Both players sit at 1000 FFA but a mile apart on Clash. If the Elo were
// reading `mmr`, the heavy Clash favourite beating the underdog would gain
// almost nothing; on an even FFA ladder it takes the full swing.
const even = runPayout(publicMatch, { a: { mmr: 2400, ffaMmr: 1000 }, b: { mmr: 200, ffaMmr: 1000 } });
const skewed = runPayout(publicMatch, { a: { mmr: 1000, ffaMmr: 2400 }, b: { mmr: 1000, ffaMmr: 200 } });
ok('an even FFA ladder pays the full swing', even.writes.a.ffaMmr - 1000 === 16, String(even.writes.a.ffaMmr - 1000));
ok('Clash rating has no say in it', even.writes.a.ffaMmr - 1000 === 16 && skewed.writes.a.ffaMmr - 2400 < 2,
   `even +${even.writes.a.ffaMmr - 1000}, skewed +${skewed.writes.a.ffaMmr - 2400}`);

// --- 3. a player with no ffaMmr yet starts at the base, not at their mmr ---
r = runPayout(publicMatch, { a: { mmr: 2400 }, b: { mmr: 2400 } });
ok('an unrated player is seeded at 1000, not from mmr', r.writes.a.ffaMmr === 1016, String(r.writes.a.ffaMmr));
ok('and their opponent likewise', r.writes.b.ffaMmr === 984, String(r.writes.b.ffaMmr));

// --- 4. private matches pay out but never move the rating -----------------
r = runPayout({ ...publicMatch, isPublic: false }, { a: { ffaMmr: 1000 }, b: { ffaMmr: 1000 } });
ok('a private match leaves the rating flat', r.writes.a.ffaMmr === 1000 && r.writes.b.ffaMmr === 1000,
   `${r.writes.a.ffaMmr}/${r.writes.b.ffaMmr}`);
ok('a private match still pays the winner', r.writes.a.wallet.__increment === 1000, JSON.stringify(r.writes.a.wallet));
ok('a private match still never touches mmr', !('mmr' in r.writes.a));

// --- 5. rating can't go negative ------------------------------------------
r = runPayout(publicMatch, { a: { ffaMmr: 5 }, b: { ffaMmr: 5 } });
ok('a rating floors at zero', r.writes.b.ffaMmr === 0, String(r.writes.b.ffaMmr));

// --- 6. four players, one leaver: placement still drives the rating -------
r = runPayout({
  mode: 'ffa', isPublic: true, leftPlayers: ['d'],
  p0Uid: 'a', p0Score: 100, p1Uid: 'b', p1Score: 90, p2Uid: 'c', p2Score: 80, p3Uid: 'd', p3Score: 9999,
}, { a: { ffaMmr: 1000 }, b: { ffaMmr: 1000 }, c: { ffaMmr: 1000 }, d: { ffaMmr: 1000 } });
ok('all four get a rating write', ['a', 'b', 'c', 'd'].every(u => typeof r.writes[u].ffaMmr === 'number'));
ok('nobody gets an mmr write', ['a', 'b', 'c', 'd'].every(u => !('mmr' in r.writes[u])));
ok('the leaver loses most despite the top score', r.writes.d.ffaMmr === Math.min(...['a','b','c','d'].map(u => r.writes[u].ffaMmr)),
   ['a','b','c','d'].map(u => `${u}:${r.writes[u].ffaMmr}`).join(' '));
ok('the match doc is marked applied', r.matchWrite.payoutApplied === true);

// --- 6b. a six-player match: every slot rated, nobody's mmr touched -------
r = runPayout({
  mode: 'ffa', isPublic: true, leftPlayers: [],
  p0Uid: 'a', p0Score: 600, p1Uid: 'b', p1Score: 500, p2Uid: 'c', p2Score: 400,
  p3Uid: 'd', p3Score: 300, p4Uid: 'e', p4Score: 200, p5Uid: 'f', p5Score: 100,
}, Object.fromEntries('abcdef'.split('').map(u => [u, { ffaMmr: 1000, mmr: 1500 }])));
const six = 'abcdef'.split('');
ok('all six slots are read and written', six.every(u => rated(r.writes, u) !== null),
   six.map(u => rated(r.writes, u)).join(','));
ok('no sixth-slot write leaks into mmr', six.every(u => r.writes[u] && !('mmr' in r.writes[u])));
// The whole point of the field-size question: placement in a big field has
// to be worth more than the same placement in a small one.
const secondOfSix = (rated(r.writes, 'b') ?? 1000) - 1000;
const three = runPayout({ mode: 'ffa', isPublic: true, leftPlayers: [],
  p0Uid: 'a', p0Score: 300, p1Uid: 'b', p1Score: 200, p2Uid: 'c', p2Score: 100 },
  { a: { ffaMmr: 1000 }, b: { ffaMmr: 1000 }, c: { ffaMmr: 1000 } });
const secondOfThree = (rated(three.writes, 'b') ?? 1000) - 1000;
ok('2nd of 6 gains, 2nd of 3 does not', secondOfSix > 0 && secondOfThree === 0,
   `2nd/6 = ${secondOfSix >= 0 ? '+' : ''}${secondOfSix}, 2nd/3 = ${secondOfThree >= 0 ? '+' : ''}${secondOfThree}`);
ok('last place loses the most in both', rated(r.writes, 'f') < rated(r.writes, 'e')
   && rated(three.writes, 'c') < rated(three.writes, 'b'),
   `6p ${rated(r.writes,'f')}<${rated(r.writes,'e')}, 3p ${rated(three.writes,'c')}<${rated(three.writes,'b')}`);
// Only last place earns nothing at six, rather than a crowd of them.
ok('five of six are paid at 6p', six.filter(u => paid(r.writes, u) > 0).length === 5,
   six.map(u => paid(r.writes, u)).join(','));
ok('1st-4th pay the same at 6p as at 4p',
   [1000, 500, 200, 100].every((v, i) => paid(r.writes, six[i]) === v),
   six.slice(0, 4).map(u => paid(r.writes, u)).join(','));

// --- 7. 1v1 Clash is untouched by all of this ------------------------------
const clashPayout = grab(fn, /    const hostUpdate = \{ mmr: newHostMmr \};\n    const guestUpdate = \{ mmr: newGuestMmr \};/, 'clash update');
ok('Clash still writes mmr', clashPayout.includes('mmr: newHostMmr'), clashPayout.split('\n')[0].trim());
ok('Clash never writes ffaMmr', !clashPayout.includes('ffaMmr'));
ok('ffaMmr is written in exactly one place', (fn.match(/ffaMmr:/g) || []).length === 1,
   String((fn.match(/ffaMmr:/g) || []).length));

// --- 8. the client reads the same ladder ----------------------------------
ok('the FFA board orders by ffaMmr', /currentLbTime === 'ffa'[\s\S]{0,1200}?orderBy\("ffaMmr", "desc"\)/.test(html));
ok('the FFA board no longer orders by ffaWins', !html.includes('orderBy("ffaWins"'));
ok('your-rank counts against ffaMmr', /ffa:\s*\{ field: "ffaMmr"/.test(html));
ok('your-rank excludes players with no rating', /ffa:\s*\{ field: "ffaMmr",[^}]*excludesUnset: true/.test(html));
ok('Clash your-rank does NOT exclude unset', /clash:\s*\{ field: "mmr",[^}]*excludesUnset: false/.test(html));
ok('the rank count takes the field as an argument', /async function getPlayerRank\(rating, type, field\)[\s\S]{0,400}?where\(field, ">", rating\)/.test(html));
ok('the Clash tab counts against mmr', html.includes("getPlayerRank(currentMMR, 'clash', 'mmr')"));
ok('the FFA tab counts against ffaMmr', html.includes("getPlayerRank(rawFfaMmr, 'ffa', 'ffaMmr')"));
// The versus screen ranks both players at once, so host/guest keep cache
// slots of their own — but every call site must now name its ladder.
ok('every rank call names its ladder', [...html.matchAll(/getPlayerRank\(([^)]*)\)/g)]
   .every(m => m[1].split(',').length === 3),
   [...html.matchAll(/getPlayerRank\(([^)]*)\)/g)].map(m => m[1]).join(' | '));
ok('the versus screen ranks against mmr, not ffaMmr',
   (html.match(/getPlayerRank\(data\.(host|guest)MMR \|\| 1000, '(host|guest)', 'mmr'\)/g) || []).length === 2);
ok('every cache slot used is declared', [...html.matchAll(/getPlayerRank\([^,]*, '(\w+)'/g)]
   .every(m => new RegExp(`cachedRanks = \\{[^}]*\\b${m[1]}: null`).test(html)),
   [...html.matchAll(/getPlayerRank\([^,]*, '(\w+)'/g)].map(m => m[1]).join(','));
ok('the host seeds its slot from ffaMmr', !/newFfaMatchDoc\([^)]*userProfileData\.mmr[,)]/.test(html)
   && (html.match(/newFfaMatchDoc\([^)]*userProfileData\.ffaMmr/g) || []).length === 2,
   String((html.match(/newFfaMatchDoc\([^)]*userProfileData\.ffaMmr/g) || []).length));
ok('joining reads ffaRating server-side', fn.includes('[`p${openIdx}Mmr`]: ffaRating(userData)'));
ok('the payout reads ffaRating server-side', fn.includes('mmr: ffaRating(userSnaps[i].data())'));

// --- 9. the FFA stats tab exists and is wired -----------------------------
ok('there is an FFA profile tab button', html.includes(`id="tab-prof-ffa"`));
ok('there is an FFA profile panel', html.includes(`id="profile-ffa"`));
ok('setProfileTab knows about it', /for \(const tab of \["standard", "clash", "ffa", "gauntlet"\]\)/.test(html));
ok('an unrated player is shown Unranked, not 1000',
   /Number\.isFinite\(rawFfaMmr\)[\s\S]{0,1500}?stat-ffa-rank-title"\)\.innerText = "Unranked"/.test(html));
ok('wins and played are on the stats tab', html.includes('id="stat-ffa-wins"') && html.includes('id="stat-ffa-played"'));

let failed = 0;
for (const c of t) { if (!c.cond) failed++; console.log(`${c.cond ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`); }
console.log(`\n${t.length - failed}/${t.length} passed`);
process.exit(failed ? 1 : 0);
