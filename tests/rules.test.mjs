import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp, setLogLevel } from 'firebase/firestore';
// The denial tests below deliberately trigger PERMISSION_DENIED; without
// this the SDK logs a wall of red for every expected failure.
setLogLevel('silent');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Resolve repo files relative to this test, so it runs from anywhere.
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const env = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: { rules: fs.readFileSync(REPO('firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
});

const UID = 'player1';
const GOOD_EQ = { title: 'title_none', skin: 'skin_default', banner: 'banner_default', effect: 'effect_none' };
const EVIL   = { title: 'title_none', skin: 'skin_default', banner: 'x"><img src=x onerror=alert(1)>', effect: 'effect_none' };

// Seed a profile doc bypassing rules.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users', UID), { wallet: 0, careerBank: 0, mmr: 1000, equipped: GOOD_EQ });
  await setDoc(doc(ctx.firestore(), 'users', 'legacy'), { wallet: 0, equipped: { banner: 'banner_cyan' } }); // partial loadout
});

const db = env.authenticatedContext(UID).firestore();
const legacyDb = env.authenticatedContext('legacy').firestore();

const run = (over = {}) => ({
  uid: UID, username: 'SODA', score: 500, isWipeout: false, lostScore: 0,
  wordsGuessed: 3, wordsPlayed: 3, guess1: 1, guess2: 1, guess3: 1, guess4: 0, guess5: 0,
  fails: 0, kobeCount: 0, bestStreak: 3, equipped: GOOD_EQ, timestamp: serverTimestamp(), ...over,
});

const results = [];
async function check(name, shouldPass, op) {
  try { await (shouldPass ? assertSucceeds(op()) : assertFails(op())); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name + ' :: ' + (e.message || '').slice(0, 110)]); }
}

// --- legitimate traffic must still work ---
await check('equip a real cosmetic', true, () => updateDoc(doc(db, 'users', UID), { equipped: { ...GOOD_EQ, banner: 'banner_cyan' } }));
await check('legacy partial loadout still equippable', true, () => updateDoc(doc(legacyDb, 'users', 'legacy'), { equipped: { banner: 'banner_matrix' } }));
await check('normal run save', true, () => addDoc(collection(db, 'runs'), run()));
await check('run w/ accented Google-style name', true, () => addDoc(collection(db, 'runs'), run({ username: 'JOSÉ' })));

// --- the XSS vectors must be blocked ---
await check('equipped w/ markup payload', false, () => updateDoc(doc(db, 'users', UID), { equipped: EVIL }));
await check('run w/ markup in username', false, () => addDoc(collection(db, 'runs'), run({ username: '<img src=x onerror=alert(1)>' })));
await check('run w/ markup in equipped', false, () => addDoc(collection(db, 'runs'), run({ equipped: EVIL })));
await check('equipped w/ unknown extra key', false, () => updateDoc(doc(db, 'users', UID), { equipped: { ...GOOD_EQ, evil: 'x' } }));
await check('equipped value not a string', false, () => updateDoc(doc(db, 'users', UID), { equipped: { ...GOOD_EQ, banner: 123 } }));
await check('run w/ 200-char username', false, () => addDoc(collection(db, 'runs'), run({ username: 'A'.repeat(200) })));
// --- pre-existing protections must not have regressed ---
await check('cannot write wallet directly', false, () => updateDoc(doc(db, 'users', UID), { wallet: 999999 }));

for (const [s, n] of results) console.log(s.padEnd(5), n);
console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' checks passed');
await env.cleanup();
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
