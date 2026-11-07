/*
 * Two handles, one name.
 *
 * Renaming is free now. The 5,000-pt toll after the first change was also,
 * incidentally, the thing throttling handle churn — so the uniqueness check
 * behind it has to actually hold rather than nearly hold.
 *
 * What it has to stop, in the order these matter:
 *
 *   - CASE. "SODA" and "soda" are the same handle to every player who reads a
 *     leaderboard, and the old check was an exact-match Firestore query, so
 *     taking the variant of somebody else's name was allowed — and is now
 *     free. This is the hole that mattered.
 *   - THE OTHER DOOR. A new profile's handle is written by the client, and
 *     for a Google sign-in it is the first name in capitals: the second
 *     player called Josh arrived as a second JOSH without passing the rename
 *     check at all. That door is where the duplicates were actually coming
 *     from, so onUserProfileCreated de-duplicates there too.
 *   - YOURSELF. Changing your own name's case must not report that your own
 *     name is taken.
 *
 * What it does NOT stop, deliberately: two players submitting the same new
 * handle in the same second. Firestore cannot query other documents inside a
 * transaction, so closing that needs a usernames/{lower} reservation doc —
 * worth it if it ever happens, and it could not cover the create door anyway.
 *
 * The real handlers are lifted out and run against a fake Firestore.
 *
 * Pure; no emulator, no browser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import HANDLE from '../functions/handle-filter.js';
const REPO = (f) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f);
const read = (f) => fs.readFileSync(REPO(f), 'utf8').replace(/\r\n/g, '\n');
const fn = read('functions/index.js');
const html = read('index.html');

const t = [];
const ck = (ok, name, detail = '') => t.push([!!ok, name, detail]);
const eq = (name, got, want) => ck(JSON.stringify(got) === JSON.stringify(want), name,
  `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('could not extract ' + what); return m[0]; };

// ---- the shipped code, lifted ---------------------------------------------
const SRC = {
  max: grab(fn, /const HANDLE_MAX = \d+;/, 'HANDLE_MAX'),
  taken: grab(fn, /async function handleTaken\(name, uid\) \{\n[\s\S]*?\n\}/, 'handleTaken'),
  unique: grab(fn, /async function uniqueHandle\(base, uid\) \{\n[\s\S]*?\n\}/, 'uniqueHandle'),
  change: grab(fn, /exports\.changeUsername = onCall\(async \(request\) => \{\n[\s\S]*?\n\}\);/, 'changeUsername'),
  created: grab(fn, /exports\.onUserProfileCreated = onDocumentCreated\("users\/\{userId\}", async \(event\) => \{\n[\s\S]*?\n\}\);/, 'onUserProfileCreated'),
};
console.log('lifted from functions/index.js:', Object.values(SRC).join('').length, 'chars');

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A Firestore holding `users`, recording what it was asked to write. The two
// queries handleTaken makes are equality-on-one-field, which is all this
// needs to serve.
const fakeDb = (users) => {
  const writes = [];
  const queries = [];
  const db = {
    writes, queries, users,
    collection: () => ({
      doc: (id) => ({ id }),
      where: (field, op, value) => {
        queries.push([field, value]);
        const docs = Object.entries(users)
          .filter(([, u]) => u[field] === value)
          .map(([id, u]) => ({ id, data: () => u }));
        return { limit: () => ({ get: async () => ({ docs }) }) };
      },
    }),
    runTransaction: async (body) => body({
      get: async (ref) => ({ exists: Object.hasOwn(users, ref.id), data: () => users[ref.id] }),
      update: (ref, patch) => { writes.push([ref.id, patch]); Object.assign(users[ref.id], patch); },
    }),
  };
  return db;
};

const lift = (db, parts) => {
  const exported = {};
  const helpers = new Function('exports', 'db', 'HANDLE', 'HttpsError', 'onCall', 'onDocumentCreated',
    'requireAuth', 'FieldValue', 'console',
    `${SRC.max}\n${SRC.taken}\n${SRC.unique}\n${parts.map((k) => SRC[k]).join('\n')}\n` +
    `return { handleTaken, uniqueHandle };`)
    (exported, db, HANDLE, FakeHttpsError, (h) => h, (_p, h) => h,
     (req) => req.auth.uid, { increment: (n) => ({ __inc: n }) }, { warn() {}, error() {} });
  return { ...helpers, ...exported };
};

// ---- handleTaken ----------------------------------------------------------
{
  const db = fakeDb({
    soda: { username: 'SODA', usernameLower: 'soda' },
    legacy: { username: 'OldTimer' },            // never signed in since usernameLower existed
    me: { username: 'JFEKETE', usernameLower: 'jfekete' },
  });
  const { handleTaken } = lift(db, []);

  ck(await handleTaken('SODA', 'me'), 'an exact match is taken');
  ck(await handleTaken('soda', 'me'), 'and so is the same name in another case');
  ck(await handleTaken('SoDa', 'me'), '...in any case at all');
  ck(!await handleTaken('CRANE', 'me'), 'a name nobody has is free');
  // The whole reason this is not just a lowercase query.
  ck(await handleTaken('OldTimer', 'me'), 'a profile that predates usernameLower is still found');
  ck(!await handleTaken('oldtimer', 'me'),
     'though only exactly — which is what the backfill on sign-in is for');
  ck(!await handleTaken('JFEKETE', 'me'), 'your own handle is not taken by you');
  ck(!await handleTaken('jfekete', 'me'), '...nor is your own handle in another case');
  ck(await handleTaken('JFEKETE', 'someone-else'), '...but it is taken for anybody else');
}

// ---- uniqueHandle ---------------------------------------------------------
{
  const db = fakeDb({ a: { username: 'JOSH', usernameLower: 'josh' } });
  const { uniqueHandle } = lift(db, []);
  eq('a free handle passes straight through', await uniqueHandle('SODA', 'new'), 'SODA');

  const got = await uniqueHandle('JOSH', 'new');
  ck(got !== 'JOSH', 'a taken one does not', got);
  ck(/^JOSH_\d{4}$/.test(got), 'and comes back with four digits on the end', got);

  const MAX = Number(/const HANDLE_MAX = (\d+);/.exec(fn)[1]);
  const db2 = fakeDb({ a: { username: 'A'.repeat(MAX), usernameLower: 'a'.repeat(MAX) } });
  const long = await lift(db2, []).uniqueHandle('A'.repeat(MAX), 'new');
  ck(long.length <= MAX, `a handle already at the ${MAX}-character cap still fits after suffixing`,
     `${long} (${long.length})`);
  ck(/_\d{4}$/.test(long), '...with the suffix intact rather than truncated off', long);
}

// ---- changeUsername: the money is gone ------------------------------------
const changeFor = (users, uid, username) => {
  const db = fakeDb(users);
  const { changeUsername } = lift(db, ['change']);
  return { db, run: () => changeUsername({ auth: { uid }, data: { username } }) };
};
{
  const users = { me: { username: 'OLD', usernameLower: 'old', wallet: 0, handleChanges: 7 } };
  const { db, run } = changeFor(users, 'me', 'NEWNAME');
  const out = await run();

  eq('the rename goes through on an empty wallet after seven changes', out.username, 'NEWNAME');
  eq('and reports no cost', out.cost, 0);
  const [[id, patch]] = db.writes;
  eq('one write, to the caller', id, 'me');
  eq('it sets the handle and its lowercase twin, and counts the change',
     patch, { username: 'NEWNAME', usernameLower: 'newname', handleChanges: 8 });
  ck(!('wallet' in patch), 'and never touches the wallet', JSON.stringify(patch));
  // The whole point: the old code threw here.
  ck(!/You need 5,000 pts/.test(fn), 'the "you need 5,000 pts" refusal is gone from the server');
  ck(!/handleChanges > 0 \? 5000/.test(fn) && !/handleChanges > 0 \? 5000/.test(html),
     'and so is the first-one-free price table, on both sides');
}
{
  // Reusing your own name in a different case is a rename, not a collision.
  const users = { me: { username: 'soda', usernameLower: 'soda', handleChanges: 0 } };
  const out = await changeFor(users, 'me', 'SODA').run();
  eq('you may re-case your own handle', out.username, 'SODA');
}
{
  const users = {
    me: { username: 'ME', usernameLower: 'me', handleChanges: 0 },
    them: { username: 'SODA', usernameLower: 'soda' },
  };
  for (const [label, attempt] of [['exactly', 'SODA'], ['in lower case', 'soda'], ['in mixed case', 'SoDa']]) {
    const { db, run } = changeFor({ ...users, me: { ...users.me } }, 'me', attempt);
    let err = null;
    try { await run(); } catch (e) { err = e; }
    ck(err && err.code === 'already-exists', `taking somebody else's handle ${label} is refused`,
       err ? `${err.code}: ${err.message}` : 'no error thrown');
    eq(`...and writes nothing when it is ${label}`, db.writes, []);
  }
}

// ---- onUserProfileCreated: the door the duplicates came through -----------
const created = async (users, uid) => {
  const db = fakeDb(users);
  const { onUserProfileCreated } = lift(db, ['created']);
  await onUserProfileCreated({
    params: { userId: uid },
    data: {
      get: (k) => users[uid][k],
      ref: { update: async (patch) => { db.writes.push([uid, patch]); Object.assign(users[uid], patch); } },
    },
  });
  return { db, user: users[uid] };
};
{
  const { user } = await created({ fresh: { username: 'SODA' } }, 'fresh');
  eq('a free handle survives creation untouched', user.username, 'SODA');
  eq('...and picks up its lowercase twin, which it did not arrive with', user.usernameLower, 'soda');
}
{
  const { user } = await created({
    josh1: { username: 'JOSH', usernameLower: 'josh' },
    josh2: { username: 'JOSH' },
  }, 'josh2');
  ck(user.username !== 'JOSH', 'the second player called Josh does not become a second JOSH', user.username);
  ck(/^JOSH_\d{4}$/.test(user.username), '...they keep their name with digits on it', user.username);
  eq('and the lowercase twin follows the name that was actually kept',
     user.usernameLower, user.username.toLowerCase());
}
{
  // Case, on the create door too.
  const { user } = await created({
    a: { username: 'Josh', usernameLower: 'josh' },
    b: { username: 'JOSH' },
  }, 'b');
  ck(user.username !== 'JOSH', 'a case variant of an existing handle is de-duplicated too', user.username);
}
{
  // Screening still happens, and the replacement is then checked for
  // uniqueness in its own right rather than trusted.
  const blocked = HANDLE.isBlockedHandle('SODA') ? null : 'SODA';
  ck(blocked === 'SODA', 'the fixture name is not itself screened');
  const { user } = await created({ bad: { username: 'nigger' } }, 'bad');
  ck(!HANDLE.isBlockedHandle(user.username), 'a screened handle is still replaced on creation', user.username);
  eq('and the replacement gets a lowercase twin as well',
     user.usernameLower, user.username.toLowerCase());
}

// ---- the backfill ---------------------------------------------------------
{
  const refresh = grab(fn, /exports\.refreshProfile = onCall\(async \(request\) => \{\n[\s\S]*?\n\}\);/, 'refreshProfile');
  const line = /if \(typeof data\.username === "string" && data\.usernameLower !== data\.username\.toLowerCase\(\)\) \{\n\s*updates\.usernameLower = data\.username\.toLowerCase\(\);/;
  ck(line.test(refresh), 'sign-in backfills usernameLower for a profile that predates it');
  // Run the condition rather than only matching it.
  const fill = new Function('data', `const updates = {};
    ${refresh.match(line)[0]}
    }
    return updates;`);
  eq('a legacy profile gets the field', fill({ username: 'OldTimer' }), { usernameLower: 'oldtimer' });
  eq('one already correct is left alone', fill({ username: 'SODA', usernameLower: 'soda' }), {});
  eq('one that drifted is corrected', fill({ username: 'SODA', usernameLower: 'nope' }), { usernameLower: 'soda' });
  eq('and a profile with no handle at all is skipped', fill({}), {});
}

// ---- the client no longer quotes a price ----------------------------------
{
  ck(!/handle-cost-text/.test(html), 'the price tag is gone from the Profile modal');
  ck(!/You need 5,000 pts/.test(html), 'and so is the client-side refusal');
  ck(!/Update handle for 5,000 pts/.test(html), '...and the confirm that quoted it');
  const save = html.slice(html.indexOf('window.saveUsername'), html.indexOf('function guestHasProgressWorthLosing'));
  ck(save.length > 400, 'found saveUsername', String(save.length));
  ck(!/wallet -= /.test(save), 'the client stops deducting a cost it was never charged', save.slice(0, 200));
  ck(/handleChanges \+= 1/.test(save), 'but still counts the change, which the guest warning reads');
}

let bad = 0;
for (const [ok, name, detail] of t) {
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name + (ok ? '' : '  -> ' + detail));
}
console.log(bad ? `\n${bad} of ${t.length} FAILED` : `\nAll ${t.length} passed`);
process.exit(bad ? 1 : 0);
