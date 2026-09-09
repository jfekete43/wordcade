import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDocs, query, orderBy, limit, where, documentId } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Resolve repo files relative to this test, so it runs from anywhere.
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const env = await initializeTestEnvironment({
  projectId: 'demo-chunk-test',
  firestore: { rules: fs.readFileSync(REPO('firestore.rules'),'utf8'), host: '127.0.0.1', port: 8080 },
});
const html = fs.readFileSync(REPO('index.html'),'utf8').replace(/\r\n/g,'\n');
const fetchSrc   = html.match(/const USER_LOOKUP_CHUNK[\s\S]*?\n        \}\n/)[0];
const resolveSrc = html.match(/if \(currentLbTime !== 'career' && currentLbTime !== 'clash' && currentLbTime !== 'ffa'\) \{\s*\n\s*const uids[\s\S]*?\n                        \}/)[0];
const dedupSrc   = html.match(/const maxLimit = \(currentLbTime[\s\S]*?\n                        \}\n/)[0];
const runPipeline = new Function('db','collection','getDocs','query','where','documentId','currentLbTime','rawData',
  `${fetchSrc}
   return (async () => { let finalData = [];
     ${resolveSrc}
     ${dedupSrc}
     return finalData; })();`);

// 75 distinct players -> forces 3 chunks (30/30/15) through the `in` filter.
// Each has TWO runs under a stale historical name, so if chunking silently
// dropped a chunk, those players would fall back to their stale names and
// show up TWICE — the exact regression we're guarding against.
const N = 75;
await env.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.firestore();
  for (let i = 0; i < N; i++) {
    await setDoc(doc(s, 'users', 'u' + i), { username: 'PLAYER' + i, equipped: { banner: 'banner_cyan', effect: 'effect_none' } });
    await setDoc(doc(s, 'runs', `r${i}a`), { uid: 'u' + i, username: 'STALE' + i, score: 1000 + i });
    await setDoc(doc(s, 'runs', `r${i}b`), { uid: 'u' + i, username: 'OLDER' + i, score: 500 + i });
  }
});
const db = env.authenticatedContext('viewer').firestore();
const snap = await getDocs(query(collection(db,'runs'), orderBy('score','desc'), limit(100)));
const rawData = []; snap.forEach(d => rawData.push({ uid:d.data().uid, name:d.data().username, score:d.data().score }));

const out = await runPipeline(db, collection, getDocs, query, where, documentId, 'all', rawData);
const names = out.map(e => e.name);
const dupes = names.filter((n,i)=>names.indexOf(n)!==i);
const stale = names.filter(n => /^(STALE|OLDER)/.test(n));

const checks = [
  [`raw set spans >30 unique players (forces chunking): ${new Set(rawData.map(r=>r.uid)).size}`, new Set(rawData.map(r=>r.uid)).size > 30],
  ['no duplicate names', dupes.length === 0, dupes.slice(0,5).join(',')],
  ['zero unresolved/stale names (every chunk resolved)', stale.length === 0, stale.slice(0,5).join(',')],
  ['every row is a live PLAYERn name', names.every(n=>/^PLAYER\d+$/.test(n)), ''],
  ['each player appears exactly once', new Set(names).size === names.length, ''],
  ['kept the higher-scoring run per player', out.every(e => e.score >= 1000), ''],
];
let failed=0;
for (const [n, ok, d] of checks) { if(!ok) failed++; console.log((ok?'PASS ':'FAIL ')+n+(ok||!d?'':'  <- '+d)); }
console.log(`\nrows rendered: ${out.length} (from ${rawData.length} raw runs across ${new Set(rawData.map(r=>r.uid)).size} players)`);
console.log(`${checks.length-failed}/${checks.length} checks passed`);
await env.cleanup();
process.exit(failed?1:0);
