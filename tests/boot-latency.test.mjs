/*
 * How long it takes to open on the Gauntlet, measured as round trips rather
 * than guessed at.
 *
 * Opening the page as a signed-in player used to sit on a playable Stakes
 * board for seconds and then yank you to the Gauntlet. The chain was five
 * network waits, strictly serial:
 *
 *   auth -> getDoc(users/{uid}) -> refreshProfile* -> getDoc(dailyAttempts/..)
 *        -> startDailyGauntlet*                              (* Cloud Function)
 *
 * with no minInstances anywhere, so both callables could cold-start.
 *
 * Three things were wrong and all three are checked here as BEHAVIOUR, by
 * running the real extracted source against fake, instrumented clients:
 *   1. refreshProfile was awaited, putting a cold-startable callable in front
 *      of everything, though nothing below needs its answer.
 *   2. the profile read and the attempt lookup are independent — both need
 *      only the uid — and ran one after the other.
 *   3. the card read dailyAttempts and then openDailyGauntlet called
 *      startDailyGauntlet, which returns that same attempt. One of the two
 *      was redundant; the callable is idempotent, so it answers both.
 *
 * A source-level grep could not have caught any of this: every function was
 * individually correct, they were just sequenced badly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const html = fs.readFileSync(REPO('index.html'), 'utf8').replace(/\r\n/g, '\n');
const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

function between(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error(`${label}: start anchor not found`);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  if (b === -1) throw new Error(`${label}: end anchor not found`);
  return src.slice(a + startAnchor.length, b);
}

// ===== 1. the shared fetch, run for real ==================================
const fetchSrc = 'function fetchTodaysAttempt() {' + between(html, 'function fetchTodaysAttempt() {', '\n        }', 'fetchTodaysAttempt') + '\n}';
const seedSrc = 'function seedTodaysAttempt(attempt) {' + between(html, 'function seedTodaysAttempt(attempt) {', '\n        }', 'seedTodaysAttempt') + '\n}';
console.log('extracted from index.html:', (fetchSrc + seedSrc).length, 'chars');

// gateOn feeds GAUNTLET_REQUIRES_ACCOUNT, which the extracted function reads
// from its enclosing scope in index.html. Passing it in rather than hardcoding
// it is what lets both positions of the flag be tested below.
// Read out of index.html rather than restated, so this file can never test a
// gate setting different from the one that ships. The server is what actually
// enforces it, so the two are checked against each other here as well - a
// client that prompts for an account the server does not require, or the
// reverse, is the failure the paired constants exist to avoid.
const CLIENT_GATE = (/const GAUNTLET_REQUIRES_ACCOUNT = (true|false);/.exec(html) || [])[1];
const fnSrc = fs.readFileSync(REPO('functions/index.js'), 'utf8');
const SERVER_GATE = (/const GAUNTLET_REQUIRES_ACCOUNT = (true|false);/.exec(fnSrc) || [])[1];
eq('index.html states whether the Gauntlet needs an account', typeof CLIENT_GATE, 'string');
eq('functions/index.js states it too', typeof SERVER_GATE, 'string');
eq('and the two agree', CLIENT_GATE, SERVER_GATE);

const makeFetch = new Function('user', 'today', 'callResult', 'GAUNTLET_REQUIRES_ACCOUNT', `
  let calls = 0;
  const currentUser = user;
  const getTodayDateStr = () => today();
  const callStartDailyGauntlet = () => { calls++; return callResult(calls); };
  let gauntletAttemptCache = { date: null, promise: null };
  ${fetchSrc}
  ${seedSrc}
  return { fetchTodaysAttempt, seedTodaysAttempt, calls: () => calls };
`);

const ATT = { wordIndex: 0, status: 'active', score: 0, history: [{ guesses: [], solved: false }] };
const ok = () => Promise.resolve({ data: { attempt: ATT } });

// Whether a guest may play is a constant now - GAUNTLET_REQUIRES_ACCOUNT here
// and in functions/index.js, which is what actually enforces it. Both of its
// positions are pinned, because the only reason to make it a constant was that
// it is expected to be flipped back once the mode has players worth
// protecting, and a flag tested in one position is a flag that breaks in the
// other.
{
  const f = makeFetch({ uid: 'g', isAnonymous: true }, () => '2026-10-11', ok, true);
  eq('gate on: a guest gets no attempt', await f.fetchTodaysAttempt(), null);
  eq('gate on: and never calls the Gauntlet function', f.calls(), 0);
}
{
  const f = makeFetch({ uid: 'g', isAnonymous: true }, () => '2026-10-11', ok, false);
  eq('gate off: a guest gets today\'s attempt', await f.fetchTodaysAttempt(), ATT);
  eq('gate off: and does call the Gauntlet function', f.calls(), 1);
}
// Signed out entirely is not the same as a guest: there is no uid to attach an
// attempt to, so this one is refused whatever the flag says.
{
  const f = makeFetch(null, () => '2026-10-11', ok, false);
  eq('nobody signed in gets no attempt even with the gate off', await f.fetchTodaysAttempt(), null);
  eq('and calls nothing', f.calls(), 0);
}

// The whole point of sharing it: many callers, one round trip.
{
  const f = makeFetch({ uid: 'u', isAnonymous: false }, () => '2026-10-11', ok, false);
  const [a, b, c] = await Promise.all([f.fetchTodaysAttempt(), f.fetchTodaysAttempt(), f.fetchTodaysAttempt()]);
  eq('three concurrent callers share one call', f.calls(), 1);
  ck(a === b && b === c && a === ATT, 'and all get the same attempt');
  await f.fetchTodaysAttempt();
  eq('a later caller is served from cache too', f.calls(), 1);
}

// A failure must not be cached, or one flaky load poisons the whole session.
{
  let n = 0;
  const flaky = () => (++n === 1 ? Promise.reject(new Error('cold start timeout')) : Promise.resolve({ data: { attempt: ATT } }));
  const f = makeFetch({ uid: 'u', isAnonymous: false }, () => '2026-10-11', flaky, false);
  let threw = false;
  try { await f.fetchTodaysAttempt(); } catch (e) { threw = true; }
  ck(threw, 'a failed lookup rejects rather than resolving to nothing');
  eq('and the retry really goes back to the server', await f.fetchTodaysAttempt(), ATT);
  eq('which is two calls, not one cached failure', f.calls(), 2);
}

// Midnight. A cached attempt from yesterday is not today's.
{
  let day = '2026-10-11';
  const f = makeFetch({ uid: 'u', isAnonymous: false }, () => day, ok, false);
  await f.fetchTodaysAttempt();
  day = '2026-10-12';
  await f.fetchTodaysAttempt();
  eq('the cache is dropped when the day rolls over', f.calls(), 2);
}

// Coming back from a finished run repaints the card with no network at all.
{
  const f = makeFetch({ uid: 'u', isAnonymous: false }, () => '2026-10-11', ok, false);
  const finished = { status: 'finished', score: 2200, wordIndex: 7 };
  f.seedTodaysAttempt(finished);
  eq('a seeded attempt is served straight back', await f.fetchTodaysAttempt(), finished);
  eq('without calling the server', f.calls(), 0);
}

// ===== 2. the boot ordering, as a recorded trace ==========================
// The auth handler's shape, lifted whole, driven against fake clients that
// record when each request starts and finishes. This is what tells serial
// from parallel; nothing about the source text does.
const authSrc = between(html,
  'onAuthStateChanged(auth, async (user) => {\n            if (user) {\n',
  '                tryAutoJoinFromUrl();', 'auth handler');

const trace = async ({ slowProfile = 40, slowAttempt = 40, slowRefresh = 200 } = {}) => {
  const log = [];
  let now = 0;
  // A fake clock: each "request" resolves after its own cost, and we record
  // the order and the virtual time, so a serial chain and a parallel one are
  // distinguishable without sleeping for real.
  const req = (name, cost) => {
    const startedAt = now;
    log.push({ ev: name + ':start', at: startedAt });
    return new Promise((res) => setTimeout(() => { now = Math.max(now, startedAt + cost); log.push({ ev: name + ':done', at: now }); res(); }, cost / 10));
  };
  const run = new Function('req', 'log', `
    return (async () => {
      const user = { uid: 'u', isAnonymous: false };
      let currentUser = null, userProfileData = null;
      let isDailyMode = false, isVersusMode = false, isFfaMode = false, hasLanded = false;
      const document = { getElementById: () => ({ set innerText(v) {}, style: {} }) };
      const getTodayDateStr = () => '2026-10-11';
      const doc = () => ({});
      const db = {};
      const getDoc = async () => { await req('profileRead', ${slowProfile}); return { exists: () => true, data: () => ({ username: 'X', equipped: {} }) }; };
      const callRefreshProfile = async () => { await req('refreshProfile', ${slowRefresh}); return { data: { profile: { username: 'X', equipped: {} } } }; };
      const callStartDailyGauntlet = async () => { await req('startGauntlet', ${slowAttempt}); return { data: { attempt: ${JSON.stringify(ATT)} } }; };
      let gauntletAttemptCache = { date: null, promise: null };
      const GAUNTLET_REQUIRES_ACCOUNT = ${CLIENT_GATE};
      ${fetchSrc}
      const applyEquippedCosmetics = () => {};
      const refreshGauntletCard = async () => { await fetchTodaysAttempt(); log.push({ ev: 'cardPainted', at: -1 }); };
      const showStandardPanels = () => { refreshGauntletCard(); };
      ${authSrc}
      // Let anything started-but-not-awaited finish before we read the trace.
      await new Promise((r) => setTimeout(r, 120));
    })();
  `);
  await run(req, log);
  return log;
};

const log = await trace();
const order = log.map((x) => x.ev);
console.log('boot trace:', order.join(' -> '));

const startedAt = (ev) => { const e = log.find((x) => x.ev === ev + ':start'); return e ? e.at : null; };
const doneAt = (ev) => { const e = log.find((x) => x.ev === ev + ':done'); return e ? e.at : null; };

ck(order.includes('startGauntlet:start'), 'the Gauntlet attempt is fetched during boot');
ck(startedAt('startGauntlet') === 0 && startedAt('profileRead') === 0,
   'the attempt lookup and the profile read start together, not one after the other',
   `attempt@${startedAt('startGauntlet')} profile@${startedAt('profileRead')}`);
ck(doneAt('startGauntlet') <= doneAt('refreshProfile'),
   'the attempt is in hand without waiting on refreshProfile',
   `attempt done @${doneAt('startGauntlet')}, refreshProfile done @${doneAt('refreshProfile')}`);
// The regression that hurt: refreshProfile is slow and cold-startable, and
// used to gate everything after it.
const cardIdx = order.indexOf('cardPainted');
const refreshDoneIdx = order.indexOf('refreshProfile:done');
ck(cardIdx !== -1 && (refreshDoneIdx === -1 || cardIdx < refreshDoneIdx),
   'the card paints before refreshProfile has even come back', order.join(' -> '));

// Make refreshProfile pathologically slow — a cold start. Nothing else may move.
const cold = await trace({ slowRefresh: 5000 });
const coldOrder = cold.map((x) => x.ev);
ck(coldOrder.indexOf('cardPainted') < coldOrder.indexOf('refreshProfile:done') || !coldOrder.includes('refreshProfile:done'),
   'a five-second cold start on refreshProfile does not delay the Gauntlet at all', coldOrder.join(' -> '));

// Count the round trips on the critical path: auth is given, then one
// parallel pair. Five became two, and the two overlap.
const criticalDone = Math.max(doneAt('profileRead') || 0, doneAt('startGauntlet') || 0);
ck(criticalDone <= 40, 'everything the landing needs is in hand after a single round trip', String(criticalDone));

// ===== 3. the notice, which must never be able to stick ==================
const boot = between(html, 'let opensOnGauntlet = false;', '\n        }, 300);', 'boot notice');
ck(/localStorage\.getItem\(BOOT_NOTICE_KEY\)/.test(boot), 'the notice is armed from the remembered decision');
ck(/setTimeout\(clearBootNotice, \d+\)/.test(boot), 'and always has a timeout behind it');
const timeoutMs = Number((boot.match(/setTimeout\(clearBootNotice, (\d+)\)/) || [])[1]);
ck(timeoutMs > 0 && timeoutMs <= 8000, 'the fallback fires within a few seconds', String(timeoutMs));
ck(/has\("join"\)/.test(boot), 'and never shows on a tap-to-join invite, which is going somewhere else');
// Everything that settles the question must take it down.
for (const site of ['isDailyMode = true;\n            clearBootNotice();',
                    'if (target !== "gauntlet") clearBootNotice();']) {
  ck(html.replace(/\r\n/g, '\n').includes(site), `the notice is cleared at: ${site.split('\n')[0].trim()}`);
}
const land = between(html, 'function maybeLandOnGauntlet() {', '\n        }', 'maybeLandOnGauntlet');
ck(/clearBootNotice\(\)/.test(land) && /removeItem\(BOOT_NOTICE_KEY\)/.test(land),
   'deciding NOT to land takes the notice down and forgets the promise');
ck(/setItem\(BOOT_NOTICE_KEY, "gauntlet"\)/.test(land), 'and landing remembers it for next time');
ck(/style="display:none;/.test(between(html, '<div id="boot-notice"', '</div>', 'notice markup')),
   'the notice ships hidden, so a player who has never landed never sees it');

// ===== 4. a fresh day still reads as a fresh day =========================
// startDailyGauntlet CREATES the attempt, so "no document" stopped meaning
// "not started". An untouched attempt is what means it now.
const cardFn = between(html, 'async function refreshGauntletCard() {', '\n        }', 'refreshGauntletCard');
ck(!/getDoc\(doc\(db, "dailyAttempts"/.test(cardFn), 'the card no longer makes its own read');
ck(/await fetchTodaysAttempt\(\)/.test(cardFn), 'it shares the one call instead');
const untouchedSrc = 'const untouched = ' + between(cardFn, 'const untouched = ', ';\n', 'untouched');
const isUntouched = new Function('attempt', `
  const firstWord = attempt && attempt.history && attempt.history[0];
  ${untouchedSrc};
  return untouched;`);
// ...and that the branch actually consults it. Checking the predicate alone
// let a mutation through that computed `untouched` correctly and then ignored
// it — the same shape of miss as a correct function nobody calls.
ck(/if \([^)]*untouched[^)]*\)/.test(cardFn), 'the not-started branch is gated on it',
   (cardFn.match(/if \([^)]*attempt[^)]*\)/) || ['missing'])[0]);

// Same for the seed: it exists, and leaving the Gauntlet uses it.
const leaveFn = between(html, 'window.leaveDailyGauntlet = function() {', '\n        }', 'leaveDailyGauntlet');
ck(/seedTodaysAttempt\(dailyAttempt\)/.test(leaveFn),
   'leaving the Gauntlet hands the card the attempt it was just playing');
ck(leaveFn.indexOf('seedTodaysAttempt') < leaveFn.indexOf('dailyAttempt = null'),
   'and does it before clearing that attempt, or it would seed nothing');

ck(isUntouched({ status: 'active', wordIndex: 0, history: [{ guesses: [] }] }) === true,
   'a brand new attempt reads as not started');
ck(isUntouched({ status: 'active', wordIndex: 0, history: [{ guesses: [{ guess: 'CRANE' }] }] }) === false,
   'one guess in means in progress');
ck(isUntouched({ status: 'active', wordIndex: 3, history: [{ guesses: [{}] }] }) === false,
   'and so does being three words deep');
ck(isUntouched({ status: 'finished', wordIndex: 7, history: [] }) === false, 'a finished run is not "not started"');
ck(isUntouched(null) === false, 'a missing attempt is handled by the || ahead of it, not here');

let bad = 0;
for (const [okFlag, name, detail] of t) {
  if (!okFlag) bad++;
  console.log((okFlag ? 'PASS' : 'FAIL').padEnd(6) + name + (okFlag ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
