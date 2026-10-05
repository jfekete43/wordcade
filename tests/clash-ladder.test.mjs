/*
 * The Clash ladder, and the reason its leaderboard used to be a list of
 * everyone who had ever signed up.
 *
 * The board is `orderBy("mmr", "desc") limit(100)`, and Firestore's orderBy
 * leaves out documents that do not carry the ordered field — which is exactly
 * how the FFA board has only ever listed players who hold an ffaMmr. Clash
 * seeded `mmr: 1000` onto every profile at creation, so every account was on
 * the ladder from the moment it existed, all tied at the base rating.
 *
 * Four halves, in the order the fix runs:
 *   1. onMatchFinished — a PUBLIC match is the only thing that writes mmr, so
 *      it is the only thing that creates the field.
 *   2. refreshProfile — takes an unearned seeded 1000 back off on sign-in.
 *   3. the emulator — the query really does exclude a doc with no mmr, AND
 *      the wall of 1000s really did push players below the base off the page.
 *   4. firestore.rules — a client may not self-seed a rating, or any other
 *      ladder field, at create.
 *
 * Both extractions below are positional (indexOf/slice between text that is
 * NOT under test), so breaking the code under test cannot silently shrink the
 * region to something that passes.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDocs, query, orderBy, limit, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const fn = fs.readFileSync(REPO('functions/index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const rules = fs.readFileSync(REPO('firestore.rules'), 'utf8').replace(/\r\n/g, '\n');
const tool = fs.readFileSync(REPO('tools/clear-unranked-clash-mmr.mjs'), 'utf8').replace(/\r\n/g, '\n');

// Slice between two anchors, neither of which is the code under test.
function between(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`${label}: start anchor not found`);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`${label}: end anchor not found`);
  return src.slice(a + startAnchor.length, b);
}

// ===== 1. onMatchFinished: who gets an mmr written at all ==================
const payoutSrc = between(fn,
  'const newGuestMmr = Math.max(0, guestMMR + guestChange);\n',
  '    tx.update(hostRef, hostUpdate);', 'payout');
console.log('extracted from onMatchFinished:', payoutSrc.length, 'chars');

const applyPayout = new Function(
  'isPublicMatch', 'isTie', 'hostWon', 'newHostMmr', 'newGuestMmr', 'hostData', 'guestData', 'FieldValue',
  `${payoutSrc}\nreturn { hostUpdate, guestUpdate };`);
const INC = (n) => `<inc:${n}>`;
const payout = (o) => applyPayout(
  o.isPublicMatch, o.isTie, o.hostWon, o.newHostMmr, o.newGuestMmr,
  o.hostData || {}, o.guestData || {}, { increment: INC });

const pub = payout({ isPublicMatch: true, isTie: false, hostWon: true, newHostMmr: 1016, newGuestMmr: 984 });
eq('a public win writes both new ratings', [pub.hostUpdate.mmr, pub.guestUpdate.mmr], [1016, 984]);

const pubTie = payout({ isPublicMatch: true, isTie: true, newHostMmr: 1000, newGuestMmr: 1000 });
// A draw moves nobody, but it is still a ranked result — writing the unchanged
// value is what MINTS the rating for a player whose first public match drew.
eq('a public draw still mints the rating for both', [pubTie.hostUpdate.mmr, pubTie.guestUpdate.mmr], [1000, 1000]);
ck('clashTies' in pubTie.hostUpdate, 'a draw still records itself on the record');

const priv = payout({ isPublicMatch: false, isTie: false, hostWon: true, newHostMmr: 1000, newGuestMmr: 1000 });
ck(!('mmr' in priv.hostUpdate) && !('mmr' in priv.guestUpdate),
   'a PRIVATE match writes no mmr at all — it would mint a rating no ranked result produced');
ck('clashWins' in priv.hostUpdate && 'wallet' in priv.hostUpdate,
   'a private match still pays out and still moves the record');
ck(Object.keys(priv.hostUpdate).length > 0 && Object.keys(priv.guestUpdate).length > 0,
   'neither private-match update is empty (update() rejects an empty object)');

const privTie = payout({ isPublicMatch: false, isTie: true, newHostMmr: 1000, newGuestMmr: 1000 });
ck(!('mmr' in privTie.hostUpdate), 'a private draw writes no mmr either');
ck(Object.keys(privTie.hostUpdate).length > 0, 'a private draw still has something to write (the tie)');

// ===== 2. refreshProfile: taking an unearned rating back off ===============
// Scoped to refreshProfile first: `const data = snap.data();` appears in four
// callables, so the start anchor is only unique inside this one.
const refreshBody = fn.slice(fn.indexOf('exports.refreshProfile = onCall('));
const refreshSrc = between(refreshBody,
  '    const updates = {};\n',
  '    // A guest who links a Google account', 'refresh');
console.log('extracted from refreshProfile:', refreshSrc.length, 'chars');

const DELETED = '<delete>';
const applyRefresh = new Function('data', 'FieldValue',
  `const updates = {};\n${refreshSrc}\nreturn { updates, clearedMmr: typeof clearedMmr === 'undefined' ? null : clearedMmr };`);
const refresh = (data) => applyRefresh(data, { delete: () => DELETED });

const fresh = refresh({});
ck(!('mmr' in fresh.updates), 'a profile with no rating is NOT seeded one (that seeding is the whole bug)');

const seeded = refresh({ mmr: 1000, clashWins: 0, clashLosses: 0, clashTies: 0 });
eq('an untouched seeded 1000 is deleted', seeded.updates.mmr, DELETED);
ck(seeded.clearedMmr === true, 'and the delete is flagged, so the returned profile can drop the key');

const legacy = refresh({ mmr: 1000 });
eq('a legacy doc with no record either loses the seeded rating', legacy.updates.mmr, DELETED);

for (const [label, rec] of [
  ['a win', { clashWins: 1 }], ['a loss', { clashLosses: 1 }], ['a draw', { clashTies: 1 }],
]) {
  const kept = refresh({ mmr: 1000, clashWins: 0, clashLosses: 0, clashTies: 0, ...rec });
  ck(!('mmr' in kept.updates) && kept.clearedMmr === false,
     `a player with ${label} keeps their rating even sitting exactly on the base`);
}
for (const rating of [1016, 984, 0, 2300]) {
  const kept = refresh({ mmr: rating, clashWins: 0, clashLosses: 0, clashTies: 0 });
  ck(!('mmr' in kept.updates), `a rating of ${rating} is never touched — only an untouched 1000 goes`);
}
const refreshed = refresh({ mmr: 1000, clashWins: 0, clashLosses: 0, clashTies: 0 });
ck(refreshed.updates.clashWins === undefined,
   'the legacy clash-counter backfill no longer hangs off mmr being unset');
eq('a doc missing the counters still gets them', refresh({}).updates.clashWins, 0);

// The returned profile must not carry the delete sentinel — it is a transform,
// not a value, and `data.mmr || 1000` would read it as a present rating.
const returnSrc = between(fn,
  'if (Object.keys(updates).length > 0) tx.update(userRef, updates);',
  '\n  });\n});', 'return');
const buildProfile = new Function('data', 'updates', 'clearedMmr',
  returnSrc.replace(/^\s*return \{ profile \};\s*$/m, 'return profile;'));
const out = buildProfile({ mmr: 1000, username: 'NEWBIE' }, { mmr: DELETED }, true);
ck(!('mmr' in out), 'the profile handed back to the client has no mmr key, not a sentinel under it');
const kept2 = buildProfile({ mmr: 1200, username: 'VORTEX' }, {}, false);
eq('a real rating survives the same path', kept2.mmr, 1200);

// ===== 3. the client ========================================================
// The seed object, sliced by brace counting so a change inside it cannot make
// the region shrink past the field this asserts about.
const seedStart = html.indexOf('userProfileData = {', html.indexOf('if (!docSnap.exists())'));
ck(seedStart !== -1, 'found the new-profile seed');
let depth = 0, seedEnd = seedStart;
for (let i = html.indexOf('{', seedStart); i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}' && --depth === 0) { seedEnd = i + 1; break; }
}
const seedSrc = html.slice(seedStart, seedEnd);
ck(seedSrc.length > 600, 'the seed slice is the whole object, not a fragment');
ck(!/(^|[\s,{])mmr\s*:/.test(seedSrc), 'the new-profile seed no longer ships a starting mmr');
ck(/clashWins:\s*0/.test(seedSrc) && /clashTies:\s*0/.test(seedSrc),
   'the Clash record counters DO still start at zero (they are what proves nobody has played)');

// The your-rank line under the board. Sliced from the table, then read as data.
const boardTable = between(html, 'const USERS_BOARD = {', '\n                };', 'USERS_BOARD');
const clashRow = boardTable.split('\n').find((l) => /^\s*clash:/.test(l));
ck(!!clashRow, 'found the Clash row of USERS_BOARD');
ck(/excludesUnset:\s*true/.test(clashRow || ''),
   'an unset mmr is treated as absent from the board, not as a rating of 1000');
ck(/empty:\s*"[^"]*Clash[^"]*"/.test(clashRow || ''),
   'and the empty state says how to get onto the ladder');
const ffaRow = boardTable.split('\n').find((l) => /^\s*ffa:/.test(l));
ck(/excludesUnset:\s*true/.test(ffaRow || ''), 'FFA, which always worked this way, still does');

// The profile panel. An unranked player must not be shown a position.
const panel = between(html, '// clash (UPDATED WITH GLOBAL RANK)', '// ffa — its own ladder', 'clash panel');
ck(/Number\.isFinite\(rawMmr\)/.test(panel), 'the panel distinguishes an unset rating from the base one');
ck(/Unranked/.test(panel), 'and says Unranked rather than inventing a rank');
ck(panel.indexOf('getPlayerRank') > panel.indexOf('if (hasMmr)'),
   'the rank lookup only runs for a player who actually holds a rating');
ck(/stat-clash-note/.test(panel) && /id="stat-clash-note"/.test(html),
   'the note element it writes into exists in the markup');

// ===== 4. the one-shot sweep ================================================
const sweepSrc = between(tool,
  'console.log(`${snap.size} profile(s) sitting on the base rating`);',
  'console.log(`${played} of them', 'sweep');
const sweep = new Function('docs', `
  const snap = { docs };
  ${sweepSrc}
  return { clear, played };`);
const fake = (uid, u) => ({ id: uid, ref: uid, data: () => u });
// ONE match has to be enough to keep a rating — the boundary is zero, not
// "a few". Without these three single-match rows a `matches > 1` cut-off
// passes every other fixture here.
const swept = sweep([
  fake('never', { clashWins: 0, clashLosses: 0, clashTies: 0 }),
  fake('legacy', {}),
  fake('oneWin', { clashWins: 1, clashLosses: 0, clashTies: 0 }),
  fake('oneLoss', { clashWins: 0, clashLosses: 1, clashTies: 0 }),
  fake('oneTie', { clashWins: 0, clashLosses: 0, clashTies: 1 }),
  fake('won', { clashWins: 3, clashLosses: 1, clashTies: 0 }),
  fake('drew', { clashTies: 2 }),
  fake('lost', { clashLosses: 5 }),
]);
eq('the sweep clears exactly the accounts with no Clash record', swept.clear, ['never', 'legacy']);
eq('and leaves everyone who has played, down to a single match', swept.played, 6);
ck(/where\("mmr", "==", 1000\)/.test(tool),
   'it only ever looks at the base rating, so no earned rating is in range to begin with');

// ===== 5. the emulator: the query, and the bug it had =======================
const env = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: { rules: rules, host: '127.0.0.1', port: 8080 },
});
const db = env.authenticatedContext('me').firestore();

// One player above the base, one below, and a hundred accounts that never
// played — the shape the live board was actually in.
await env.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.firestore();
  await setDoc(doc(s, 'users', 'top'), { username: 'VORTEX', mmr: 1240, clashWins: 9 });
  await setDoc(doc(s, 'users', 'low'), { username: 'PIXEL', mmr: 902, clashLosses: 6 });
  for (let i = 0; i < 100; i++) {
    await setDoc(doc(s, 'users', 'ghost' + i), { username: 'G_' + i, clashWins: 0, clashLosses: 0, clashTies: 0 });
  }
});

const clashBoard = async () => {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('mmr', 'desc'), limit(100)));
  const rows = [];
  snap.forEach((d) => rows.push(d.id));
  return rows;
};

eq('the board is the players who have a rating, and nobody else', await clashBoard(), ['top', 'low']);

// Now give the hundred ghosts the rating the old code seeded them with, and
// watch what it does to the same query. This is the part that is not cosmetic:
// the base-rating block fills the page from the top down.
await env.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.firestore();
  for (let i = 0; i < 100; i++) {
    await setDoc(doc(s, 'users', 'ghost' + i), { mmr: 1000 }, { merge: true });
  }
});
const seededBoard = await clashBoard();
eq('with the old seed the page is full', seededBoard.length, 100);
ck(seededBoard.filter((id) => id.startsWith('ghost')).length === 99,
   '99 of the 100 rows are accounts that never played a match');
ck(!seededBoard.includes('low'),
   'and a real player who dropped below the base rating is pushed off the board entirely');
ck(seededBoard[0] === 'top', 'the one player above the base still shows (the block only buries what is under it)');

// ===== 6. the create rule ===================================================
const UID = 'newplayer';
const SEED = {
  username: 'NEWBIE', isGuest: true, careerBank: 0, wallet: 0, handleChanges: 0,
  totalWordsGuessed: 0, wordsPlayed: 0, guess1: 0, guess2: 0, guess3: 0, guess4: 0, guess5: 0,
  fails: 0, achievedTop10Daily: 0, kobeCount: 0,
  clashWins: 0, clashLosses: 0, clashTies: 0, clashPucks: 0,
  loginStreak: 0, bestLoginStreak: 0, lastLoginDate: null,
  currentClashWinStreak: 0, bestClashWinStreak: 0, bestNoMissStreak: 0,
  inventory: ['title_none', 'skin_default', 'banner_default', 'effect_none'],
  equipped: { title: 'title_none', skin: 'skin_default', banner: 'banner_default', effect: 'effect_none' },
  claimedCareer: [], dailyStats: { date: '2026-10-05', played: 0, guessed: 0, guess1: 0, guess5: 0, claimed: [], activeIds: ['a'] },
};
const create = async (name, shouldPass, over = {}, uid = UID) => {
  const ref = doc(env.authenticatedContext(uid).firestore(), 'users', uid);
  try {
    await (shouldPass ? assertSucceeds(setDoc(ref, { ...SEED, ...over })) : assertFails(setDoc(ref, { ...SEED, ...over })));
    ck(true, name);
  } catch (e) { ck(false, name, (e.message || '').slice(0, 110)); }
};

await create('a profile with no rating at all is creatable (what the app sends now)', true, {}, 'n1');
// A cached older copy of index.html still sends the old seed. Rejecting it
// would mean sign-up silently failing for anyone who had not reloaded.
await create('the old 1000 seed is still accepted, for clients on a cached page', true, { mmr: 1000 }, 'n2');
await create('a self-chosen starting rating is not', false, { mmr: 2500 }, 'n3');
await create('nor is a sneaky one just above the base', false, { mmr: 1001 }, 'n4');
await create('nor is a negative one', false, { mmr: -5 }, 'n5');
// These were unconstrained: create is the one profile write a client makes
// that is not narrowed to `equipped`, so a brand new account could have
// arrived already holding the top of a board.
await create('a self-seeded all-time best is rejected', false, { bestRunScore: 9999999 }, 'n6');
await create('a self-seeded all-time timestamp is rejected', false, { bestRunAt: new Date() }, 'n7');
await create('a self-seeded weekly best is rejected', false, { periodBestScore: 9999999, periodBestKey: '2026-10-05' }, 'n8');
await create('a self-seeded daily best is rejected', false, { dayBestScore: 9999999, dayBestKey: '2026-10-05' }, 'n9');
await create('a self-seeded FFA rating is rejected', false, { ffaMmr: 4000 }, 'n10');
await create('a self-seeded FFA record is rejected', false, { ffaWins: 500, ffaMatchesPlayed: 500 }, 'n11');
await create('a self-seeded top-10 Gauntlet claim is rejected', false, { achievedTop10Daily: 1 }, 'n12');
// The guards that were already there must still hold.
await create('a pre-loaded wallet is still rejected', false, { wallet: 1000000 }, 'n13');
await create('a pre-loaded Clash record is still rejected', false, { clashWins: 99 }, 'n14');
// Every check above writes to the author's own id, so this is the one that
// proves the new guards were added to an owner-scoped rule and not in place
// of it.
try {
  await assertFails(setDoc(doc(env.authenticatedContext('n15').firestore(), 'users', 'somebodyelse'), SEED));
  ck(true, 'someone else\'s profile is still not yours to create');
} catch (e) { ck(false, 'someone else\'s profile is still not yours to create', (e.message || '').slice(0, 110)); }

await env.cleanup();
let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
