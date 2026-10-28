/*
 * What a failing callable says to the person who tripped it.
 *
 * This exists because of a real dialog on a real phone: tapping DAILY
 * produced an alert reading, in full, "internal". That is what the Firebase
 * client SDK surfaces when a callable throws anything that is not an
 * HttpsError — there is no message to show, so it shows the code. The player
 * learns nothing, and neither does anyone else: the real error is in Cloud
 * Logging and nowhere a person would look without being told to.
 *
 * functions/index.js cannot be imported here — it calls initializeApp() at
 * module load and expects admin credentials — so the wrapper's SOURCE is
 * lifted out of the file and evaluated against a stub HttpsError. That runs
 * the shipped code rather than a copy of it, which is the only version worth
 * testing: a re-implementation would pass forever while the real one rotted.
 *
 * Needs neither the emulator nor a browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);

const src = fs.readFileSync(REPO('functions/index.js'), 'utf8');

const t = [];
const ck = (ok, name, detail = '') => t.push([ok, name, detail]);

// ---- lift the real wrapper out of the real file ---------------------------
// The outer function's closing brace is the only one in column zero between
// here and the next top-level statement.
const lifted = (src.match(/function readableFailures\([\s\S]*?\n\}\n/) || [])[0];
ck(!!lifted, 'functions/index.js defines readableFailures');

class StubHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let logged = [];
const stubConsole = { error: (...args) => logged.push(args) };

let readableFailures = null;
if (lifted) {
  // eslint-disable-next-line no-new-func
  readableFailures = new Function('HttpsError', 'console', `${lifted}; return readableFailures;`)(
    StubHttpsError, stubConsole);
  ck(typeof readableFailures === 'function', 'and it evaluates to a function');
}

if (readableFailures) {
  const req = { auth: { uid: 'player-1' } };

  // A handler that works is not touched.
  logged = [];
  const okWrapped = readableFailures('Doing the thing', async () => ({ attempt: 'yes' }));
  const okResult = await okWrapped(req);
  ck(okResult && okResult.attempt === 'yes', 'a successful call passes its value straight through',
     JSON.stringify(okResult));
  ck(logged.length === 0, 'and logs nothing', JSON.stringify(logged));

  // A deliberate HttpsError must survive untouched — this is the sign-in
  // prompt for guests, and rewriting it would replace a useful instruction
  // with a shrug.
  logged = [];
  const deliberate = new StubHttpsError('permission-denied', 'Sign in with Google or email to play the Daily Puzzle.');
  const guardWrapped = readableFailures('Starting today\'s Puzzle', async () => { throw deliberate; });
  let caught = null;
  try { await guardWrapped(req); } catch (e) { caught = e; }
  ck(caught === deliberate, 'a deliberate HttpsError is rethrown as the very same object');
  ck(caught && caught.message === 'Sign in with Google or email to play the Daily Puzzle.',
     'so the player still gets the instruction it carried', caught && caught.message);
  ck(logged.length === 0, 'and it is not logged as a failure — it is working as designed');

  // An unexpected throw: the player gets something they can act on, and the
  // real error goes where it can be found.
  logged = [];
  const boom = new Error('Cannot use "undefined" as a Firestore value (found in field wordCount)');
  const crashWrapped = readableFailures('Starting today\'s Puzzle', async () => { throw boom; });
  caught = null;
  try { await crashWrapped(req); } catch (e) { caught = e; }
  ck(!!caught, 'an unexpected throw still rejects');
  ck(caught !== boom, 'but not as the raw error');
  ck(caught && caught.code === 'internal', "it is still coded 'internal' for the client", caught && caught.code);
  // The whole point. Before this, e.message was undefined and the SDK fell
  // back to printing the code.
  ck(caught && caught.message && caught.message !== 'internal',
     'and it carries an actual message rather than the bare word "internal"',
     caught && caught.message);
  ck(caught && /Starting today's Puzzle/.test(caught.message),
     'which names the operation that failed', caught && caught.message);
  ck(caught && /not yours/i.test(caught.message),
     'and tells the player it is not something they did wrong');

  ck(logged.length === 1, 'the real error is logged exactly once', String(logged.length));
  const payload = logged[0] && logged[0][1];
  ck(!!payload && payload.message === boom.message,
     "the log carries the original error's message", payload && payload.message);
  ck(!!payload && typeof payload.stack === 'string' && payload.stack.length > 0,
     'and its stack, which is the only way to find where it came from');
  ck(!!payload && payload.uid === 'player-1',
     'and the uid, so one player reporting it can be traced', payload && payload.uid);

  // A thrown non-Error (a string, a rejected promise of nothing) must not
  // itself crash the wrapper on the way out.
  logged = [];
  const oddWrapped = readableFailures('Doing the thing', async () => { throw 'just a string'; });
  caught = null;
  try { await oddWrapped(req); } catch (e) { caught = e; }
  ck(caught && caught.code === 'internal', 'a thrown non-Error is handled too, not re-thrown raw');

  // An unauthenticated request has no auth object at all.
  logged = [];
  const anonWrapped = readableFailures('Doing the thing', async () => { throw new Error('nope'); });
  caught = null;
  try { await anonWrapped({}); } catch (e) { caught = e; }
  ck(caught && caught.code === 'internal', 'and a request with no auth does not crash the logger');
  ck(logged.length === 1 && logged[0][1].uid === null, 'it just logs a null uid',
     JSON.stringify(logged[0] && logged[0][1] && logged[0][1].uid));
}

// ---- the Daily Puzzle's own callables are actually wrapped --------------------
// The wrapper is worth nothing if the two functions that produced the bug are
// not behind it, and nothing stops a future callable being added bare.
for (const name of ['startDailyGauntlet', 'guessDailyWord']) {
  const re = new RegExp(`exports\\.${name} = onCall\\(readableFailures\\(`);
  ck(re.test(src), `${name} is wrapped in readableFailures`,
     (src.match(new RegExp(`exports\\.${name} = onCall\\([^\\n]*`)) || [''])[0]);
}

// ---- the attempt's shape comes from the words -----------------------------
// `wordCount: puzzle.wordCount` is what turned a puzzle document missing that
// field into an undefined, which Firestore rejects outright (the admin SDK is
// initialized without ignoreUndefinedProperties — checked here too, since the
// guard below is only load-bearing while that remains true).
// Matched as the SETTING rather than the word: the comment beside the guard
// names it in prose, and a check that a comment can satisfy is not a check.
ck(!/ignoreUndefinedProperties\s*:\s*true/.test(src),
   'the admin SDK still rejects undefined values, so deriving the count matters');
ck(/const wordCount = Array\.isArray\(puzzle\.words\) && puzzle\.words\.length/.test(src),
   "the attempt's word count is derived from the puzzle's words");
ck(!/history: Array\.from\(\{ length: puzzle\.wordCount \}/.test(src),
   'and the history is no longer sized from the stored field');

for (const [ok, name, detail] of t) console.log(ok ? 'PASS ' : 'FAIL ', name, ok ? '' : ' -> ' + detail);
const bad = t.filter(([ok]) => !ok).length;
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
