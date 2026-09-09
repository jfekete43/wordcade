import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDocs, query, orderBy, limit, where, documentId } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Resolve repo files relative to this test, so it runs from anywhere.
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const env = await initializeTestEnvironment({
  projectId: 'demo-rules-test',
  firestore: { rules: fs.readFileSync(REPO('firestore.rules'),'utf8'), host: '127.0.0.1', port: 8080 },
});
// Seed past the rules (this is fixture setup, not the thing under test),
// then read as an ordinary signed-in player, exactly like the real client.
const db = env.authenticatedContext('viewer').firestore();

// ---- Pull the REAL shipped code out of index.html, don't paraphrase it ----
const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const fetchSrc = html.match(/const USER_LOOKUP_CHUNK[\s\S]*?\n        \}\n/)[0];
const resolveSrc = html.match(/if \(currentLbTime !== 'career' && currentLbTime !== 'clash' && currentLbTime !== 'ffa'\) \{\s*\n\s*const uids[\s\S]*?\n                        \}/)[0];
const dedupSrc = html.match(/const maxLimit = \(currentLbTime[\s\S]*?\n                        \}\n/)[0];
console.log('extracted from index.html: fetchUsersByIds', fetchSrc.length, 'chars | resolve', resolveSrc.length, '| dedup', dedupSrc.length);

const runPipeline = new Function('db','collection','getDocs','query','where','documentId','currentLbTime','rawData',
  `${fetchSrc}
   return (async () => {
     let finalData = [];
     ${resolveSrc}
     ${dedupSrc}
     return finalData;
   })();`);

// ---- Seed the exact bug scenario ----
// soda1: ONE player, 3 runs, each saved under a DIFFERENT historical name,
//        now called SODA. This is the case that produced SODA x3.
// thief1: ONE player, 2 runs, now called SODATHIEF.
// twinA/twinB: TWO DIFFERENT players who both currently display as TWIN.
// ghost1: a run whose user doc no longer exists (deleted account).
const users = {
  soda1:  { username: 'SODA',      equipped: { banner: 'banner_cyan',  effect: 'effect_none' } },
  thief1: { username: 'SODATHIEF', equipped: { banner: 'banner_champ', effect: 'effect_none' } },
  twinA:  { username: 'TWIN',      equipped: { banner: 'banner_grid',  effect: 'effect_none' } },
  twinB:  { username: 'TWIN',      equipped: { banner: 'banner_foil',  effect: 'effect_none' } },
};
// (seeded below, inside withSecurityRulesDisabled)

const runs = [
  { uid:'soda1',  username:'SODA_OLD',   score:380 },
  { uid:'soda1',  username:'SODA_MID',   score:200 },
  { uid:'soda1',  username:'SODA',       score:150 },
  { uid:'thief1', username:'THIEF_OLD',  score:500 },
  { uid:'thief1', username:'SODATHIEF',  score:50  },
  { uid:'twinA',  username:'TWIN',       score:900 },
  { uid:'twinB',  username:'TWIN',       score:800 },
  { uid:'ghost1', username:'GHOSTPLAYER',score:275 },
];
await env.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.firestore();
  for (const [uid, u] of Object.entries(users)) await setDoc(doc(s, 'users', uid), u);
  let i = 0;
  for (const r of runs) await setDoc(doc(s, 'runs', 'run' + (i++)), r);
});

// ---- Mirror the 'all' tab's own query, then run the real pipeline ----
const snap = await getDocs(query(collection(db, 'runs'), orderBy('score', 'desc'), limit(100)));
const rawData = [];
snap.forEach(d => rawData.push({ uid: d.data().uid, name: d.data().username, score: d.data().score }));
console.log('\nraw rows from Firestore (pre-dedup):', rawData.map(r => r.name + ':' + r.score).join(', '));

const out = await runPipeline(db, collection, getDocs, query, where, documentId, 'all', rawData);
console.log('\nRENDERED LEADERBOARD:');
out.forEach((e, idx) => console.log(`  #${idx+1} ${e.name} — ${e.score}  [uid ${e.uid}, banner ${(e.equipped||{}).banner || 'default'}]`));

// ---- Assertions ----
const names = out.map(e => (e.name||'').toUpperCase());
const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
const byName = Object.fromEntries(out.map(e => [e.name, e]));
const checks = [
  ['no duplicate names on the board',        dupes.length === 0, 'dupes: ' + dupes.join(',')],
  ['SODA appears exactly once',              names.filter(n=>n==='SODA').length === 1, ''],
  ['SODA kept its BEST run (380, not 150)',  byName.SODA?.score === 380, 'got ' + byName.SODA?.score],
  ['SODATHIEF appears exactly once',         names.filter(n=>n==='SODATHIEF').length === 1, ''],
  ['SODATHIEF kept its best (500)',          byName.SODATHIEF?.score === 500, 'got ' + byName.SODATHIEF?.score],
  ['stale historical names are gone',        !names.some(n=>n.includes('_OLD')||n.includes('_MID')), ''],
  ['two different players sharing TWIN collapse to one', names.filter(n=>n==='TWIN').length === 1, ''],
  ['deleted-account run keeps its stored name', names.includes('GHOSTPLAYER'), ''],
  ['live cosmetics applied (SODA -> banner_cyan)', byName.SODA?.equipped?.banner === 'banner_cyan', ''],
  ['ordered by score desc',                  out.every((e,idx)=>idx===0||out[idx-1].score>=e.score), ''],
];
console.log('');
let failed = 0;
for (const [name, ok, detail] of checks) { if(!ok) failed++; console.log((ok?'PASS ':'FAIL ') + name + (ok?'':'  <- '+detail)); }
console.log(`\n${checks.length-failed}/${checks.length} checks passed`);
await env.cleanup();
process.exit(failed ? 1 : 0);
